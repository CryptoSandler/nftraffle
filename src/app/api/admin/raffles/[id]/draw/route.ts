import { requireAdmin } from "../../../../../../lib/admin-guard";
import { adapterFor } from "../../../../../../lib/chain/registry";
import { json, NO_STORE, refuseForeignOrigin } from "../../../../../../lib/http";
import { rpcConfigured } from "../../../../../../lib/payments/config";
import { checkDrawAnchor, deriveWinner, verifyCommitment } from "../../../../../../lib/raffles/draw";
import { advanceRaffle, raffleById, recordDraw } from "../../../../../../lib/raffles/lifecycle";
import { ticketsFor } from "../../../../../../lib/raffles/tickets";

export const dynamic = "force-dynamic";

/**
 * Reveals the seed and records the winner.
 *
 * **The server does not choose anything here.** The seed was committed to when
 * the raffle was created, the INSTANT the entropy is anchored to was published
 * then too, and this route asks the chain which block came first at or after
 * that instant and does the arithmetic. Its only discretion is WHEN to run,
 * which is exactly the residual risk spec §0.4 names and the public
 * verification page displays.
 *
 * **Running late changes nothing**, and that is the property the old design
 * lacked. The anchor resolves to the same block whether this route runs a
 * minute after the instant or a week after it, so an operator who waits gains
 * no choice of outcome.
 *
 * The commitment is re-checked before anything is written. That is not
 * paranoia about our own database: it is the one assertion that catches a seed
 * column that was edited, corrupted, or restored from a backup that predates
 * the commitment — all of which would otherwise produce a winner the public
 * page then loudly reports as not checking out, after the prize had been sent.
 *
 * WHO CALLS THIS: the "Reveal and draw" form on `/admin`.
 */
/** The stored secret, read only to compute the winner. Never returned anywhere. */
async function storedSeed(raffleId: string): Promise<string | null> {
  const { queryOne } = await import("../../../../../../lib/db");
  const row = await queryOne<{ seed_secret: string | null }>(
    `SELECT seed_secret FROM raffles WHERE id = $1`,
    [raffleId],
  );
  return row?.seed_secret ?? null;
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/admin/raffles/[id]/draw">,
): Promise<Response> {
  const foreign = refuseForeignOrigin(request);
  if (foreign) return foreign;

  const { id } = await context.params;
  const guard = await requireAdmin(request, `POST /api/admin/raffles/${id}/draw`);
  if (!guard.ok) return guard.response;

  const existing = await raffleById(id);
  if (!existing) return json({ error: "No such raffle." }, { status: 404, headers: NO_STORE });

  const chain = adapterFor(existing.chain);
  if (!rpcConfigured(existing.chain)) {
    console.error(`POST /api/admin/raffles/${id}/draw: SOLANA_RPC_URL is not set.`);
    return json({ error: "No Solana connection is configured." }, { status: 503, headers: NO_STORE });
  }

  // A raffle whose clock ran out may still read `open` if nobody has loaded its
  // page since. Advancing here is what lets an operator draw it.
  const raffle = (await advanceRaffle(id)) ?? existing;

  if (raffle.status !== "closed") {
    return json(
      { error: `This raffle is ${raffle.status}, so it cannot be drawn.` },
      { status: 409, headers: NO_STORE },
    );
  }

  /**
   * The seed lives in `seed_secret` and is read by `recordDraw` alone
   * (migration 003), so this route never handles it. That is deliberate: a
   * route that read the secret in order to pass it back in would be a second
   * place the published value could diverge from the committed one.
   *
   * The commitment is re-checked below, against what was actually written.
   */
  const anchor = await chain.blockAtOrAfter(raffle.drawAt.getTime());
  if (!anchor) {
    // Either the instant has not arrived, or the chain could not be read. Both
    // mean wait. Skipped slots are stepped over inside the search rather than
    // refused here — "the first block at or after T" is well defined whether or
    // not slot T itself produced one, which is precisely why the commitment is
    // to a time.
    return json(
      {
        error:
          "The instant this raffle's draw is anchored to has not passed yet, or the chain could " +
          "not be read. The draw cannot use an earlier block.",
      },
      { status: 409, headers: NO_STORE },
    );
  }

  /**
   * THE CHECK THAT MAKES THE OLD ATTACK UNREACHABLE.
   *
   * The search already returns a block at or after the anchor, and the anchor
   * is after the close by construction (`drawAnchorFor`, plus the
   * `raffles_anchor_after_close` constraint from migration 005). This asserts it
   * anyway, against the BLOCK'S OWN timestamp, because "by construction" is an
   * argument about code that was true of the previous design too — right up
   * until a measured slot rate turned out not to be the real one.
   *
   * A refusal here is not a transient condition to retry around. It means the
   * chain handed back a block that existed while tickets were on sale, and
   * drawing on it would let anyone who read it buy the winning ticket
   * knowingly.
   */
  const usable = checkDrawAnchor({
    blockTimeMs: anchor.timeMs,
    endsAtMs: raffle.endsAt.getTime(),
    drawAtMs: raffle.drawAt.getTime(),
  });
  if (!usable.ok) {
    console.error(
      `draw ${id}: refusing anchor block ${anchor.height} (${usable.reason}); ` +
        `block ${anchor.timeMs}, close ${raffle.endsAt.getTime()}, anchor ${raffle.drawAt.getTime()}.`,
    );
    return json({ error: usable.message, reason: usable.reason }, { status: 409, headers: NO_STORE });
  }

  const blockhash = anchor.hash;

  const tickets = await ticketsFor(raffle.id);
  if (tickets.length === 0) {
    return json(
      { error: "This raffle sold no tickets, so it has no winner. Cancel it instead." },
      { status: 409, headers: NO_STORE },
    );
  }

  const secret = await storedSeed(raffle.id);
  if (!secret) {
    return json(
      { error: "This raffle has no stored seed, so its draw cannot be run." },
      { status: 409, headers: NO_STORE },
    );
  }
  if (!verifyCommitment(secret, raffle.seedHash)) {
    // Catches a seed column that was edited, corrupted, or restored from a
    // backup predating the commitment — all of which would otherwise produce a
    // winner the public page loudly reports as not checking out, after the
    // prize had been sent.
    console.error(`draw ${id}: stored seed does not match the published commitment.`);
    return json(
      { error: "This raffle's seed does not match its published commitment. Not drawing." },
      { status: 409, headers: NO_STORE },
    );
  }

  const { winningTicket } = deriveWinner({
    seedHash: raffle.seedHash,
    seed: secret,
    drawBlockhash: blockhash,
    raffleId: raffle.id,
    ticketCount: tickets.length,
  });

  const winner = tickets.find((ticket) => ticket.number === winningTicket);
  if (!winner) {
    // Unreachable: deriveWinner returns 1..ticketCount and ticketsFor returns
    // exactly those numbers. Kept because the alternative is a non-null
    // assertion on the value that decides who receives somebody's NFT.
    console.error(`draw ${id}: ticket ${winningTicket} of ${tickets.length} is missing.`);
    return json({ error: "The ticket list is inconsistent. Not drawing." }, { status: 500, headers: NO_STORE });
  }

  const result = await recordDraw(raffle.id, {
    drawBlockhash: blockhash,
    drawHeight: anchor.height,
    drawBlockTimeMs: anchor.timeMs,
    winnerWallet: winner.wallet,
    winningTicket,
  });

  if (!result.ok) {
    return json({ error: `Could not record the draw: ${result.reason}.` }, { status: 409, headers: NO_STORE });
  }

  return new Response(null, { status: 303, headers: { location: "/admin", ...NO_STORE } });
}
