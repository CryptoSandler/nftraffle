import type { NativeTransferResult } from "../../payments/native-transfer";
import type { EscrowTransfer } from "../../raffles/escrow";
import {
  ERC721_TRANSFER_TOPIC,
  addressFromTopic,
  formatErc721Asset,
  sameAddress,
  uintFromWord,
  type Erc721Asset,
} from "./erc721";

/**
 * Reading money and assets out of an EVM transaction.
 *
 * **Simpler than the Solana side, and the reason is worth stating**: a receipt
 * says `from`, `to`, `value` and `status` outright, and an ERC-721 movement is
 * an explicit `Transfer` event. The Solana verifier has to reconstruct a
 * transfer from positional balance deltas that include the network fee, and has
 * to re-check ownership because it does not decode instruction data. None of
 * that arises here.
 *
 * What does arise, and is the whole content of these functions, is the set of
 * cases where a receipt exists and does not mean what a careless reader would
 * take it to mean: a reverted transaction still has a `from`, a `to` and a
 * `value`; a batch transfer emits several events; and ERC-20 shares the
 * `Transfer` topic.
 *
 * Pure functions taking already-fetched RPC results, so they are drivable from
 * Node without a network — the same discipline `readSolTransfer` follows.
 *
 * WHO CALLS THIS: `chain/robinhood/index.ts`, which is the only thing that
 * constructs the Robinhood adapter.
 */

type Receipt = {
  status?: string;
  from?: string;
  to?: string | null;
  blockNumber?: string;
  logs?: { address?: string; topics?: string[] }[];
} | null;

type Transaction = { from?: string; to?: string | null; value?: string } | null;

/** `status` is `0x1` for success and `0x0` for a mined revert. */
function succeeded(receipt: NonNullable<Receipt>): boolean {
  return receipt.status === "0x1";
}

/**
 * The native value this transaction sent to `recipient`.
 *
 * `blockTimeSeconds` is passed in rather than read here, because it comes from
 * a separate `eth_getBlockByNumber` call and this function stays pure. `null`
 * means the block's timestamp could not be established, which is a refusal
 * rather than an assumption: a transfer whose age is unknown cannot be checked
 * against any window.
 */
export function readNativeTransfer(
  receipt: Receipt,
  transaction: Transaction,
  recipient: string,
  blockTimeSeconds: number | null,
): NativeTransferResult {
  if (!receipt || !transaction) {
    return { ok: false, reason: "not_found", message: "That transaction is not on chain yet." };
  }

  // A reverted transaction is mined, has a receipt, and names a from, a to and
  // a value. It moved nothing. Reading the transaction object alone would
  // credit it.
  if (!succeeded(receipt)) {
    return {
      ok: false,
      reason: "failed_on_chain",
      message: "That transaction failed on Robinhood Chain.",
    };
  }

  if (blockTimeSeconds === null) {
    return {
      ok: false,
      reason: "no_block_time",
      message: "That transaction has no timestamp on chain yet. Try again in a moment.",
    };
  }

  // Case-insensitive: EIP-55 checksummed addresses differ from lowercase ones
  // by case alone, and a case-sensitive comparison would refuse a real payment
  // depending on how the wallet spelled the destination.
  if (!sameAddress(transaction.to, recipient)) {
    return {
      ok: false,
      reason: "no_transfer",
      message: "That transaction did not send ETH to the expected wallet.",
    };
  }

  const value = uintFromWord(transaction.value ?? "0x0");
  if (value === null || value <= 0n) {
    // A contract call to our wallet is not a payment.
    return {
      ok: false,
      reason: "no_transfer",
      message: "That transaction did not send ETH to the expected wallet.",
    };
  }

  return {
    ok: true,
    payer: (transaction.from ?? "").toLowerCase(),
    amount: value,
    blockTimeMs: blockTimeSeconds * 1000,
  };
}

/**
 * The movement of one specific ERC-721 asset in this transaction.
 *
 * **Both halves of the identity are matched.** `tokenId` 42 exists in almost
 * every collection, so dropping the contract would be the most likely way to
 * accept the wrong asset — and a transaction can carry several `Transfer`
 * events, so matching the first would let a batch that moved something
 * worthless satisfy a check about something valuable.
 */
export function readErc721Transfer(
  receipt: Receipt,
  asset: Erc721Asset,
  blockTimeSeconds: number | null,
): EscrowTransfer {
  if (!receipt) return { ok: false, reason: "not_found" };
  if (!succeeded(receipt)) return { ok: false, reason: "failed_on_chain" };
  if (blockTimeSeconds === null) return { ok: false, reason: "not_found" };

  for (const log of receipt.logs ?? []) {
    const topics = log.topics ?? [];
    // FOUR topics, not three. ERC-20 shares this signature and leaves its value
    // unindexed, so it carries three; ERC-721 indexes the tokenId and carries
    // four. Matching topic zero alone would read a token movement as an NFT
    // transfer.
    if (topics.length !== 4 || topics[0] !== ERC721_TRANSFER_TOPIC) continue;
    if (!sameAddress(log.address, asset.contract)) continue;

    const tokenId = uintFromWord(topics[3]);
    if (tokenId === null || tokenId !== asset.tokenId) continue;

    const from = addressFromTopic(topics[1]);
    const to = addressFromTopic(topics[2]);
    if (!from || !to) continue;

    return {
      ok: true,
      asset: formatErc721Asset(asset),
      from,
      to,
      blockTimeMs: blockTimeSeconds * 1000,
    };
  }

  return { ok: false, reason: "no_transfer" };
}
