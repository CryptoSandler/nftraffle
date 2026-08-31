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
 * `https://rpc.mainnet.chain.robinhood.com`, the real figure is ~2.5x faster.
 *
 * **Re-measured 2026-08-31 at head block 51,231,727**, before opening the chain:
 *
 *     span (blocks)   elapsed s   s/block
 *             1,000          98    0.0980
 *            10,000       1,013    0.1013
 *           100,000      10,122    0.1012
 *         1,000,000     101,059    0.1011
 *         5,000,000     504,964    0.1010
 *
 * ≈0.101 s/block, unchanged from the first measurement, stable to 1.03x across
 * every span — the widest covering about 5.8 days of history.
 *
 * A first attempt sampling 40 consecutive blocks was discarded: four seconds of
 * span against one-second timestamp resolution measures the resolution, not the
 * chain. A rate needs a duration, not an instant.
 *
 * **THE CONTROL THAT MATTERS MOST IS NOT THE RATE.** Every figure above is the
 * chain describing itself: block numbers divided by the chain's own timestamps.
 * A chain whose clock ran fast would produce exactly these numbers and still be
 * wrong about when a block happened, which is the assumption the draw anchor
 * rests on (docs/decisions.md Q14).
 *
 * So it was also measured against an OUTSIDE clock. Two samples 150 seconds of
 * real time apart, on 2026-08-31:
 *
 *     blocks produced        1,497
 *     chain clock elapsed    151 s  -> 0.1009 s/block
 *     local clock elapsed    151 s  -> 0.1009 s/block
 *     drift over the window  0 s
 *     constant offset        chain timestamps run ~2 s BEHIND real time
 *
 * The chain's clock tracks real time, and the ~2 s lag is a constant offset
 * rather than a drift. Both matter to the anchor: a drift would accumulate over
 * a long raffle, and a 2-second offset is three orders of magnitude inside the
 * ten-minute margin.
 *
 * **Blockscout was NOT the cross-check, and that is a gap.** The intended
 * second source was `robinhoodchain.blockscout.com`, which answers `403` with a
 * Cloudflare bot challenge to any command-line request — so it could not be
 * read, and no result from it is claimed here. The local-clock comparison above
 * was used instead, and it is the stronger control of the two: Blockscout reads
 * the same chain, while a wall clock does not.
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
