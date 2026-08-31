/**
 * Solana's chain constants.
 *
 * Split out of `payments/config.ts` when the second chain arrived: these are
 * facts about Solana, not settings of this deployment, and leaving them in a
 * file that also reads `process.env` made it unclear which was which.
 *
 * WHO CALLS THIS: `chain/solana/transfer.ts`, `chain/solana/rpc.ts` and
 * `chain/solana/index.ts`. Nothing outside `chain/solana/` reads them.
 */

/** Lamports in one SOL. Not a setting. */
export const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Decimal places in one SOL. */
export const SOLANA_DECIMALS = 9;

/**
 * Tolerance when comparing a transaction's on-chain blockTime against a window
 * this server computed. Our clock and the cluster's are not the same clock; two
 * minutes is generous for skew without meaningfully widening the window a
 * payment can land in.
 */
export const SOLANA_BLOCKTIME_SKEW_SECONDS = 120;

/**
 * Solana's target slot time, in milliseconds.
 *
 * **Not measured, and it does not need to be** — this is the protocol's own
 * target, and the direction it errs in is the safe one. Skipped slots make the
 * chain's slot number advance MORE SLOWLY than the wall clock, so a slot
 * announced this many milliseconds ahead arrives LATER than intended, never
 * earlier. Later is safe: the raffle has already closed.
 *
 * The EVM adapter cannot borrow this reasoning, and does not — see
 * `chain/robinhood/constants.ts`, where the error direction is reversed and the
 * figure had to be measured.
 */
export const SOLANA_SLOT_MS = 400;

/**
 * How far past a raffle's close the announced slot sits.
 *
 * **This margin is the whole safety property of the announcement.** The slot
 * must not exist when the commitment is published, and must still be reachable
 * soon after the raffle closes. An hour is roughly 9,000 slots at target pace
 * and comfortably more real time than that in practice, since skipped slots
 * make the chain advance more slowly than the wall clock would suggest — which
 * means the announced slot arrives LATER than an hour, never earlier.
 */
export const SOLANA_DRAW_MARGIN_MS = 60 * 60 * 1000;

/** Confirmations required before a transfer counts as settled. */
export const RPC_COMMITMENT = "confirmed";
/** Attempts per verification, across all configured endpoints. */
export const RPC_MAX_ATTEMPTS = 3;
/** First backoff step; doubles each retry, capped by RPC_BACKOFF_MAX_MS. */
export const RPC_BACKOFF_MS = 300;
/** Ceiling on a single backoff step, so a retry cannot hold a request open. */
export const RPC_BACKOFF_MAX_MS = 1_200;
