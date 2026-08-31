/**
 * Robinhood Chain's constants, and the measurement behind the important one.
 *
 * Verified against Robinhood's own documentation on 2026-08-31 rather than
 * recalled: mainnet chain ID 4663, testnet 46630, ETH as the native gas token,
 * Arbitrum Orbit / Nitro settling to Ethereum, permissionless deployment.
 *
 * WHO CALLS THIS: `chain/robinhood/rpc.ts`, `chain/robinhood/transfer.ts` and
 * `chain/robinhood/index.ts`. Nothing outside `chain/robinhood/` reads them.
 */

/** Wei in one ETH. Not a setting. */
export const WEI_PER_ETH = 1_000_000_000_000_000_000n;

/** Decimal places in one ETH. */
export const EVM_DECIMALS = 18;

export const ROBINHOOD_MAINNET_CHAIN_ID = 4663;
export const ROBINHOOD_TESTNET_CHAIN_ID = 46630;

/**
 * Tolerance when comparing a block timestamp against a window this server
 * computed.
 *
 * Two minutes, the same as Solana's — not because the chains are alike, but
 * because this bounds OUR clock's disagreement with the chain's, and our clock
 * is the same clock in both cases. The chain-side contribution is smaller here
 * (blocks are ~0.1s apart, so a timestamp is never far from the truth), which
 * makes this generous rather than tight. Generous is the right direction: it
 * only ever admits a transfer a second or two either side of a boundary, and
 * the boundary is not what stops fraud — the payer binding is.
 */
export const ROBINHOOD_BLOCKTIME_SKEW_SECONDS = 120;

/**
 * Measured block time, in milliseconds.
 *
 * **MEASURED, NOT ASSUMED, AND THE DIFFERENCE MATTERED.** Third parties quote
 * ~250ms for Arbitrum Nitro chains. Measured against
 * `https://rpc.mainnet.chain.robinhood.com` on 2026-08-31 at head block
 * 50,960,711, the real figure is ~2.5× faster:
 *
 *     span (blocks)   elapsed s   s/block
 *             1,000         101    0.1010
 *            10,000       1,016    0.1016
 *           100,000      10,078    0.1008
 *         1,000,000     101,053    0.1011
 *         5,000,000     504,818    0.1010
 *
 * ≈0.101 s/block, ≈35,600 blocks/hour, stable to 1.01× across every span — the
 * widest covering about 5.8 days of history.
 *
 * A first attempt sampling 40 consecutive blocks was discarded: four seconds of
 * span against one-second timestamp resolution measures the resolution, not the
 * chain. A rate needs a duration, not an instant.
 */
export const ROBINHOOD_BLOCK_MS = 101;

/** When the figure above was taken, so its staleness is visible rather than assumed. */
export const ROBINHOOD_BLOCK_MS_MEASURED_ON = "2026-08-31";

/**
 * How much faster than measured the chain is assumed capable of running.
 *
 * **THE SAFETY DIRECTION HERE IS THE OPPOSITE OF SOLANA'S, and this factor is
 * the whole reason this constant exists.**
 *
 * On Solana, skipped slots make the chain advance more slowly than the wall
 * clock, so an announced slot arrives later than intended. Later is harmless:
 * the raffle has already closed.
 *
 * On Robinhood Chain the failure that hurts is the chain running FASTER than
 * measured. The announced block — and therefore its hash — would then arrive
 * while tickets are still selling, and a hash that exists during the sale is
 * the one thing the announcement is designed to prevent.
 *
 * So the margin is computed as if the chain ran at twice the measured rate.
 * Doubling costs a longer wait between close and draw, which is an operator's
 * inconvenience; being wrong in the other direction costs the raffle's whole
 * fairness claim.
 */
export const ROBINHOOD_SPEEDUP_SAFETY_FACTOR = 2;

/**
 * How far past a raffle's close the announced block sits, in milliseconds of
 * wall clock.
 *
 * One hour, matching Solana's margin, so the two chains behave the same way
 * from a seller's point of view. What differs is the arithmetic that turns it
 * into a height — see `announceHeight` and the safety factor above.
 */
export const ROBINHOOD_DRAW_MARGIN_MS = 60 * 60 * 1000;
