import { adapterFor } from "../../../../../lib/chain/registry";
import { buildListingDeposit } from "../../../../../lib/chain/solana/listing-intent";
import { identify, json, NO_STORE, refuseForeignOrigin } from "../../../../../lib/http";
import { escrowWallet, paymentWallet, raffleListingFee } from "../../../../../lib/payments/config";
import { raffleBySlug } from "../../../../../lib/raffles/lifecycle";
import { meterListingAttempt } from "../../../../../lib/rate-limit";
import { surfaceRefusal } from "../../../../../lib/surfaces";

export const dynamic = "force-dynamic";

/**
 * The transaction that pays the listing fee and puts the prize in escrow, in
 * one signature.
 *
 * **Nothing here is taken from the request body, and the body is not read at
 * all.** The seller, the asset, the fee and the escrow address all come from
 * the draft and from `payments/config.ts`. A route that built a transfer to an
 * address a caller named would be a route that simulates a transaction to
 * wherever the caller likes and hands it to a wallet with our site's name on
 * the prompt.
 *
 * **It returns a transaction only when the chain says that transaction can
 * succeed** (`docs/wallet-warnings.md`). The absence of the field is the
 * mechanism the browser reads; there is no flag saying "this one is fine".
 *
 * Deliberately NOT admin-gated and deliberately not signature-gated: everything
 * it discloses is already public — the draft, its asset, the fee — and the
 * transaction it returns can only be signed by the seller, who is the only
 * account that can pay from it or move the asset. What it does spend is RPC
 * calls, which is why it is metered.
 *
 * WHO CALLS THIS: the listing form on `/raffle/new`, after the draft exists.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/raffles/[slug]/deposit">,
): Promise<Response> {
  const foreign = refuseForeignOrigin(request);
  if (foreign) return foreign;

  const { slug } = await context.params;

  const raffle = await raffleBySlug(slug);
  if (!raffle) return json({ error: "No such raffle." }, { status: 404, headers: NO_STORE });

  // The chain comes from the raffle, never from the request.
  const chain = adapterFor(raffle.chain);
  const closed = surfaceRefusal("list_raffle", raffle.chain, `POST /api/raffles/${slug}/deposit`);
  if (closed) return json({ error: closed.message }, { status: 503, headers: NO_STORE });

  if (raffle.chain !== "solana") {
    // Robinhood's deposit is an ERC-721 `safeTransferFrom` plus a value
    // transfer, which is a different builder that does not exist yet. Its
    // runbook still sends both legs by hand (`cast send`).
    return json(
      { error: "This chain's listing flow is not open yet." },
      { status: 503, headers: NO_STORE },
    );
  }

  if (raffle.status !== "draft") {
    return json(
      { error: `This raffle is ${raffle.status}, so its deposit has already been made.` },
      { status: 409, headers: NO_STORE },
    );
  }

  const escrow = escrowWallet(raffle.chain);
  const payment = paymentWallet(raffle.chain);
  const fee = raffleListingFee(raffle.chain);
  if (!escrow.ok || !payment.ok || !fee.ok) {
    console.error(`POST /api/raffles/${slug}/deposit: configuration incomplete.`);
    return json({ error: "Listing is not available right now." }, { status: 503, headers: NO_STORE });
  }

  const caller = identify(request);
  if (!caller.ok) return json({ error: caller.message }, { status: 400, headers: NO_STORE });

  // Metered on the same counter as opening a draft, and for the same reason:
  // everything below this line spends RPC calls on a paid provider, and this
  // route is reachable by anybody who knows a slug.
  const limit = await meterListingAttempt(caller.ipHash);
  if (limit.limited) {
    return json(
      { error: limit.message },
      { status: 429, headers: { ...NO_STORE, "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  const parsed = chain.parseAsset(raffle.prizeAsset);
  if (!parsed) {
    console.error(`deposit ${slug}: stored prize_asset is not valid for ${raffle.chain}.`);
    return json({ error: "This raffle's prize could not be read." }, { status: 409, headers: NO_STORE });
  }

  /**
   * Read again, right now, rather than trusting the draft.
   *
   * The draft checked ownership when it was created; a seller who sold the
   * asset in between would otherwise be handed a transaction that fails
   * simulation — the exact thing this route exists not to do — and would read
   * the wallet's red screen as our fault.
   *
   * The collection comes from the same read, and Core needs it: an asset in a
   * collection whose transfer names the placeholder instead is refused by the
   * program.
   */
  const asset = await chain.assetMetadata(parsed);
  if (!asset || !asset.owner) {
    return json(
      { error: "That asset could not be read on chain just now. Try again in a moment." },
      { status: 409, headers: NO_STORE },
    );
  }
  if (!chain.sameAddress(asset.owner, raffle.sellerWallet)) {
    return json(
      {
        error:
          "This raffle's prize is no longer held by the wallet that listed it, so it cannot be " +
          "deposited. Nothing has been charged.",
        reason: "not_owner",
      },
      { status: 409, headers: NO_STORE },
    );
  }

  const intent = await buildListingDeposit({
    seller: raffle.sellerWallet,
    escrow: escrow.address,
    paymentWallet: payment.address,
    feeLamports: fee.amount,
    asset: raffle.prizeAsset,
    collection: asset.collection,
  });
  if (!intent.ok) {
    return json({ error: intent.message, reason: intent.reason }, { status: 409, headers: NO_STORE });
  }

  return json(
    { transaction: intent.base64Transaction, blockhash: intent.blockhash },
    { status: 200, headers: NO_STORE },
  );
}
