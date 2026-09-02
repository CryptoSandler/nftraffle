/**
 * Building the seller's listing transaction on the server, and refusing to hand
 * it over if it would fail.
 *
 * The mirror of `payment-intent.ts` for the other side of the product: that one
 * joins `payment-tx.ts` to `preflight.ts` for a ticket buyer, this one joins
 * `listing-tx.ts` to the same preflight for a seller. Kept separate for the
 * reason that file gives — it needs a network AND produces something a browser
 * receives — and the preflight itself is shared, because "would this transaction
 * fail in the wallet" is one question with one answer.
 *
 * **The transaction has exactly ONE signer: the seller.** They pay the fee, they
 * own the asset, and Core's `authority` slot is left unset because an owner
 * transferring their own asset signs as the payer. Nothing here could produce a
 * second signature: this repository holds no private key (CLAUDE.md).
 *
 * WHO CALLS THIS: `POST /api/raffles/[slug]/deposit`.
 */

import { compileTransaction, getBase64EncodedWireTransaction } from "@solana/kit";
import { buildListingDepositMessage } from "./listing-tx";
import { preflightPayment, type PreflightRefusal } from "./preflight";
import { primaryEndpoint, rpcCall } from "./rpc";

export type ListingIntent =
  | { ok: true; base64Transaction: string; feeLamports: bigint; blockhash: string }
  | { ok: false; reason: PreflightRefusal; message: string };

export async function buildListingDeposit(input: {
  seller: string;
  escrow: string;
  paymentWallet: string;
  feeLamports: bigint;
  asset: string;
  collection: string | null;
}): Promise<ListingIntent> {
  let blockhash: string;
  let lastValidBlockHeight: bigint;
  try {
    const response = await rpcCall(primaryEndpoint(), "getLatestBlockhash", [
      { commitment: "confirmed" },
    ]);
    const value = (response as { value?: { blockhash?: unknown; lastValidBlockHeight?: unknown } } | null)
      ?.value;
    if (typeof value?.blockhash !== "string") throw new Error("no blockhash");
    blockhash = value.blockhash;
    lastValidBlockHeight =
      typeof value.lastValidBlockHeight === "number" ? BigInt(value.lastValidBlockHeight) : 0n;
  } catch {
    return {
      ok: false,
      reason: "rpc_unavailable",
      message: "The network could not be reached just now. Nothing has been charged.",
    };
  }

  let base64Transaction: string;
  let base64Message: string;
  try {
    const compiled = compileTransaction(
      buildListingDepositMessage({ ...input, blockhash, lastValidBlockHeight }),
    );
    base64Transaction = getBase64EncodedWireTransaction(compiled);
    // `getFeeForMessage` takes the MESSAGE, not the wire transaction: the wrong
    // one returns null rather than an error, which is a failure shaped exactly
    // like a working check.
    base64Message = Buffer.from(compiled.messageBytes).toString("base64");
  } catch {
    return {
      ok: false,
      reason: "simulation_failed",
      message: "This listing could not be prepared. Check the asset and try again.",
    };
  }

  const verdict = await preflightPayment({
    payer: input.seller,
    // The fee is the only lamport amount the seller parts with; the asset moves
    // no balance. An affordability check that added the prize's value would
    // refuse sellers who can pay perfectly well.
    amountLamports: input.feeLamports,
    base64Transaction,
    base64Message,
  });
  if (!verdict.ok) return verdict;

  return { ok: true, base64Transaction, feeLamports: verdict.feeLamports, blockhash };
}
