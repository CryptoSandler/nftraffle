import { readAssetTransfer } from "../../../../../lib/chain/asset-transfer";
import { assetOwner } from "../../../../../lib/chain/das";
import { fetchTransaction } from "../../../../../lib/chain/rpc";
import { json, NO_STORE, refuseForeignOrigin } from "../../../../../lib/http";
import { escrowWallet, paymentWallet, raffleListingFee } from "../../../../../lib/payments/config";
import { isSignatureShaped } from "../../../../../lib/payments/signature";
import { verifySolTransfer } from "../../../../../lib/payments/sol-transfer";
import { verifyEscrowDeposit, verifyListingFee } from "../../../../../lib/raffles/escrow";
import { openRaffle, raffleBySlug } from "../../../../../lib/raffles/lifecycle";
import { surfaceRefusal } from "../../../../../lib/surfaces";

export const dynamic = "force-dynamic";

/**
 * Publishes a draft, once the chain agrees the prize is in escrow and the
 * listing fee was paid.
 *
 * **This is the gate on the worst outcome this product has** — a raffle taking
 * money from strangers for a prize nobody deposited. Every check that decides
 * it lives in `raffles/escrow.ts`, which is written from the assumption that
 * the seller is lying about every input; this route wires that verdict to the
 * transition and does no judging of its own.
 *
 * Deliberately NOT admin-gated: the seller publishes their own raffle. What
 * makes that safe is that nothing here is taken on the seller's word — the
 * mint, the sender, the destination, the timing and the current owner are all
 * read off the chain.
 *
 * WHO CALLS THIS: the listing flow on `/raffle/new`, after the seller has sent
 * the asset and paid the fee.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/raffles/[slug]/publish">,
): Promise<Response> {
  const foreign = refuseForeignOrigin(request);
  if (foreign) return foreign;

  const { slug } = await context.params;

  const closed = surfaceRefusal("list_raffle", `POST /api/raffles/${slug}/publish`);
  if (closed) return json({ error: closed.message }, { status: 503, headers: NO_STORE });

  const escrow = escrowWallet();
  const payment = paymentWallet();
  const fee = raffleListingFee();
  if (!escrow.ok || !payment.ok || !fee.ok) {
    console.error(`POST /api/raffles/${slug}/publish: configuration incomplete.`);
    return json({ error: "Listing is not available right now." }, { status: 503, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON." }, { status: 400, headers: NO_STORE });
  }

  const { escrowSignature, listingFeeSignature } = (body ?? {}) as Record<string, unknown>;
  if (typeof escrowSignature !== "string" || !isSignatureShaped(escrowSignature)) {
    return json(
      { error: "escrowSignature must be a Solana transaction signature." },
      { status: 400, headers: NO_STORE },
    );
  }
  // The fee signature is only demanded when there is a fee. Zero is the door:
  // a fee switches off with a variable, and a zero fee that still required a
  // signature would make "off" mean "still send me an empty transaction".
  if (fee.lamports > 0n && (typeof listingFeeSignature !== "string" || !isSignatureShaped(listingFeeSignature))) {
    return json(
      { error: "listingFeeSignature must be a Solana transaction signature." },
      { status: 400, headers: NO_STORE },
    );
  }

  const raffle = await raffleBySlug(slug);
  if (!raffle) return json({ error: "No such raffle." }, { status: 404, headers: NO_STORE });
  if (raffle.status !== "draft") {
    return json(
      { error: `This raffle is ${raffle.status}, so it cannot be published.` },
      { status: 409, headers: NO_STORE },
    );
  }

  // The fee first: it is the cheaper of the two checks and it is the one a
  // seller is most likely to have got wrong by paying from the wrong wallet.
  const feeVerdict = await verifyListingFee({
    signature: typeof listingFeeSignature === "string" ? listingFeeSignature : "",
    sellerWallet: raffle.sellerWallet,
    paymentWallet: payment.address,
    feeLamports: fee.lamports,
    verify: (input) =>
      verifySolTransfer({
        signature: input.signature,
        recipient: input.recipient,
        minLamports: input.minLamports,
        expectedPayer: input.expectedPayer,
        fetchTransaction,
      }),
  });
  if (!feeVerdict.ok) {
    return json({ error: feeVerdict.message, reason: feeVerdict.reason }, { status: 409, headers: NO_STORE });
  }

  const escrowVerdict = await verifyEscrowDeposit({
    signature: escrowSignature,
    prizeMint: raffle.prizeMint,
    sellerWallet: raffle.sellerWallet,
    escrowWallet: escrow.address,
    draftCreatedAt: raffle.createdAt,
    currentOwner: assetOwner,
    readTransfer: (signature) => readAssetTransfer(signature, raffle.prizeMint),
  });
  if (!escrowVerdict.ok) {
    return json({ error: escrowVerdict.message, reason: escrowVerdict.reason }, { status: 409, headers: NO_STORE });
  }

  const opened = await openRaffle(raffle.id, {
    listingFeeSignature: typeof listingFeeSignature === "string" ? listingFeeSignature : `nofee-${raffle.id}`,
    escrowSignature,
  });
  if (!opened.ok) {
    return json({ error: `Could not publish: ${opened.reason}.`, reason: opened.reason }, { status: 409, headers: NO_STORE });
  }

  return json({ slug: opened.raffle.slug, status: opened.raffle.status }, { status: 200, headers: NO_STORE });
}
