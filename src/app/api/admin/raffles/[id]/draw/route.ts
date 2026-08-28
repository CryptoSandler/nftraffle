import { requireAdmin } from "../../../../../../lib/admin-guard";
import { blockhashForSlot } from "../../../../../../lib/chain/rpc";
import { json, NO_STORE, refuseForeignOrigin } from "../../../../../../lib/http";
import { rpcConfigured } from "../../../../../../lib/payments/config";
import { deriveWinner, verifyCommitment } from "../../../../../../lib/raffles/draw";
import { advanceRaffle, raffleById, recordDraw } from "../../../../../../lib/raffles/lifecycle";
import { ticketsFor } from "../../../../../../lib/raffles/tickets";

export const dynamic = "force-dynamic";

/**
 * Reveals the seed and records the winner.
 *
 * **The server does not choose anything here.** The seed was committed to when
 * the raffle was created, the slot was announced then too, and this route reads
 * the blockhash the chain produced and does the arithmetic. Its only discretion
 * is WHEN to run, which is exactly the residual risk spec §0.4 names and the
 * public verification page displays.
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

  if (!rpcConfigured()) {
    console.error(`POST /api/admin/raffles/${id}/draw: SOLANA_RPC_URL is not set.`);
    return json({ error: "No Solana connection is configured." }, { status: 503, headers: NO_STORE });
  }

  const existing = await raffleById(id);
  if (!existing) return json({ error: "No such raffle." }, { status: 404, headers: NO_STORE });

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
  const blockhash = await blockhashForSlot(raffle.drawSlot);
  if (!blockhash) {
    // A skipped slot is ordinary on Solana. Refusing rather than silently
    // walking forward to the next produced slot: which slot was used is part of
    // what was announced, and quietly substituting another would make the
    // published method a description of something else.
    return json(
      {
        error:
          "The announced slot has no block yet, or was skipped. The draw cannot use a different " +
          "slot than the one announced.",
      },
      { status: 409, headers: NO_STORE },
    );
  }

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
    winnerWallet: winner.wallet,
    winningTicket,
  });

  if (!result.ok) {
    return json({ error: `Could not record the draw: ${result.reason}.` }, { status: 409, headers: NO_STORE });
  }

  return new Response(null, { status: 303, headers: { location: "/admin", ...NO_STORE } });
}
