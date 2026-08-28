import { requireAdmin } from "../../../../../../lib/admin-guard";
import { fetchTransaction } from "../../../../../../lib/chain/rpc";
import { json, NO_STORE, refuseForeignOrigin } from "../../../../../../lib/http";
import { escrowWallet, rpcConfigured } from "../../../../../../lib/payments/config";
import { isSignatureShaped } from "../../../../../../lib/payments/signature";
import { verifySolTransfer } from "../../../../../../lib/payments/sol-transfer";
import { readAssetTransfer } from "../../../../../../lib/chain/asset-transfer";
import { raffleById, recordPayout } from "../../../../../../lib/raffles/lifecycle";
import { payoutSplit, verifyPayout } from "../../../../../../lib/raffles/payout";
import { ticketsSold } from "../../../../../../lib/raffles/tickets";

export const dynamic = "force-dynamic";

/**
 * Marks a payout paid — after checking, on chain, that it happened.
 *
 * **This is spec §0.5, and it is the route most tempting to skip.** The
 * operator is us; we know we sent it. But the public raffle page shows this
 * mark to the person who did NOT send the transfers, and it is the only thing
 * that person has. A mark nothing checked would be the product asserting
 * something on our own unverified word, which is precisely what a manual-payout
 * design cannot afford.
 *
 * So a wrong signature is REFUSED rather than stored with a warning. Storing it
 * would put a wrong claim on a public page and leave the correction to whoever
 * noticed.
 *
 * WHO CALLS THIS: the "Mark paid" form on `/admin`.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/admin/raffles/[id]/paid">,
): Promise<Response> {
  const foreign = refuseForeignOrigin(request);
  if (foreign) return foreign;

  const { id } = await context.params;
  const guard = await requireAdmin(request, `POST /api/admin/raffles/${id}/paid`);
  if (!guard.ok) return guard.response;

  if (!rpcConfigured()) {
    console.error(`POST /api/admin/raffles/${id}/paid: SOLANA_RPC_URL is not set.`);
    return json({ error: "No Solana connection is configured." }, { status: 503, headers: NO_STORE });
  }

  const escrow = escrowWallet();
  if (!escrow.ok) {
    console.error(`POST /api/admin/raffles/${id}/paid: ${escrow.reason}`);
    return json({ error: "No escrow wallet is configured." }, { status: 503, headers: NO_STORE });
  }

  const form = await request.formData();
  const prizeSignature = String(form.get("prizeSignature") ?? "").trim();
  const proceedsSignature = String(form.get("proceedsSignature") ?? "").trim();

  if (!isSignatureShaped(prizeSignature)) {
    return json({ error: "The prize signature is not a Solana transaction signature." }, { status: 400, headers: NO_STORE });
  }

  const raffle = await raffleById(id);
  if (!raffle) return json({ error: "No such raffle." }, { status: 404, headers: NO_STORE });
  if (raffle.status !== "drawn") {
    return json(
      { error: `This raffle is ${raffle.status}, so it cannot be marked paid.` },
      { status: 409, headers: NO_STORE },
    );
  }
  if (!raffle.winnerWallet) {
    // Unreachable while status is 'drawn' — migration 001's
    // `raffles_drawn_is_revealed` guarantees it — and kept rather than asserted
    // away, because this value decides who is recorded as having been paid.
    return json({ error: "This raffle has no winner recorded." }, { status: 409, headers: NO_STORE });
  }

  const split = payoutSplit({
    ticketPriceLamports: raffle.ticketPriceLamports,
    ticketsSold: await ticketsSold(raffle.id),
    houseFeeBps: raffle.houseFeeBps,
  });

  // The proceeds leg is only demanded when there is something to pay. A raffle
  // that sold nothing owes the seller nothing, and a zero net has only a prize
  // leg — returning the asset.
  if (split.sellerNetLamports > 0n && !isSignatureShaped(proceedsSignature)) {
    return json(
      { error: "The proceeds signature is not a Solana transaction signature." },
      { status: 400, headers: NO_STORE },
    );
  }

  const verdict = await verifyPayout({
    prizeSignature,
    proceedsSignature,
    prizeMint: raffle.prizeMint,
    escrowWallet: escrow.address,
    winnerWallet: raffle.winnerWallet,
    sellerWallet: raffle.sellerWallet,
    sellerNetLamports: split.sellerNetLamports,
    readPrizeTransfer: (signature) => readAssetTransfer(signature, raffle.prizeMint),
    verifyProceeds: (input) =>
      verifySolTransfer({
        signature: input.signature,
        recipient: input.recipient,
        minLamports: input.minLamports,
        fetchTransaction,
      }),
  });

  if (!verdict.ok) {
    return json({ error: verdict.message, reason: verdict.reason }, { status: 409, headers: NO_STORE });
  }

  const result = await recordPayout(raffle.id, { prizeSignature, proceedsSignature });
  if (!result.ok) {
    return json({ error: `Could not record the payout: ${result.reason}.` }, { status: 409, headers: NO_STORE });
  }

  return new Response(null, { status: 303, headers: { location: "/admin", ...NO_STORE } });
}
