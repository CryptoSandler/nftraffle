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
 * **NO SPEEDUP SAFETY FACTOR, AND NO DRAW MARGIN, ANY MORE.**
 *
 * Two constants used to live here: a factor assuming the chain could run twice
 * as fast as measured, and an hour of margin, which together turned a raffle's
 * close into an announced BLOCK NUMBER. They are gone with the design that
 * needed them (docs/decisions.md Q14).
 *
 * The measurement above is still worth keeping — it is what told us the
 * announced-height approach was unsound on this chain, and it is the record of
 * how that was established. But nothing computes with it now. The draw commits
 * to a wall-clock instant, and `chain/anchor.ts` asks the chain which block came
 * first at or after it. A chain running at any rate resolves the same instant,
 * so there is no rate left to be conservative about, and no safety factor that
 * could be sized wrong.
 *
 * That is the point of the redesign rather than a happy side effect: the
 * previous version was safe by an argument about a measured number, and the
 * argument held right up until the number moved.
 */
