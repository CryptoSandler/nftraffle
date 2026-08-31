import {
  ROBINHOOD_BLOCK_MS,
  ROBINHOOD_DRAW_MARGIN_MS,
  ROBINHOOD_SPEEDUP_SAFETY_FACTOR,
} from "./constants";

/**
 * Which future block to announce for a raffle closing at `endsAtMs`.
 *
 * **The arithmetic differs from Solana's in one way that matters, and it is not
 * the block time.** It is the direction the estimate is allowed to be wrong in.
 *
 * Solana can only lag: skipped slots make the slot number advance more slowly
 * than the wall clock, so a slot announced an hour ahead arrives later than an
 * hour. Later is harmless — the raffle has already closed and the draw simply
 * waits.
 *
 * Robinhood Chain has no skipped heights and its sequencer could in principle
 * produce blocks faster than measured. If it does, the announced block — and
 * its hash — arrives while tickets are still selling, and a hash that exists
 * during the sale is exactly what the announcement exists to prevent.
 *
 * So the height is computed as if the chain ran at
 * `ROBINHOOD_SPEEDUP_SAFETY_FACTOR` times the measured rate. Being wrong in the
 * slow direction costs an operator a longer wait between close and draw; being
 * wrong in the fast direction costs the raffle's entire fairness claim.
 *
 * WHO CALLS THIS: `chain/robinhood/index.ts`, as the adapter's `announceHeight`.
 */
export function announceRobinhoodHeight(input: {
  currentHeight: bigint;
  nowMs: number;
  endsAtMs: number;
}): bigint {
  const wallMs = input.endsAtMs - input.nowMs + ROBINHOOD_DRAW_MARGIN_MS;

  // Rounded up so a fractional block never lands on the current one.
  const atMeasuredRate = BigInt(Math.ceil(Math.max(wallMs, 0) / ROBINHOOD_BLOCK_MS));
  const ahead = atMeasuredRate * BigInt(ROBINHOOD_SPEEDUP_SAFETY_FACTOR);

  // A raffle that somehow closes in the past still gets a height in the future:
  // announcing one that already exists would publish a commitment whose
  // randomness is already knowable.
  return input.currentHeight + (ahead > 0n ? ahead : 1n);
}
