import { assetOwner } from "../../../lib/chain/das";
import { currentSlot } from "../../../lib/chain/rpc";
import { identify, json, NO_STORE, refuseForeignOrigin } from "../../../lib/http";
import { houseFeeBps, isAddressShaped, LAMPORTS_PER_SOL } from "../../../lib/payments/config";
import { commitSeed } from "../../../lib/raffles/draw";
import { createDraft } from "../../../lib/raffles/lifecycle";
import { announceDrawSlot, checkSellerChoices } from "../../../lib/raffles/schedule";
import { surfaceRefusal } from "../../../lib/surfaces";

export const dynamic = "force-dynamic";

/**
 * Opens a raffle draft: the record the escrow deposit will be verified against.
 *
 * **This runs BEFORE the seller sends anything** (spec §0.3). Verification needs
 * something to verify against, and without a prior record an NFT landing in
 * escrow is an orphan the server would have to guess about.
 *
 * Three things are established here and none of them can be established later:
 * the exact mint, the commitment, and the announced slot. All three are written
 * in one INSERT, so a draft either has all of them or does not exist.
 *
 * WHO CALLS THIS: the create form on `/raffle/new`.
 */
export async function POST(request: Request): Promise<Response> {
  const foreign = refuseForeignOrigin(request);
  if (foreign) return foreign;

  const closed = surfaceRefusal("list_raffle", "POST /api/raffles");
  if (closed) return json({ error: closed.message }, { status: 503, headers: NO_STORE });

  const fee = houseFeeBps();
  if (!fee.ok) {
    console.error(`POST /api/raffles: ${fee.reason}`);
    return json({ error: "Listing is not available right now." }, { status: 503, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON." }, { status: 400, headers: NO_STORE });
  }

  const { prizeMint, sellerWallet, ticketPriceSol, maxTickets, durationMinutes } =
    (body ?? {}) as Record<string, unknown>;

  if (typeof prizeMint !== "string" || !isAddressShaped(prizeMint)) {
    return json({ error: "prizeMint must be a Solana address." }, { status: 400, headers: NO_STORE });
  }
  if (typeof sellerWallet !== "string" || !isAddressShaped(sellerWallet)) {
    return json({ error: "sellerWallet must be a Solana address." }, { status: 400, headers: NO_STORE });
  }
  if (typeof ticketPriceSol !== "number" || !Number.isFinite(ticketPriceSol) || ticketPriceSol <= 0) {
    return json({ error: "ticketPriceSol must be a positive number." }, { status: 400, headers: NO_STORE });
  }
  if (typeof maxTickets !== "number" || typeof durationMinutes !== "number") {
    return json({ error: "maxTickets and durationMinutes must be numbers." }, { status: 400, headers: NO_STORE });
  }

  const nowMs = Date.now();
  const choices = checkSellerChoices({
    ticketPriceLamports: BigInt(Math.round(ticketPriceSol * Number(LAMPORTS_PER_SOL))),
    maxTickets,
    durationMinutes,
    nowMs,
  });
  if (!choices.ok) {
    return json({ error: choices.message, reason: choices.reason }, { status: 400, headers: NO_STORE });
  }

  const caller = identify(request);
  if (!caller.ok) return json({ error: caller.message }, { status: 400, headers: NO_STORE });

  /**
   * The seller has to hold the asset NOW.
   *
   * Not a security boundary — the escrow check at publish time is, and it
   * re-reads ownership then. This is here so somebody who mistyped a mint, or
   * who is listing an asset they already sold, finds out before they are asked
   * to send anything anywhere.
   */
  const owner = await assetOwner(prizeMint);
  if (owner === null) {
    return json(
      { error: "That asset could not be read on chain. Check the mint address." },
      { status: 404, headers: NO_STORE },
    );
  }
  if (owner !== sellerWallet) {
    return json(
      { error: "That asset is not held by this wallet." },
      { status: 409, headers: NO_STORE },
    );
  }

  const slot = await currentSlot();
  if (slot === null) {
    // Fails closed. A raffle whose announced slot was guessed is a raffle whose
    // commitment references a moment nobody can rely on.
    console.error("POST /api/raffles: could not read the current slot.");
    return json(
      { error: "The Solana network could not be reached just now. Try again in a moment." },
      { status: 503, headers: NO_STORE },
    );
  }

  /**
   * THE SEED IS WRITTEN AND NEVER RETURNED.
   *
   * It goes into `seed_secret` inside the same INSERT that publishes the hash
   * (migration 003) and appears in no response, no log, and nothing the seller
   * is shown. `raffles.seed` — the column any public reader renders — stays
   * NULL until the draw copies it across.
   */
  const { seed, seedHash } = commitSeed();

  const created = await createDraft({
    slug: `${slugify(prizeMint)}-${nowMs.toString(36)}`,
    sellerWallet,
    prizeMint,
    collectionId: null,
    ticketPriceLamports: BigInt(Math.round(ticketPriceSol * Number(LAMPORTS_PER_SOL))),
    maxTickets,
    houseFeeBps: fee.bps,
    drawSlot: announceDrawSlot({ currentSlot: slot, nowMs, endsAtMs: choices.endsAt.getTime() }),
    endsAt: choices.endsAt,
    seedHash,
    seedSecret: seed,
  });

  if (!created.ok) {
    return json(
      { error: FAILURES[created.reason], reason: created.reason },
      { status: 409, headers: NO_STORE },
    );
  }

  return json(
    {
      slug: created.raffle.slug,
      seedHash: created.raffle.seedHash,
      drawSlot: created.raffle.drawSlot.toString(),
      endsAt: created.raffle.endsAt.toISOString(),
    },
    { status: 201, headers: NO_STORE },
  );
}

/** A readable, collision-resistant slug. The timestamp suffix does the work. */
function slugify(mint: string): string {
  return mint.slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "");
}

const FAILURES: Record<string, string> = {
  prize_already_listed: "That asset already has a raffle open.",
  slug_taken: "Could not allocate a URL for this raffle. Try again.",
};
