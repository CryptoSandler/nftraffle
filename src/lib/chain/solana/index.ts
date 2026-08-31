import { formatNative, solanaRpcUrls } from "../../payments/config";
import type { AssetMetadata, AssetRef, ChainAdapter } from "../adapter";
import { readAssetTransfer } from "./asset-transfer";
import {
  LAMPORTS_PER_SOL,
  SOLANA_BLOCKTIME_SKEW_SECONDS,
  SOLANA_DECIMALS,
  SOLANA_DRAW_MARGIN_MS,
  SOLANA_SLOT_MS,
} from "./constants";
import { asset as dasAsset, assetOwner as dasOwner } from "./das";
import { blockhashForSlot, currentSlot, fetchTransaction } from "./rpc";
import { generateReference } from "./reference";
import { verifySolTransfer } from "./transfer";
import { isAddressShaped } from "../../payments/config";
import { isSignatureShaped } from "../../payments/signature";

/**
 * The Solana adapter: everything that was the whole product before the second
 * chain arrived, now behind the interface.
 *
 * **Nothing here is new logic.** Each method delegates to a module that already
 * existed and was already tested; the value of this file is that it is the only
 * place `chain/solana/*` is reachable from, so the raffle core cannot
 * accidentally depend on a Solana detail again.
 *
 * WHO CALLS THIS: `chain/registry.ts`, and nothing else.
 */
export const solanaAdapter: ChainAdapter = {
  id: "solana",
  nativeSymbol: "SOL",
  nativeDecimals: SOLANA_DECIMALS,
  blocktimeSkewSeconds: SOLANA_BLOCKTIME_SKEW_SECONDS,

  isAddress: isAddressShaped,
  isTxId: isSignatureShaped,

  /**
   * EXACT, because base58 is case-sensitive. `Abc…` and `abc…` are different
   * Solana addresses, so lowercasing before comparing would accept a payment
   * to a wallet nobody controls.
   */
  sameAddress: (a, b) => typeof a === "string" && typeof b === "string" && a.trim() === b.trim(),

  /**
   * A Solana asset is its mint address and nothing else, so parsing is the
   * address check. The EVM adapter's version has real work to do.
   */
  parseAsset(raw: string): AssetRef | null {
    const trimmed = raw.trim();
    return isAddressShaped(trimmed) ? { raw: trimmed, display: trimmed } : null;
  },

  formatNative: (amount) => formatNative(amount, SOLANA_DECIMALS),

  parseNative(value: string): bigint | null {
    if (!/^\d+(\.\d+)?$/.test(value.trim())) return null;
    const [whole, fraction = ""] = value.trim().split(".");
    if (fraction.length > SOLANA_DECIMALS) return null;
    return BigInt(whole + fraction.padEnd(SOLANA_DECIMALS, "0"));
  },

  verifyNativeTransfer: (input) =>
    verifySolTransfer({
      signature: input.txId,
      recipient: input.recipient,
      minAmount: input.minAmount,
      expectedPayer: input.expectedPayer,
      window: input.window,
      nowMs: input.nowMs,
      fetchTransaction,
    }),

  readAssetTransfer: (txId, asset) => readAssetTransfer(txId, asset.raw),

  assetOwner: (asset) => dasOwner(asset.raw),

  async assetMetadata(asset): Promise<AssetMetadata | null> {
    const found = await dasAsset(asset.raw);
    return found
      ? { name: found.name, image: found.image, collection: found.collection, owner: found.owner }
      : null;
  },

  currentHeight: currentSlot,
  hashAtHeight: blockhashForSlot,

  /**
   * Solana's announcement, and the reason its arithmetic is simpler than the
   * EVM one's: skipped slots make the chain advance more slowly than the wall
   * clock, so a slot announced this far ahead arrives LATER than intended,
   * never earlier. Later is the safe direction — the raffle has already closed.
   */
  announceHeight({ currentHeight, nowMs, endsAtMs }) {
    const aheadMs = endsAtMs - nowMs + SOLANA_DRAW_MARGIN_MS;
    const slotsAhead = BigInt(Math.ceil(Math.max(aheadMs, 0) / SOLANA_SLOT_MS));
    return currentHeight + (slotsAhead > 0n ? slotsAhead : 1n);
  },

  paymentReference: generateReference,
};

/** True when this deployment can talk to Solana at all. */
export function solanaConfigured(): boolean {
  return solanaRpcUrls().length > 0;
}

export { LAMPORTS_PER_SOL };
