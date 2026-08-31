/**
 * The decisions the buy panel makes, taken out of the buy panel.
 *
 * A component that owns a wallet connection, a signature and four phases of
 * local state cannot be asserted about from Node. Everything here is a pure
 * answer to a question the checkout asks at a moment where being wrong costs
 * somebody real money — so it lives where a test can reach it rather than
 * inside the component.
 *
 * Deliberately no testing-library and no jsdom. Rendering the component would
 * test React; what needs testing is the reasoning, and the reasoning is here.
 *
 * WHO CALLS THIS: `src/components/BuyTickets.tsx`, and nothing else.
 */

/**
 * Whether a failed `/confirm` is worth trying again.
 *
 * **Only reasons that can change on their own.** A wrong amount or a wrong payer
 * will still be wrong in five seconds, and every attempt spends the order's
 * verification quota — `VERIFY_LIMITS` caps attempts per order and per caller,
 * so a retry loop on a permanent failure burns the budget the payer needs for
 * the attempt that would have worked.
 *
 * This list must agree with `RETRYABLE` in `raffles/tickets.ts`, which decides
 * whether the ORDER stays pending. If they disagree, the client retries an order
 * the server already failed, or gives up on one the server left open.
 *
 * Fails closed on anything unrecognised: an unknown reason is not evidence that
 * waiting helps.
 */
const RETRYABLE: ReadonlySet<string> = new Set([
  "not_found",
  "no_block_time",
  "rpc_unavailable",
]);

export function isRetryableConfirmReason(reason: unknown): boolean {
  return typeof reason === "string" && RETRYABLE.has(reason);
}

export type ConfirmFailure = { reason?: string; message: string };

export type CheckoutOutcome =
  | { kind: "paid" }
  /** Real money arrived and could not be applied. Filed, and refunded by hand. */
  | { kind: "filed"; message: string }
  | { kind: "error"; message: string };

/**
 * What to show a payer whose `/confirm` came back a failure.
 *
 * **THE ONE MESSAGE THIS FLOW MUST NEVER PRODUCE is "your payment failed" to
 * somebody whose payment succeeded**, and there are two different failures that
 * both look like it from the client. Telling them apart is this function's whole
 * job.
 *
 * `signature_reused` means the server has already claimed this signature. The
 * usual cause is benign: a dropped response to a `/confirm` that actually
 * settled, so the retry posted a signature the server had already spent. If the
 * order reads `paid`, that payer's money IS accounted for and the screen should
 * say so.
 *
 * The same code with the order NOT paid means the opposite: this signature was
 * spent on a different order. The payer's money went somewhere and their order
 * is still open, which is a real problem they need to hear about.
 *
 * A null status is treated as the second case. "We could not read the order" is
 * not "the order is paid", and guessing in the cheerful direction is exactly the
 * failure this function exists to prevent.
 */
export function checkoutOutcome(input: {
  failure: ConfirmFailure;
  /** The order's own status, as `GET /api/orders/[id]` reports it. */
  orderStatus: string | null;
}): CheckoutOutcome {
  const { failure, orderStatus } = input;

  if (failure.reason === "signature_reused" && orderStatus === "paid") {
    return { kind: "paid" };
  }

  /**
   * Money reached the wallet and no ticket could be issued — the raffle sold
   * out while this payment was in flight. It is recorded in
   * `unmatched_payments` and refunded by hand.
   *
   * Its own outcome rather than an ordinary error, because the payer is out of
   * pocket and the screen has to say so plainly instead of looking like a
   * failed purchase they can retry.
   */
  if (failure.reason === "sold_out") {
    return { kind: "filed", message: failure.message };
  }

  return { kind: "error", message: failure.message };
}

/**
 * A wallet's own failure, as a sentence.
 *
 * Wallet errors are developer strings — `Transaction simulation failed: Error
 * processing Instruction 1: custom program error: 0x1` is what an underfunded
 * payer gets from a preflight — and DESIGN.md §8.3 rules that out. The detail
 * still goes to the console, where it is useful; it just does not go on screen
 * as the explanation.
 */
export function walletErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";

  if (/reject|denied|cancel/i.test(raw)) return "You dismissed the payment in your wallet.";
  if (/insufficient|0x1\b/i.test(raw)) {
    return "The payment did not go through. Check the wallet holds enough SOL for the tickets and the network fee.";
  }
  return "Your wallet could not send this payment. Try again in a moment.";
}
