import { adapterFor } from "../../../lib/chain/registry";
import { buildLaunchTransaction } from "../../../lib/launch/candy";
import { checkLaunchChoices } from "../../../lib/launch/limits";
import { createLaunchDraft } from "../../../lib/launch/lifecycle";
import { identify, json, NO_STORE, refuseForeignOrigin } from "../../../lib/http";
import { feeAmount, launchFee, mintFeeBps, paymentWallet } from "../../../lib/payments/config";
import { meterListingAttempt } from "../../../lib/rate-limit";
import { surfaceRefusal } from "../../../lib/surfaces";
import { verifySellerBinding, type SellerBindingFields } from "../../../lib/wallet/solana-binding";

export const dynamic = "force-dynamic";

/**
 * Opens a launch draft and hands back the transaction that deploys it.
 *
 * **One transaction does the whole launch**: the fee to `PAYMENT_WALLET`, the
 * Core collection, and the candy machine with its guards. The creator signs
 * once. A launch that paid the fee and created nothing, or created a machine
 * and paid nothing, is a state this product would have to resolve by hand, and
 * atomicity is free here because it is all one signer.
 *
 * **The creator is derived from a signature, not named in the body** — the same
 * rule the listing route follows (`docs/decisions.md` Q20). What it protects
 * here is smaller than a raffle's listing slot: nothing is exclusive until the
 * machine is deployed. It is still the right shape, because the transaction
 * this route hands back spends the named wallet's SOL, and building one for a
 * wallet that did not ask is a way to get somebody's Phantom to open on a
 * transaction they did not start.
 *
 * **The mint fee is FROZEN HERE, in lamports** (spec §0.1). `solFixedFee` takes
 * a fixed amount, so the bps rate is applied once, now, and recorded beside the
 * amount it produced. Changing `MINT_FEE_BPS` later moves no live collection.
 *
 * WHO CALLS THIS: the launch form on `/launch`.
 */
