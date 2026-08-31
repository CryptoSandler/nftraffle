import { describe, expect, it } from "vitest";
import { checkoutOutcome, isRetryableConfirmReason, walletErrorMessage } from "../checkout";

/**
 * The decisions the buy panel makes, taken out of the buy panel.
 *
 * A component that owns a wallet connection, a signature and four phases of
 * local state cannot be asserted about from Node. These functions can, and they
 * are the ones where being wrong costs somebody money — so they live here and
 * the component only renders what they return.
 */

describe("isRetryableConfirmReason", () => {
  it("retries only what can change on its own", () => {
    // A transaction the chain has not seen yet, a block with no timestamp yet,
    // an unreachable node. All three become true by waiting.
    expect(isRetryableConfirmReason("not_found")).toBe(true);
    expect(isRetryableConfirmReason("no_block_time")).toBe(true);
    expect(isRetryableConfirmReason("rpc_unavailable")).toBe(true);
  });

  it("does not retry a verdict that will still be true in five seconds", () => {
    /**
     * Every attempt spends the order's verification quota — ten per order per
     * ten minutes. A retry loop on a permanent failure burns the budget the
     * payer needs for the attempt that would have worked, and then they cannot
     * confirm a payment they really made.
     */
    for (const reason of [
      "wrong_payer",
      "insufficient_amount",
      "outside_window",
      "failed_on_chain",
      "no_transfer",
      "too_old",
      "signature_reused",
      "already_settled",
      "expired",
      "sold_out",
    ]) {
      expect(isRetryableConfirmReason(reason), reason).toBe(false);
    }
  });

  it("does not retry something it does not recognise", () => {
    // Fails closed. An unknown reason is not evidence that waiting helps.
    expect(isRetryableConfirmReason("something_new")).toBe(false);
    expect(isRetryableConfirmReason(undefined)).toBe(false);
    expect(isRetryableConfirmReason(null)).toBe(false);
  });
});

describe("checkoutOutcome", () => {
  /**
   * THE ONE MESSAGE THIS FLOW MUST NEVER PRODUCE is "your payment failed" to
   * somebody whose payment succeeded. Two different failures look identical
   * from the client, and telling them apart is this function's whole job.
   */

  it("reports success when a reused signature belongs to this very order", () => {
    // The benign case: a dropped response to a confirm that actually settled,
    // so the retry posted a signature the server had already spent — on this
    // order. The tickets exist. Saying "failed" would send somebody to support
    // over a purchase that worked.
    expect(
      checkoutOutcome({
        failure: { reason: "signature_reused", message: "already used" },
        orderStatus: "paid",
      }),
    ).toEqual({ kind: "paid" });
  });

  it("does NOT report success when the signature was spent on a different order", () => {
    // Same reason code, opposite meaning: this payer's money paid for somebody
    // else's order, or their own earlier one. The order is not paid, so there
    // is nothing to celebrate and something to report.
    expect(
      checkoutOutcome({
        failure: { reason: "signature_reused", message: "already used" },
        orderStatus: "pending",
      }),
    ).toEqual({ kind: "error", message: "already used" });
  });

  it("does not report success on a reused signature when the status is unknown", () => {
    // Fails closed. "We could not read the order" is not "the order is paid".
    expect(
      checkoutOutcome({
        failure: { reason: "signature_reused", message: "already used" },
        orderStatus: null,
      }),
    ).toMatchObject({ kind: "error" });
  });

  it("keeps the server's own message for every other failure", () => {
    // The server wrote a sentence for the payer. Replacing it with a generic
    // one loses the only information they can act on.
    expect(
      checkoutOutcome({
        failure: { reason: "wrong_payer", message: "That was not paid from this wallet." },
        orderStatus: "pending",
      }),
    ).toEqual({ kind: "error", message: "That was not paid from this wallet." });
  });

  it("reports money that arrived but could not be applied as its own outcome", () => {
    /**
     * `sold_out` means a real payment reached the wallet after the last ticket
     * went. It is filed to `unmatched_payments` and refunded by hand. This must
     * not read as an ordinary failure — the payer's money is gone and there is
     * something they need to know.
     */
    expect(
      checkoutOutcome({
        failure: { reason: "sold_out", message: "This raffle sold out before your payment confirmed." },
        orderStatus: "failed",
      }),
    ).toEqual({
      kind: "filed",
      message: "This raffle sold out before your payment confirmed.",
    });
  });
});

describe("walletErrorMessage", () => {
  it("turns a rejection into a sentence, not a stack trace", () => {
    expect(walletErrorMessage(new Error("User rejected the request"))).toMatch(/dismissed/i);
    expect(walletErrorMessage(new Error("Transaction cancelled by user"))).toMatch(/dismissed/i);
  });

  it("recognises an underfunded wallet behind a program error code", () => {
    // `custom program error: 0x1` is what a preflight returns when the payer
    // cannot cover the transfer. DESIGN.md §8.3 rules out showing that string.
    const message = walletErrorMessage(
      new Error("Transaction simulation failed: ... custom program error: 0x1"),
    );
    expect(message).toMatch(/enough SOL/i);
    expect(message).not.toMatch(/0x1|simulation|program error/i);
  });

  it("never leaks a developer string, whatever the error was", () => {
    for (const error of [
      new Error("Unexpected error [object Object] at 0xdeadbeef"),
      "some string",
      null,
      undefined,
      { weird: true },
    ]) {
      const message = walletErrorMessage(error);
      expect(message).not.toMatch(/0x|object Object|undefined|null/);
      expect(message.length).toBeGreaterThan(10);
    }
  });
});
