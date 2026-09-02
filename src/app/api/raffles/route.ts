import { isChainId } from "../../../lib/chain/adapter";
import { adapterFor } from "../../../lib/chain/registry";
import { identify, json, NO_STORE, refuseForeignOrigin } from "../../../lib/http";
import { houseFeeBps } from "../../../lib/payments/config";
import { commitSeed } from "../../../lib/raffles/draw";
import { createDraft } from "../../../lib/raffles/lifecycle";
import { checkSellerChoices } from "../../../lib/raffles/schedule";
import { meterListingAttempt } from "../../../lib/rate-limit";
import { verifySellerBinding, type SellerBindingFields } from "../../../lib/wallet/solana-binding";
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
 * WHO CALLS THIS: the listing form on `/raffle/new`, and the runbooks —
 * `docs/devnet-rehearsal.md` and `docs/first-raffle.md` — through curl, with
 * `scripts/sign-seller-binding.mts` producing the signature a shell cannot.
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

  const {
    chain: chainParam,
    prizeAsset,
    sellerWallet: claimedSeller,
    binding,
    ticketPrice,
    maxTickets,
    durationMinutes,
  } = (body ?? {}) as Record<string, unknown>;

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
  const nowMs = Date.now();

  /**
   * THE SELLER IS DERIVED FROM A SIGNATURE, NOT COPIED FROM THE BODY.
   *
   * The draft takes a slot: `raffles_live_prize` (migration 004) is unique over
   * `(chain, prize_asset)` for every status a raffle is spoken for in. Checking
   * only that the NAMED seller holds the asset — which is all this route did
   * until 2026-09-01 — lets anybody take that slot for a stranger's asset by
   * naming its real holder, and the holder cannot even find the draft to cancel
   * it, because drafts appear in no public listing. One request, no wallet.
   *
   * `docs/decisions.md` Q20 is the owner's decision to close that with a
   * message signature, and it is the first one Solana asks for.
   */
  let sellerWallet: string;
  if (chainParam === "solana") {
    const supplied = binding as { signature?: unknown; fields?: unknown } | undefined;
    if (
      !supplied ||
      typeof supplied.signature !== "string" ||
      !supplied.fields ||
      typeof supplied.fields !== "object"
    ) {
      return json(
        { error: "This listing needs a signature from the seller's wallet.", reason: "no_binding" },
        { status: 400, headers: NO_STORE },
      );
    }

    const verdict = verifySellerBinding({
      signature: supplied.signature,
      fields: supplied.fields as SellerBindingFields,
      // From the REQUEST's own host, not from the body: a caller who could name
      // the domain could have a signature taken elsewhere verify here.
      expectedDomain: new URL(request.url).host,
      expectedChain: chainParam,
      // The asset as this route parsed it, so the thing signed for and the thing
      // listed cannot differ.
      expectedAsset: asset.raw,
      nowMs,
    });
    if (!verdict.ok) {
      return json(
        { error: BINDING_FAILURES[verdict.reason], reason: verdict.reason },
        { status: 400, headers: NO_STORE },
      );
    }
    sellerWallet = verdict.address;

    /**
     * A body that ALSO claims a seller has to agree with the one that signed.
     *
     * Not a security check — the signature already decided it — but a form that
     * sends a stale wallet after the person switched accounts in Phantom would
     * otherwise list under an address they are no longer connected as, and only
     * find out when the escrow deposit is refused.
     */
    if (claimedSeller !== undefined && !chain.sameAddress(String(claimedSeller), sellerWallet)) {
      return json(
        {
          error: "The wallet that signed is not the wallet this listing names. Reconnect and try again.",
          reason: "seller_mismatch",
        },
        { status: 400, headers: NO_STORE },
      );
    }
  } else {
    /**
     * Robinhood has no seller binding, and that is a gap rather than a decision
     * (`docs/decisions.md` Q18, Q20). The same slot-grab is possible there. It
     * is left open deliberately for now: the Robinhood surface is shut on every
     * deployment, `docs/testnet-rehearsal-robinhood.md` is its gate, and adding
     * an unrehearsed `personal_sign` step to that runbook's thirteen unrun
     * checks would change what the gate is measuring while it is being run.
     * // ponytail: mirror this block with `verifyPayerBinding` when the
     * // Robinhood listing surface is opened. It is the same shape.
     */
    if (typeof claimedSeller !== "string" || !chain.isAddress(claimedSeller)) {
      return json(
        { error: "sellerWallet must be an address on that chain." },
        { status: 400, headers: NO_STORE },
      );
    }
    sellerWallet = claimedSeller;
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

  const choices = checkSellerChoices({
    ticketPriceNative: priceNative,
    maxTickets,
    durationMinutes,
    nowMs,
    // From the request's validated chain, which is also the chain the price was
    // parsed in. Ten SOL and half an ETH are different ceilings for the same
    // reason they are different prices (docs/decisions.md Q13).
    chain: chainParam,
  });
  if (!choices.ok) {
    return json({ error: choices.message, reason: choices.reason }, { status: 400, headers: NO_STORE });
  }

  const caller = identify(request);
  if (!caller.ok) return json({ error: caller.message }, { status: 400, headers: NO_STORE });

  /**
   * Metered here and not earlier: everything above is local arithmetic, and a
   * request that fails it has cost us nothing worth counting. Everything below
   * spends a DAS read on a paid provider.
   */
  const limit = await meterListingAttempt(caller.ipHash);
  if (limit.limited) {
    return json(
      { error: limit.message },
      { status: 429, headers: { ...NO_STORE, "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  /**
   * The seller has to hold the asset NOW.
   *
   * Not a security boundary — the escrow check at publish time is, and it
   * re-reads ownership then. This is here so somebody who mistyped an asset
   * reference, or who is listing something they already sold, finds out before
   * they are asked to send anything anywhere.
   */
  const metadata = await chain.assetMetadata(asset);
  if (metadata === null || metadata.owner === null) {
    return json(
      { error: "That asset could not be read on chain. Check the reference." },
      { status: 404, headers: NO_STORE },
    );
  }
  /**
   * A BURNT ASSET STILL HAS AN OWNER, so this check cannot be folded into the
   * one below.
   *
   * DAS answers `ownership.owner` for a Core asset that has been burned, and
   * the devnet end-to-end run on 2026-09-01 listed one without noticing: the
   * draft was created, took the asset's listing slot, and the seller found out
   * one step later when the deposit failed simulation with Core's
   * `IncorrectAccount`. Refusing here costs nothing — the metadata read already
   * happened — and turns a confusing failure at the wallet into a sentence at
   * the form.
   */
  if (metadata.burnt) {
    return json(
      { error: "That asset has been burned, so it cannot be raffled.", reason: "burnt" },
      { status: 409, headers: NO_STORE },
    );
  }
  if (!chain.sameAddress(metadata.owner, sellerWallet)) {
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

/**
 * What each binding refusal says to the person holding the wallet.
 *
 * Specific, because every one of these is something they can act on — sign
 * again, reconnect, check which site they are on — and a single "that did not
 * work" would leave them guessing at a wallet prompt.
 */
const BINDING_FAILURES: Record<string, string> = {
  malformed_signature: "That signature could not be read. Sign again.",
  bad_message: "That signature was not made over the expected message. Sign again.",
  wrong_domain: "That signature was taken for another site, so it is not valid here.",
  wrong_chain: "That signature was taken for another chain.",
  wrong_asset: "That signature was taken for a different asset than this listing names.",
  expired: "That signature has expired. Sign again.",
  address_mismatch: "That signature was not made by the wallet it names.",
};

const FAILURES: Record<string, string> = {
  prize_already_listed: "That asset already has a raffle open.",
  slug_taken: "Could not allocate a URL for this raffle. Try again.",
};