export async function POST(request: Request): Promise<Response> {
  const foreign = refuseForeignOrigin(request);
  if (foreign) return foreign;

  const chain = "solana";
  const closed = surfaceRefusal("launch_collection", chain, "POST /api/collections");
  if (closed) return json({ error: closed.message }, { status: 503, headers: NO_STORE });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON." }, { status: 400, headers: NO_STORE });
  }

  const { name, symbol, description, uri, itemsAvailable, price, mintLimit, startsAt, binding } =
    (body ?? {}) as Record<string, unknown>;

  const payment = paymentWallet(chain);
  const fee = launchFee(chain);
  const bps = mintFeeBps(chain);
  if (!payment.ok || !fee.ok || !bps.ok) {
    console.error("POST /api/collections: configuration incomplete.");
    return json({ error: "Launching is not available right now." }, { status: 503, headers: NO_STORE });
  }

  const adapter = adapterFor(chain);
  const priceNative = typeof price === "string" ? adapter.parseNative(price) : null;
  if (priceNative === null) {
    return json(
      { error: "price must be a decimal string in SOL." },
      { status: 400, headers: NO_STORE },
    );
  }

  const supplied = binding as { signature?: unknown; fields?: unknown } | undefined;
  if (!supplied || typeof supplied.signature !== "string" || typeof supplied.fields !== "object" || !supplied.fields) {
    return json(
      { error: "This launch needs a signature from the creator's wallet.", reason: "no_binding" },
      { status: 400, headers: NO_STORE },
    );
  }

  const nowMs = Date.now();
  const fields = supplied.fields as SellerBindingFields;
  const verdict = verifySellerBinding({
    signature: supplied.signature,
    fields,
    expectedDomain: new URL(request.url).host,
    expectedChain: chain,
    /**
     * The metadata URI stands in for the asset here, because a launch has no
     * mint yet. It is the one field that identifies WHAT is being created, so
     * it is what the creator's signature has to cover: a signature taken for
     * one launch cannot be replayed to create a different collection.
     */
    expectedAsset: typeof uri === "string" ? uri : "",
    nowMs,
  });
  if (!verdict.ok) {
    return json({ error: BINDING_FAILURES[verdict.reason], reason: verdict.reason }, { status: 400, headers: NO_STORE });
  }
  const creator = verdict.address;

  const choices = checkLaunchChoices({
    name: typeof name === "string" ? name : "",
    symbol: typeof symbol === "string" ? symbol : "",
    uri: typeof uri === "string" ? uri : "",
    itemsAvailable: typeof itemsAvailable === "number" ? itemsAvailable : -1,
    priceLamports: priceNative,
    mintLimit: typeof mintLimit === "number" ? mintLimit : -1,
    startsAtMs: typeof startsAt === "string" ? Date.parse(startsAt) : NaN,
    nowMs,
  });
  if (!choices.ok) {
    return json({ error: choices.message, reason: choices.reason }, { status: 400, headers: NO_STORE });
  }

  const caller = identify(request);
  if (!caller.ok) return json({ error: caller.message }, { status: 400, headers: NO_STORE });

  // The same counter the listing flow uses: both are a creator-side action that
  // spends RPC calls on a paid provider before anything exists to charge for.
  const limit = await meterListingAttempt(caller.ipHash);
  if (limit.limited) {
    return json(
      { error: limit.message },
      { status: 429, headers: { ...NO_STORE, "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  /**
   * FROZEN, in lamports, from the rate as it stands right now (spec §0.1).
   * `mint_fee_bps` is kept beside it as provenance so an operator can see why
   * the number is what it is without recomputing it from a setting that may
   * have moved.
   */
  const mintFeeNative = feeAmount(priceNative, bps.bps);

  let plan;
  try {
    plan = await buildLaunchTransaction({
      creator,
      name: (name as string).trim(),
      uri: uri as string,
      itemsAvailable: itemsAvailable as number,
      priceLamports: priceNative,
      mintFeeLamports: mintFeeNative,
      mintLimit: mintLimit as number,
      startsAtMs: choices.startsAt.getTime(),
      paymentWallet: payment.address,
      launchFeeLamports: fee.amount,
    });
  } catch (error) {
    console.error(`POST /api/collections: could not build (${error instanceof Error ? error.name : "unknown"})`);
    return json(
      { error: "This launch could not be prepared just now. Nothing has been charged." },
      { status: 503, headers: NO_STORE },
    );
  }

  const launch = await createLaunchDraft({
    slug: `${slugify((name as string).trim())}-${nowMs.toString(36)}`,
    chain,
    creatorWallet: creator,
    name: (name as string).trim(),
    symbol: (symbol as string).trim(),
    description: typeof description === "string" ? description.slice(0, 500) : "",
    collectionMint: plan.collection,
    candyMachine: plan.candyMachine,
    itemsAvailable: itemsAvailable as number,
    priceNative,
    mintFeeNative,
    mintFeeBps: bps.bps,
    startsAt: choices.startsAt,
  });

  return json(
    {
      slug: launch.slug,
      collection: plan.collection,
      candyMachine: plan.candyMachine,
      mintFeeNative: mintFeeNative.toString(),
      transaction: plan.transaction,
    },
    { status: 201, headers: NO_STORE },
  );
}

/** A readable, collision-resistant slug. The timestamp suffix does the work. */
function slugify(name: string): string {
  const stem = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
  return stem || "collection";
}

const BINDING_FAILURES: Record<string, string> = {
  malformed_signature: "That signature could not be read. Sign again.",
  bad_message: "That signature was not made over the expected message. Sign again.",
  wrong_domain: "That signature was taken for another site, so it is not valid here.",
  wrong_chain: "That signature was taken for another chain.",
  wrong_asset: "That signature was taken for different metadata than this launch names.",
  expired: "That signature has expired. Sign again.",
  address_mismatch: "That signature was not made by the wallet it names.",
};
