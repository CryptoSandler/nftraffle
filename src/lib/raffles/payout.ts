import { feeAmount } from "../payments/config";
import type { NativeTransferResult } from "../payments/native-transfer";
import type { EscrowTransfer } from "./escrow";

/**
 * What a finished raffle owes, and whether it was really paid.
 *
 * **Payouts are performed by a human and verified by this module** (spec §0.5).
 * That split is the whole design: the server holds no private key, so it cannot
 * send anything — but the public raffle page shows a "paid" mark to the person
 * who did NOT send the transfers, and a mark that nothing checked is the
 * product asserting something on an operator's unverified word.
 *
 * The temptation to skip this is specific and worth naming: the operator is us,
 * and we know we sent it. The page is read by somebody who does not.
 *
 * WHO CALLS THIS: `payoutSplit` from the admin payout queue, the raffle page,
 * and the seller's create screen (which shows the floor before they list);
 * `verifyPayout` from `POST /api/admin/raffles/[id]/paid`, which hands its
 * verdict to `lifecycle.recordPayout`.
 */

export type PayoutSplit = {
  grossNative: bigint;
  houseFeeNative: bigint;
  sellerNetNative: bigint;
};

/**
 * The arithmetic, in one place, so every screen that quotes a figure quotes the
 * same one.
 *
 * **The rounding remainder always goes to the seller.** `feeAmount` rounds down
 * and the net is the subtraction rather than a second percentage calculation, so
 * the two halves add back to the gross exactly — no unit is created and none
 * goes missing, on either chain. Computing the net independently would let
 * rounding produce a total that does not match what was collected, which is the
 * kind of discrepancy nobody notices until somebody reconciles a wallet.
 */
export function payoutSplit(input: {
  ticketPriceNative: bigint;
  ticketsSold: number;
  houseFeeBps: number;
}): PayoutSplit {
  const grossNative = input.ticketPriceNative * BigInt(input.ticketsSold);
  const houseFeeNative = feeAmount(grossNative, input.houseFeeBps);
  return {
    grossNative,
    houseFeeNative,
    sellerNetNative: grossNative - houseFeeNative,
  };
}

export type PayoutFailure =
  | "not_found"
  | "failed_on_chain"
  | "no_transfer"
  | "rpc_unavailable"
  | "prize_wrong_mint"
  | "prize_wrong_source"
  | "prize_wrong_recipient"
  | string;

export type PayoutResult =
  | { ok: true }
  | { ok: false; reason: PayoutFailure; message: string };

/**
 * Both legs of a manual payout, checked against the chain.
 *
 * **The prize leg is checked first**, and the order is not incidental: the
 * prize is somebody else's property and the proceeds are money we collected.
 * An operator who sent the asset to the wrong wallet needs to hear that before
 * anything else, because it is the leg that cannot be undone.
 *
 * A zero net skips the proceeds leg entirely. A raffle that sold nothing owes
 * the seller nothing, and demanding a zero-value transfer as evidence would
 * block the one payout that legitimately has only a prize leg — returning the
 * asset to the seller.
 */
export async function verifyPayout(input: {
  prizeSignature: string;
  proceedsSignature: string;
  prizeAsset: string;
  escrowWallet: string;
  winnerWallet: string;
  sellerWallet: string;
  sellerNetNative: bigint;
  /** The chain's own address comparison — see `ChainAdapter.sameAddress`. */
  sameAddress: (a: string | null | undefined, b: string | null | undefined) => boolean;
  readPrizeTransfer: (signature: string) => Promise<EscrowTransfer>;
  verifyProceeds: (input: {
    signature: string;
    recipient: string;
    minAmount: bigint;
  }) => Promise<NativeTransferResult>;
}): Promise<PayoutResult> {
  const prize = await input.readPrizeTransfer(input.prizeSignature);
  if (!prize.ok) {
    return {
      ok: false,
      reason: prize.reason,
      message: "That prize transfer could not be read on chain.",
    };
  }

  if (prize.asset !== input.prizeAsset) {
    return {
      ok: false,
      reason: "prize_wrong_mint",
      message: "That transaction moved a different asset from this raffle's prize.",
    };
  }

  if (!input.sameAddress(prize.from, input.escrowWallet)) {
    // A transfer of the right asset to the right winner that did not come out
    // of escrow means the asset in escrow is still there, unaccounted for.
    return {
      ok: false,
      reason: "prize_wrong_source",
      message: "That transfer did not come out of the escrow wallet.",
    };
  }

  if (!input.sameAddress(prize.to, input.winnerWallet)) {
    return {
      ok: false,
      reason: "prize_wrong_recipient",
      message: "That transfer did not send the prize to this raffle's winner.",
    };
  }

  if (input.sellerNetNative === 0n) return { ok: true };

  const proceeds = await input.verifyProceeds({
    signature: input.proceedsSignature,
    recipient: input.sellerWallet,
    minAmount: input.sellerNetNative,
  });
  if (!proceeds.ok) return { ok: false, reason: proceeds.reason, message: proceeds.message };

  return { ok: true };
}
