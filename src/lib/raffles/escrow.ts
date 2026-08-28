import { BLOCKTIME_SKEW_SECONDS } from "../payments/config";
import type { SolTransferResult } from "../payments/sol-transfer";

/**
 * Whether a raffle's prize is really in escrow, and whether its listing fee was
 * really paid.
 *
 * **This is the check that decides whether a raffle may take money from
 * strangers**, so it is written from the assumption that the seller is lying
 * about every input. A raffle that opens without its prize in escrow is the
 * worst outcome this product has: people paying for tickets to win something
 * nobody holds.
 *
 * WHO CALLS THIS: `POST /api/raffles/[slug]/publish`, and nothing else. It
 * hands both verdicts to `lifecycle.openRaffle`, which owns the transition and
 * knows nothing about Solana.
 *
 * WHY BOTH A TRANSFER AND AN OWNERSHIP CHECK, when either sounds sufficient:
 *
 *   - The TRANSFER says a deposit was made, by whom, of what, and when. It
 *     cannot say the asset is still there.
 *   - OWNERSHIP says the asset is there now. It cannot say who put it there or
 *     when, so on its own it would accept a raffle published against somebody
 *     else's deposit.
 *
 * The gap between them is the deposit-and-withdraw: deposit, capture the
 * signature, withdraw, publish. The transfer really happened and the asset is
 * gone. Only asking both questions closes it.
 */

/** The transfer-reading failures, restated as sentences a seller can act on. */
type ReadFailure = "not_found" | "failed_on_chain" | "no_transfer" | "rpc_unavailable";

export type EscrowTransfer =
  | { ok: true; mint: string; from: string; to: string; blockTimeMs: number }
  | { ok: false; reason: ReadFailure };

export type EscrowFailure =
  | "not_found"
  | "failed_on_chain"
  | "no_transfer"
  | "rpc_unavailable"
  | "wrong_mint"
  | "wrong_destination"
  | "wrong_sender"
  | "predates_draft"
  | "not_in_escrow"
  | "ownership_unknown";

export type EscrowResult =
  | { ok: true; blockTimeMs: number }
  | { ok: false; reason: EscrowFailure; message: string };

export async function verifyEscrowDeposit(input: {
  signature: string;
  prizeMint: string;
  sellerWallet: string;
  escrowWallet: string;
  /** The draft this deposit must have been made for. */
  draftCreatedAt: Date;
  /** Who owns the mint right now, from DAS. `null` means we could not tell. */
  currentOwner: (mint: string) => Promise<string | null>;
  /** What this signature actually moved. */
  readTransfer: (signature: string) => Promise<EscrowTransfer>;
}): Promise<EscrowResult> {
  const transfer = await input.readTransfer(input.signature);
  if (!transfer.ok) {
    return { ok: false, reason: transfer.reason, message: FAILURE_MESSAGES[transfer.reason] };
  }

  if (transfer.mint !== input.prizeMint) {
    return {
      ok: false,
      reason: "wrong_mint",
      message: "That transaction moved a different asset from the one this raffle names.",
    };
  }

  if (transfer.to !== input.escrowWallet) {
    return {
      ok: false,
      reason: "wrong_destination",
      message: "That transaction did not send the asset to this deployment's escrow wallet.",
    };
  }

  if (transfer.from !== input.sellerWallet) {
    return {
      ok: false,
      reason: "wrong_sender",
      message: "That deposit did not come from the wallet this raffle was started with.",
    };
  }

  // A transfer from before the draft existed cannot have been made for it.
  // Without this, one historical deposit could publish raffle after raffle.
  // Skew is allowed in the seller's favour for the usual reason: our clock and
  // the cluster's are not the same clock, and thirty seconds either side of a
  // boundary is not the fraud this check is looking for.
  const floorMs = input.draftCreatedAt.getTime() - BLOCKTIME_SKEW_SECONDS * 1000;
  if (transfer.blockTimeMs < floorMs) {
    return {
      ok: false,
      reason: "predates_draft",
      message:
        "That deposit was made before this raffle was started, so it cannot be the deposit for " +
        "it. Send the asset after starting the raffle.",
    };
  }

  // Asked LAST, and asked at all, because everything above proves a deposit
  // happened and none of it proves the asset is still there.
  const owner = await input.currentOwner(input.prizeMint);
  if (owner === null) {
    // Fails closed. An RPC that cannot answer leaves the deposit-and-withdraw
    // case undetectable, and "we could not check" must never publish a raffle.
    return {
      ok: false,
      reason: "ownership_unknown",
      message: "The asset's owner could not be read just now. Try again in a moment.",
    };
  }
  if (owner !== input.escrowWallet) {
    return {
      ok: false,
      reason: "not_in_escrow",
      message: "That asset is not in escrow. It has to stay there until the raffle is drawn.",
    };
  }

  return { ok: true, blockTimeMs: transfer.blockTimeMs };
}

const FAILURE_MESSAGES: Record<ReadFailure, string> = {
  not_found: "That transaction is not on chain yet.",
  failed_on_chain: "That transaction failed on Solana, so nothing was transferred.",
  no_transfer: "That transaction did not transfer an asset.",
  rpc_unavailable: "Could not read that transaction just now. Try again in a moment.",
};

// --- The listing fee ---------------------------------------------------------

export type ListingFeeResult =
  | { ok: true }
  | { ok: false; reason: string; message: string };

/**
 * Whether the listing fee was paid, by the seller.
 *
 * **Zero is handled without asking the chain anything.** A fee switches off
 * with a variable and no deploy, and a zero fee that still demanded a signature
 * would make "off" mean "still send me an empty transaction". This is the one
 * place that shortcut is taken and it is deliberate.
 *
 * The payer binding matters here for a reason beyond the usual: the listing fee
 * is antibot as much as it is revenue, and a fee anybody could pay on anybody's
 * behalf is not a cost to the person being metered.
 */
export async function verifyListingFee(input: {
  signature: string;
  sellerWallet: string;
  paymentWallet: string;
  feeLamports: bigint;
  verify: (input: {
    signature: string;
    recipient: string;
    minLamports: bigint;
    expectedPayer: string;
  }) => Promise<SolTransferResult>;
}): Promise<ListingFeeResult> {
  if (input.feeLamports === 0n) return { ok: true };

  const verdict = await input.verify({
    signature: input.signature,
    recipient: input.paymentWallet,
    minLamports: input.feeLamports,
    expectedPayer: input.sellerWallet,
  });

  if (!verdict.ok) return { ok: false, reason: verdict.reason, message: verdict.message };
  return { ok: true };
}
