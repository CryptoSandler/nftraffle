import { formatNative } from "../../payments/config";
import type { AssetMetadata, AssetRef, ChainAdapter } from "../adapter";
import { checkWindowAndPayer } from "../../payments/native-transfer";
import {
  EVM_DECIMALS,
  ROBINHOOD_BLOCKTIME_SKEW_SECONDS,
} from "./constants";
import {
  OWNER_OF_SELECTOR,
  encodeUint256,
  formatErc721Asset,
  parseErc721Asset,
  sameAddress,
  type Erc721Asset,
} from "./erc721";
import { blockAtHeight, blockTimestampSeconds, currentBlockHeight, evmCall } from "./rpc";
import { findBlockAtOrAfter } from "../anchor";

import { readErc721Transfer, readNativeTransfer } from "./transfer";

/**
 * The Robinhood Chain adapter.
 *
 * **Built and tested; its surface stays closed** until one real raffle has run
 * end to end on Solana (docs/decisions.md, the approved sequence). Nothing in
 * this file enforces that — `lib/surfaces.ts` does, so there is one place to
 * open rather than two.
 *
 * Chain facts verified against Robinhood's own documentation on 2026-08-31, and
 * the block time measured rather than taken from a third party — see
 * `constants.ts`, where the measurement and its date live next to the number
 * they justify.
 *
 * WHO CALLS THIS: `chain/registry.ts`, and nothing else.
 */

/** Every RPC read is wrapped so a node failure is never mistaken for a chain fact. */
async function receiptAndTx(txId: string) {
  const [receipt, transaction] = await Promise.all([
    evmCall("eth_getTransactionReceipt", [txId]),
    evmCall("eth_getTransactionByHash", [txId]),
  ]);
  return { receipt, transaction } as {
    receipt: { blockNumber?: string } | null;
    transaction: unknown;
  };
}

