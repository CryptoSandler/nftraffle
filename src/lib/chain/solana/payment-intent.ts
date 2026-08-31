/**
 * Building the ticket payment transaction on the server, and refusing to hand
 * it over if it would fail.
 *
 * **The join between `payment-tx.ts` (what the transaction is) and
 * `preflight.ts` (whether it can succeed).** Kept separate from both because it
 * is the only piece that needs a network AND produces something a browser
 * receives, and that combination deserves one obvious place to look.
 *
 * **The transaction has exactly ONE signer: the payer.** The fee payer is the
 * buyer, the transfer's source is the buyer, and the Solana Pay reference is
 * attached read-only and non-signer because nobody holds its private key —
 * generated, public half read out, private half discarded (SECURITY.md I1).
 * Nothing this server produces asks for a second signature, and nothing here
 * could sign one if it did.
 *
 * WHO CALLS THIS: `POST /api/raffles/[slug]/orders`.
 */

import { compileTransaction, getBase64EncodedWireTransaction } from "@solana/kit";
import { buildTicketPaymentMessage } from "./payment-tx";
import { preflightPayment, type PreflightRefusal } from "./preflight";
import { primaryEndpoint, rpcCall } from "./rpc";

export type PaymentIntent =
  | { ok: true; base64Transaction: string; feeLamports: bigint; blockhash: string }
  | { ok: false; reason: PreflightRefusal; message: string };

export async function buildSolanaPayment(input: {
  payer: string;
  payTo: string;
  amountLamports: bigint;
  reference: string | null;
}): Promise<PaymentIntent> {
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
      buildTicketPaymentMessage({
        payer: input.payer,
        payTo: input.payTo,
        amountLamports: input.amountLamports,
        reference: input.reference,
        blockhash,
        lastValidBlockHeight,
      }),
    );
    base64Transaction = getBase64EncodedWireTransaction(compiled);
    // `getFeeForMessage` takes the MESSAGE, not the wire transaction. Passing
    // the wrong one returns null rather than an error — a failure shaped exactly
    // like a working check.
    base64Message = Buffer.from(compiled.messageBytes).toString("base64");
  } catch {
    // A malformed address reaches `address()` inside the builder and throws.
    // That is a bad request, not a chain problem, and it must not be reported
    // as one.
    return {
      ok: false,
      reason: "simulation_failed",
      message: "That payment could not be prepared. Check the wallet address and try again.",
    };
  }

  const verdict = await preflightPayment({
    payer: input.payer,
    amountLamports: input.amountLamports,
    base64Transaction,
    base64Message,
  });
  if (!verdict.ok) return verdict;

  return { ok: true, base64Transaction, feeLamports: verdict.feeLamports, blockhash };
}
