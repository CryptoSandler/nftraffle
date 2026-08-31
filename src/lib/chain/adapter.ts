/**
 * One interface per chain, for the four things a raffle needs a chain to
 * answer: did money arrive, did the prize arrive, who owns the prize now, and
 * what is the hash of a block nobody could have known about in advance.
 *
 * **This seam was mostly already cut, and not on purpose.** `escrow.ts`,
 * `payout.ts` and `tickets.ts` never imported the Solana verifier for anything
 * but types — every chain call was already a function passed in, because those
 * functions had to be drivable from Node without a network. Testability put the
 * network behind a parameter; this file names the parameter.
 *
 * WHAT AN ADAPTER IS NOT ALLOWED TO DO, because these are the invariants the
 * product rests on (SECURITY.md):
 *
 *  - **Sign anything.** No adapter holds a key, and none has a method that
 *    could. Every outbound transfer is made by a human elsewhere and verified
 *    here afterwards. An adapter method named `send`, `transfer` or `sweep`
 *    would be a change to SECURITY.md I1 before it was a change to this file.
 *  - **Decide.** An adapter reports what the chain says. Whether that is good
 *    enough is `raffles/escrow.ts`'s and `raffles/payout.ts`'s judgement, and
 *    those are chain-agnostic on purpose — the two-question escrow discipline
 *    and the payout's evidence rules must not be reimplemented per chain, or
 *    they will drift and only one copy will be right.
 *  - **Guess.** Every method returns `null` or a typed failure rather than a
 *    best effort. A verdict about somebody's money that came from an
 *    unavailable node must be distinguishable from one that came from the
 *    chain.
 *
 * WHO CALLS THIS: `raffles/escrow.ts`, `raffles/payout.ts`, `raffles/tickets.ts`
 * and the routes that drive them, all via `adapterFor(chain)` in
 * `chain/registry.ts`. Nothing constructs an adapter directly.
 */

import type { EscrowTransfer } from "../raffles/escrow";
import type { NativeTransferResult } from "../payments/native-transfer";
import type { AnchorBlock } from "./anchor";

/**
 * The chains this product knows about.
 *
 * Mirrors the CHECK constraint added by migration 004. The database is the
 * enforcement; this is the type that stops a typo compiling.
 */
export type ChainId = "solana" | "robinhood";

export const CHAIN_IDS: readonly ChainId[] = ["solana", "robinhood"] as const;

export function isChainId(value: string): value is ChainId {
  return (CHAIN_IDS as readonly string[]).includes(value);
}

/**
 * An asset, as this project stores it.
 *
 * One opaque string per chain (migration 004): a Solana mint, or
 * `<contract>/<tokenId>` on EVM. Only the adapter parses it — the database
 * stores, compares and enforces uniqueness on the whole string, and none of
 * that needs the parts.
 */
export type AssetRef = {
  /** The stored form, exactly as it appears in `raffles.prize_asset`. */
  raw: string;
  /** How a person should see it. Not parsed back; display only. */
  display: string;
};

export type AssetMetadata = {
  name: string;
  /** As the chain reports it. Rendered only from the allowed hosts in next.config.ts. */
  image: string | null;
  /** The collection this asset belongs to, when the chain reports one. */
  collection: string | null;
  owner: string | null;
};

export interface ChainAdapter {
  readonly id: ChainId;
  /** For copy. "SOL", "ETH". Never used in arithmetic. */
  readonly nativeSymbol: string;
  /** Decimal places in the native unit: 9 on Solana, 18 on EVM. */
  readonly nativeDecimals: number;

  /**
   * Tolerance when comparing an on-chain timestamp against a window this server
   * computed. Per chain because the clocks differ, not because the concept does.
   */
  readonly blocktimeSkewSeconds: number;

  // --- identity and formatting ---------------------------------------------

  isAddress(value: string): boolean;
  isTxId(value: string): boolean;

  /**
   * Whether two addresses are the same address.
   *
   * **Per chain, because the answer genuinely differs and assuming either way
   * is a bug.** EVM addresses are hex and case-insensitive — EIP-55 checksums
   * differ from lowercase by case alone, so a case-sensitive comparison refuses
   * a real payment depending on how a wallet spelled the destination. Solana
   * addresses are base58, where case is SIGNIFICANT: `Abc…` and `abc…` are
   * different addresses, and a case-insensitive comparison would accept a
   * payment to a wallet nobody controls.
   *
   * So neither chain's rule can be shared, and `===` is wrong on one of them.
   */
  sameAddress(a: string | null | undefined, b: string | null | undefined): boolean;
  /** Parses the stored asset reference, or null when it is not this chain's shape. */
  parseAsset(raw: string): AssetRef | null;
  /** Renders an amount in the native unit. At least two decimals, never rounded away. */
  formatNative(amount: bigint): string;
  /** Parses a human amount ("0.05") into the chain's smallest unit. */
  parseNative(value: string): bigint | null;

  // --- money in -------------------------------------------------------------

  /**
   * Whether `txId` paid at least `minAmount` to `recipient`.
   *
   * The payer is DERIVED from the chain, never taken from the caller — a caller
   * who submits somebody else's transaction credits that somebody, which gains
   * an attacker nothing.
   */
  verifyNativeTransfer(input: {
    txId: string;
    recipient: string;
    minAmount: bigint;
    /** Present-but-blank fails closed; absent means no binding was requested. */
    expectedPayer?: string | null;
    window?: { fromMs: number; toMs: number };
    nowMs?: number;
  }): Promise<NativeTransferResult>;

  // --- the prize ------------------------------------------------------------

  /** What `txId` moved, if it moved `asset`. */
  readAssetTransfer(txId: string, asset: AssetRef): Promise<EscrowTransfer>;

  /**
   * Who holds `asset` right now, or null when we could not tell.
   *
   * `null` must not be read as "nobody": it is the answer that fails closed,
   * because the deposit-and-withdraw attack is invisible without it.
   */
  assetOwner(asset: AssetRef): Promise<string | null>;

  assetMetadata(asset: AssetRef): Promise<AssetMetadata | null>;

  // --- the draw's anchor ----------------------------------------------------

  /** The chain's current height — slot on Solana, block number on EVM. */
  currentHeight(): Promise<bigint | null>;

  /**
   * One block, or null when that height has no block — a skipped Solana slot,
   * or a height not yet reached.
   *
   * The primitive the anchor search is built on. Smaller and more honest than
   * the `hashAtHeight` it replaces, which could not say WHEN the block was.
   */
  blockAt(height: bigint): Promise<{ hash: string; timeMs: number } | null>;

  /**
   * The first block at or after `anchorMs`, or null when the anchor has not
   * arrived.
   *
   * **The draw's entropy.** A block at or after an instant cannot exist before
   * that instant, on any chain, at any slot rate — which is the guarantee the
   * old announced-height design could not make (docs/decisions.md Q14).
   *
   * Every adapter delegates to the one shared search in `chain/anchor.ts`; none
   * implements its own.
   */
  blockAtOrAfter(anchorMs: number): Promise<AnchorBlock | null>;

  // --- payment intent -------------------------------------------------------

  /**
   * A per-order reference the payer attaches, where the chain has such a
   * convention.
   *
   * Solana Pay has one and returns a fresh public key. EVM has none and returns
   * null — and needs none, because transfers to the payment wallet can be
   * listed by block range and matched on (from, value, window), which does not
   * depend on the payer's client having attached anything.
   */
  paymentReference(): Promise<string | null>;
}