export const robinhoodAdapter: ChainAdapter = {
  id: "robinhood",
  nativeSymbol: "ETH",
  nativeDecimals: EVM_DECIMALS,
  blocktimeSkewSeconds: ROBINHOOD_BLOCKTIME_SKEW_SECONDS,

  isAddress: (value) => /^0x[0-9a-fA-F]{40}$/.test(value.trim()),
  isTxId: (value) => /^0x[0-9a-fA-F]{64}$/.test(value.trim()),

  /**
   * CASE-INSENSITIVE, because EIP-55 checksummed addresses differ from
   * lowercase ones by case alone and both name the same account.
   */
  sameAddress,

  parseAsset(raw: string): AssetRef | null {
    const parsed = parseErc721Asset(raw);
    if (!parsed) return null;
    return {
      raw: formatErc721Asset(parsed),
      // A person reading a page wants the token number, not a 42-character
      // contract address glued to it.
      display: `#${parsed.tokenId} · ${parsed.contract.slice(0, 6)}…${parsed.contract.slice(-4)}`,
    };
  },

  formatNative: (amount) => formatNative(amount, EVM_DECIMALS),

  parseNative(value: string): bigint | null {
    if (!/^\d+(\.\d+)?$/.test(value.trim())) return null;
    const [whole, fraction = ""] = value.trim().split(".");
    if (fraction.length > EVM_DECIMALS) return null;
    return BigInt(whole + fraction.padEnd(EVM_DECIMALS, "0"));
  },

  /**
   * The receipt says whether it succeeded and which block it landed in; the
   * transaction says what it sent and to whom; the block says when. Three reads
   * because an EVM receipt does not carry the value and a transaction does not
   * carry the status — reading either alone credits a reverted transfer.
   */
  async verifyNativeTransfer(input) {
    let receipt: { blockNumber?: string } | null;
    let transaction: unknown;
    try {
      ({ receipt, transaction } = await receiptAndTx(input.txId));
    } catch (error) {
      // THE NAME, NEVER THE OBJECT — the endpoint may carry a key.
      console.error(
        `robinhood.verifyNativeTransfer: fetch failed (${error instanceof Error ? error.name : "unknown"})`,
      );
      return {
        ok: false,
        reason: "rpc_unavailable",
        message: "Could not read that transaction just now. Try again in a moment.",
      };
    }

    let timestamp: number | null = null;
    if (receipt?.blockNumber) {
      try {
        timestamp = await blockTimestampSeconds(receipt.blockNumber);
      } catch {
        return {
          ok: false,
          reason: "rpc_unavailable",
          message: "Could not read that transaction just now. Try again in a moment.",
        };
      }
    }

    const read = readNativeTransfer(
      receipt as never,
      transaction as never,
      input.recipient,
      timestamp,
    );
    if (!read.ok) return read;

    // The window and payer rules are shared with Solana on purpose: they are
    // product rules, not chain facts, and two copies would drift.
    const gate = checkWindowAndPayer({
      payer: read.payer,
      blockTimeMs: read.blockTimeMs,
      nowMs: input.nowMs ?? Date.now(),
      skewSeconds: ROBINHOOD_BLOCKTIME_SKEW_SECONDS,
      expectedPayer: input.expectedPayer,
      window: input.window,
    });
    if (!gate.ok) return gate;

    if (read.amount < input.minAmount) {
      return {
        ok: false,
        reason: "insufficient_amount",
        message: "That transfer was smaller than the amount due.",
      };
    }

    return read;
  },

  async readAssetTransfer(txId, asset) {
    const parsed = parseErc721Asset(asset.raw);
    if (!parsed) return { ok: false, reason: "no_transfer" };

    let receipt: { blockNumber?: string } | null;
    try {
      receipt = (await evmCall("eth_getTransactionReceipt", [txId])) as { blockNumber?: string } | null;
    } catch {
      return { ok: false, reason: "rpc_unavailable" };
    }

    let timestamp: number | null = null;
    if (receipt?.blockNumber) {
      try {
        timestamp = await blockTimestampSeconds(receipt.blockNumber);
      } catch {
        return { ok: false, reason: "rpc_unavailable" };
      }
    }

    return readErc721Transfer(receipt as never, parsed, timestamp);
  },

  /**
   * `ownerOf(tokenId)` by `eth_call`.
   *
   * `null` on any failure, including a revert — ERC-721 reverts `ownerOf` for a
   * burned or nonexistent token. That collapses "burned" and "node down" into
   * one answer, and the collapse is deliberate: both mean *we could not
   * establish that the asset is in escrow*, and the caller must refuse either
   * way rather than distinguish two flavours of no.
   */
  async assetOwner(asset): Promise<string | null> {
    const parsed = parseErc721Asset(asset.raw);
    if (!parsed) return null;
    try {
      const result = await evmCall("eth_call", [
        { to: parsed.contract, data: `${OWNER_OF_SELECTOR}${encodeUint256(parsed.tokenId)}` },
        "latest",
      ]);
      if (typeof result !== "string" || result.length < 66) return null;
      const address = `0x${result.slice(-40)}`.toLowerCase();
      return /^0x0{40}$/.test(address) ? null : address;
    } catch {
      return null;
    }
  },

  /**
   * Metadata needs `tokenURI()` and then an off-chain fetch of JSON somebody
   * else hosts, which is attacker-controlled content on a page we render.
   *
   * **Not implemented in this batch, and null rather than a guess.** The bounds
   * it needs — a size cap, a timeout, and refusing redirects into private
   * address ranges — are a unit of work of their own, and a half-bounded fetch
   * is worse than none. Pages render the asset reference until then.
   * // ponytail: returns null; add the bounded tokenURI fetch when the
   * // Robinhood surface is opened, not before.
   */
  async assetMetadata(): Promise<AssetMetadata | null> {
    return null;
  },

  currentHeight: currentBlockHeight,
  blockAt: blockAtHeight,

  /**
   * The same shared search Solana uses. Robinhood Chain had the identical
   * slot-rate defect, measured — this removes it from both without a per-chain
   * constant (docs/decisions.md Q14).
   */
  blockAtOrAfter(anchorMs) {
    return findBlockAtOrAfter(
      { currentHeight: currentBlockHeight, blockAt: blockAtHeight },
      anchorMs,
    );
  },

  /**
   * EVM has no payment-reference convention and needs none: transfers to the
   * payment wallet can be listed by block range and matched on (from, value,
   * window), which does not depend on the payer's client having attached
   * anything. `null` is the honest answer, and `ticket_orders.reference_pubkey`
   * is nullable for exactly this (migration 004).
   */
  async paymentReference(): Promise<string | null> {
    return null;
  },
};

export type { Erc721Asset };
