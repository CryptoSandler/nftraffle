import type { ChainAdapter, ChainId } from "./adapter";
import { robinhoodAdapter } from "./robinhood";
import { solanaAdapter } from "./solana";

/**
 * The one place an adapter is obtained.
 *
 * A frozen record rather than a factory or a lookup with a fallback: every
 * chain this product knows about is known at build time (the `ChainId` union
 * and migration 004's CHECK constraint say the same thing twice), so there is
 * no case where the right answer is "construct one" or "default to Solana".
 * A chain that is not in this map is a bug, and throwing says so at the seam
 * rather than three calls later inside a verifier.
 *
 * WHO CALLS THIS: `raffles/escrow.ts`, `raffles/payout.ts`, `raffles/tickets.ts`
 * and every route that drives them. Nothing imports `chain/solana/*` or
 * `chain/robinhood/*` directly — that is the property this file exists to
 * protect, and the reason the adapters live behind an index each.
 */
const ADAPTERS: Readonly<Record<ChainId, ChainAdapter>> = Object.freeze({
  solana: solanaAdapter,
  robinhood: robinhoodAdapter,
});

export function adapterFor(chain: ChainId): ChainAdapter {
  const adapter = ADAPTERS[chain];
  if (!adapter) throw new Error(`No adapter for chain "${chain}"`);
  return adapter;
}

/** Every adapter, for surfaces that list chains rather than act on one. */
export function allAdapters(): ChainAdapter[] {
  return Object.values(ADAPTERS);
}
