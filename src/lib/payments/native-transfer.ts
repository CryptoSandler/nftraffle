/**
 * The verdict shape every chain's native-transfer verifier returns.
 *
 * Extracted from what was `payments/sol-transfer.ts` when the second chain
 * arrived. **The failure vocabulary is shared deliberately**: `raffles/tickets.ts`
 * branches on these reasons to decide whether an order may be retried and
 * whether real money arrived that has to be filed, and those two decisions are
 * product rules rather than chain facts. A per-chain reason list would mean two
 * copies of "which failures are worth retrying", and the copies would drift.
 *
 * WHO CALLS THIS: the two adapter implementations produce these
 * (`chain/solana/transfer.ts`, `chain/robinhood/transfer.ts`); `raffles/tickets.ts`,
 * `raffles/escrow.ts` and `raffles/payout.ts` consume them without knowing which
 * chain answered.
 */

export type NativeTransferFailure =
  /** The chain does not have this transaction yet. Transient — worth retrying. */
  | "not_found"
  /** It exists and reverted or failed. Nothing moved, however it looks. */
  | "failed_on_chain"
  /** Confirmed but carries no timestamp, so it cannot be placed in any window. */
  | "no_block_time"
  /** Nothing reached the recipient. */
  | "no_transfer"
  /** Something reached the recipient, but less than was due. */
  | "insufficient_amount"
  /** Outside the caller's explicit window. */
  | "outside_window"
  /** Older than the blanket age bound, for callers with no window of their own. */
  | "too_old"
  /** Paid, but not from the wallet this was started with. */
  | "wrong_payer"
  /** We could not reach a node. Distinct from every verdict above. */
  | "rpc_unavailable";

export type NativeTransferResult =
  | {
      ok: true;
      /** Derived from the chain, never claimed by the caller. */
      payer: string;
      /** In the chain's smallest unit. The adapter knows the scale; nothing else does. */
      amount: bigint;
      blockTimeMs: number;
    }
  | { ok: false; reason: NativeTransferFailure; message: string };

/**
 * How far back a transfer may be and still pay for something, when the caller
 * has no window of its own.
 *
 * A listing fee and a launch fee are not tied to an order with its own window,
 * so without this any historical transfer to the receiving wallet could be
 * presented as payment. A day is generous for somebody who paid and closed the
 * tab, and short enough that the pool of reusable transfers stays small.
 *
 * A transfer is claimed exactly once regardless of this — `consumed_signatures`
 * is a primary key — so this bounds WHICH transfers are eligible, not how many
 * times one counts.
 *
 * Chain-neutral: it is a product rule about staleness, not a property of any
 * chain. Ticket orders do not use it; they carry their own tighter window.
 */
export const UNBOUND_TRANSFER_MAX_AGE_HOURS = 24;

/**
 * The window and payer checks, shared by every chain.
 *
 * **These are the two rules that stop a payment being a bearer instrument**, and
 * they are here rather than in each adapter so there is one copy:
 *
 *  - Without the WINDOW check, a transfer made before the order existed could
 *    pay for it, and any unspent historical transfer to our wallet becomes
 *    claimable by whoever quotes it first.
 *  - Without the PAYER check, anyone watching the chain can take a stranger's
 *    transfer and claim it against their own order.
 *
 * Adapters call this after they have read the transfer off the chain, so the
 * per-chain code stays "what does the receipt say" and the judgement stays here.
 */
export function checkWindowAndPayer(input: {
  payer: string;
  blockTimeMs: number;
  nowMs: number;
  skewSeconds: number;
  expectedPayer?: string | null;
  window?: { fromMs: number; toMs: number };
}): { ok: true } | { ok: false; reason: NativeTransferFailure; message: string } {
  const skewMs = input.skewSeconds * 1000;

  // Skew in both directions: our clock and the chain's are not the same clock,
  // and a transfer landing a second either side of a boundary is not the fraud
  // this check is looking for.
  if (input.window) {
    if (
      input.blockTimeMs < input.window.fromMs - skewMs ||
      input.blockTimeMs > input.window.toMs + skewMs
    ) {
      return {
        ok: false,
        reason: "outside_window",
        message:
          "That transaction was not made during this order. Pay after starting it — a transfer " +
          "from before the order existed cannot be used to claim it.",
      };
    }
  } else {
    const ageMs = input.nowMs - input.blockTimeMs;
    if (ageMs > UNBOUND_TRANSFER_MAX_AGE_HOURS * 3_600_000 || ageMs < -skewMs) {
      return {
        ok: false,
        reason: "too_old",
        message: "That transfer is too old to be used here. Send a new one.",
      };
    }
  }

  /**
   * Gated on PRESENCE, not on truthiness. `if (expectedPayer)` reads tidier and
   * is wrong: it treats an empty string the same as "no binding requested" and
   * skips the check entirely — not "no match found" but "no check performed",
   * which is a false pass on exactly the thing this exists to catch. A present
   * but blank value flows into the comparison, can never equal a real address,
   * and fails closed.
   */
  if (input.expectedPayer !== undefined && input.expectedPayer !== null) {
    if (input.payer !== input.expectedPayer.trim()) {
      return {
        ok: false,
        reason: "wrong_payer",
        message: "That transaction was not paid from the wallet this was started with.",
      };
    }
  }

  return { ok: true };
}
