import { isChainId } from "../../../lib/chain/adapter";
import { adapterFor } from "../../../lib/chain/registry";
import { identify, json, NO_STORE, refuseForeignOrigin } from "../../../lib/http";
import { houseFeeBps } from "../../../lib/payments/config";
import { commitSeed } from "../../../lib/raffles/draw";
import { createDraft } from "../../../lib/raffles/lifecycle";
import { checkSellerChoices } from "../../../lib/raffles/schedule";
import { surfaceRefusal } from "../../../lib/surfaces";

export const dynamic = "force-dynamic";

/**
 * Opens a raffle draft: the record the escrow deposit will be verified against.
 *
 * **This runs BEFORE the seller sends anything** (spec §0.3). Verification needs
 * something to verify against, and without a prior record an asset landing in
 * escrow is an orphan the server would have to guess about.
 *
 * Four things are established here and none can be established later: the chain,
 * the exact asset, the commitment, and the announced height. All four are
 * written in one INSERT, so a draft either has all of them or does not exist.
 *
 * **This is the ONE route where the chain is named by the caller**, because no
 * row exists yet to read it from. Everywhere else it comes from the raffle — a
 * request that could name the chain could have an EVM receipt verified against
 * a price denominated in SOL.
 *
 * WHO CALLS THIS: the create form on `/raffle/new`.
 */
export async function POST(request: Request): Promise<Response> {
  const foreign = refuseForeignOrigin(request);
  if (foreign) return foreign;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON." }, { status: 400, headers: NO_STORE });
  }

  const { chain: chainParam, prizeAsset, sellerWallet, ticketPrice, maxTickets, durationMinutes } =
    (body ?? {}) as Record<string, unknown>;

  if (typeof chainParam !== "string" || !isChainId(chainParam)) {
    return json({ error: "chain must be a supported chain." }, { status: 400, headers: NO_STORE });
  }
  const chain = adapterFor(chainParam);

  const closed = surfaceRefusal("list_raffle", chainParam, "POST /api/raffles");
  if (closed) return json({ error: closed.message }, { status: 503, headers: NO_STORE });

  const fee = houseFeeBps(chainParam);
  if (!fee.ok) {
    console.error(`POST /api/raffles: ${fee.reason}`);
    return json({ error: "Listing is not available right now." }, { status: 503, headers: NO_STORE });
  }

  const asset = typeof prizeAsset === "string" ? chain.parseAsset(prizeAsset) : null;
  if (!asset) {
    return json(
      { error: "prizeAsset is not a valid asset reference on that chain." },
      { status: 400, headers: NO_STORE },
    );
  }
  if (typeof sellerWallet !== "string" || !chain.isAddress(sellerWallet)) {
    return json(
      { error: "sellerWallet must be an address on that chain." },
      { status: 400, headers: NO_STORE },
    );
  }

  /**
   * A DECIMAL STRING, never a JSON number.
   *
   * ETH has eighteen decimals and a double carries about fifteen significant
   * digits, so a price that arrived as a number would already have been rounded
   * before this code saw it — and a rounded price is a price nobody agreed to.
   * The adapter parses it in its own base.
   */
  const priceNative = typeof ticketPrice === "string" ? chain.parseNative(ticketPrice) : null;
  if (priceNative === null) {
    return json(
      { error: "ticketPrice must be a decimal string in the chain's native currency." },
      { status: 400, headers: NO_STORE },
    );
  }

  if (typeof maxTickets !== "number" || typeof durationMinutes !== "number") {
    return json(
      { error: "maxTickets and durationMinutes must be numbers." },
      { status: 400, headers: NO_STORE },
    );
  }

  const nowMs = Date.now();
  const choices = checkSellerChoices({
    ticketPriceNative: priceNative,
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
   * re-reads ownership then. This is here so somebody who mistyped an asset
   * reference, or who is listing something they already sold, finds out before
   * they are asked to send anything anywhere.
   */
  const owner = await chain.assetOwner(asset);
  if (owner === null) {
    return json(
      { error: "That asset could not be read on chain. Check the reference." },
      { status: 404, headers: NO_STORE },
    );
  }
  if (!chain.sameAddress(owner, sellerWallet)) {
    return json({ error: "That asset is not held by this wallet." }, { status: 409, headers: NO_STORE });
  }

  /**
   * THE SEED IS WRITTEN AND NEVER RETURNED.
   *
   * It goes into `seed_secret` inside the same INSERT that publishes the hash
   * (migration 003) and appears in no response, no log, and nothing the seller
   * is shown. `raffles.seed` — the column any public reader renders — stays NULL
   * until the draw copies it across.
   */
  const { seed, seedHash } = commitSeed();

  const created = await createDraft({
    slug: `${slugify(asset.raw)}-${nowMs.toString(36)}`,
    chain: chainParam,
    sellerWallet,
    prizeAsset: asset.raw,
    collectionId: null,
    ticketPriceNative: priceNative,
    maxTickets,
    houseFeeBps: fee.bps,
    /**
     * An INSTANT, not a block number, and it needs no chain call to compute.
     *
     * The old line here asked the adapter to predict a height from the current
     * one and an assumed slot rate. That prediction is what
     * `docs/findings-2026-08-31-draw-margin.md` found to be wrong by the
     * difference between the assumed rate and the real one — early, always, and
     * for long raffles early enough to land before the sale closed.
     *
     * A time cannot drift. Which block it resolves to is decided at the draw by
     * the chain (docs/decisions.md Q14).
     */
    drawAt: choices.drawAt,
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
      chain: created.raffle.chain,
      seedHash: created.raffle.seedHash,
      drawAt: created.raffle.drawAt.toISOString(),
      endsAt: created.raffle.endsAt.toISOString(),
    },
    { status: 201, headers: NO_STORE },
  );
}

/** A readable, collision-resistant slug. The timestamp suffix does the work. */
function slugify(assetRef: string): string {
  return assetRef.replace(/^0x/, "").slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "");
}

const FAILURES: Record<string, string> = {
  prize_already_listed: "That asset already has a raffle open.",
  slug_taken: "Could not allocate a URL for this raffle. Try again.",
};
