import { randomUUID } from "node:crypto";
import { query, queryOne } from "./db";
import { VERIFY_LIMITS } from "./payments/config";
import { positiveInt } from "./config";

/**
 * Rate limiting, counted in Postgres against `ip_hash`.
 *
 * **In the database and not in memory, and that is a correctness requirement
 * rather than a preference.** This deploys to Vercel, where every request may
 * be served by a different instance and instances are recycled constantly. An
 * in-memory counter there gives each caller a fresh allowance per instance and
 * a full reset on every cold start, which is not a limit — it is a limit-shaped
 * object that passes a local test and protects nothing in production.
 *
 * The one deliberate exception is `/api/rpc`, which keeps an in-memory bucket:
 * an RPC call happens many times over a single payment (a blockhash, an account
 * lookup, a send, a few status polls), and a database write on every one would
 * make the proxy the bottleneck it exists to protect a paid provider from. That
 * trade is stated in the route itself. The checks here guard rare, deliberate
 * actions where a round trip is worth spending.
 *
 * **Raw addresses are never stored.** `ip_hash` is a salted SHA-256 produced by
 * `client-ip.ts`; an unsalted hash of an IPv4 address is reversible by brute
 * force over four billion preimages, so it would be a visitor's address in all
 * but name.
 *
 * WHO CALLS THIS: `tooManyOrders` from `POST /api/raffles/[slug]/orders`;
 * `meterListingAttempt` from `POST /api/raffles`;
 * `checkVerificationLimits` and `recordVerificationAttempt` from
 * `POST /api/orders/[id]/confirm`.
 */

export type Limited = { limited: true; message: string; retryAfterSeconds: number };
export type Allowed = { limited: false };
export type LimitDecision = Limited | Allowed;

function orderRateLimit(): { max: number; windowMinutes: number } {
  // Functions, not module constants: a constant freezes the value at import
  // time, which a test cannot dial down without a process restart.
  return {
    max: positiveInt(process.env.ORDER_RATE_LIMIT_MAX, 20),
    windowMinutes: positiveInt(process.env.ORDER_RATE_LIMIT_WINDOW_MINUTES, 10),
  };
}

/**
 * Whether this caller has opened too many ticket orders lately.
 *
 * Defence in depth rather than a correctness guarantee — the supply cap and the
 * settling transaction are what actually protect a raffle (see
 * `raffles/tickets.ts`). What this guards against is sustained abuse: opening
 * orders is free, mints a keypair, and writes a row, so an unbounded caller can
 * fill the table without ever paying for anything.
 */
export async function tooManyOrders(ipHash: string): Promise<LimitDecision> {
  const { max, windowMinutes } = orderRateLimit();
  const row = await queryOne<{ count: string }>(
    `SELECT count(*) AS count FROM ticket_orders
      WHERE ip_hash = $1 AND created_at > now() - ($2 || ' minutes')::interval`,
    [ipHash, String(windowMinutes)],
  );

  if (Number(row?.count ?? 0) < max) return { limited: false };
  return {
    limited: true,
    retryAfterSeconds: windowMinutes * 60,
    message: "Too many orders started from this address recently. Try again shortly.",
  };
}

function listingRateLimit(): { max: number; windowMinutes: number } {
  return {
    max: positiveInt(process.env.LISTING_RATE_LIMIT_MAX, 10),
    windowMinutes: positiveInt(process.env.LISTING_RATE_LIMIT_WINDOW_MINUTES, 10),
  };
}

/**
 * Whether this caller has opened too many raffle drafts lately, and records
 * this attempt if not.
 *
 * **Counting and recording are one function on purpose.** They are two round
 * trips either way, and separating them makes it possible to call the check
 * without the record — which reads as a working limiter, passes a test that
 * drives one request, and counts nothing.
 *
 * **A refused attempt writes no row.** The table exists to meter what costs us
 * a DAS read; a caller who is already locked out is not spending one, and
 * letting them grow the table while locked out would make the refusal the
 * cheapest way to fill it.
 *
 * **This runs BEFORE the ownership read it meters**, for the reason
 * `recordVerificationAttempt` gives: the expensive part is the outbound
 * request, and it is spent whether or not the asset turns out to be there.
 *
 * WHO CALLS THIS: `POST /api/raffles`, after the seller binding verifies and
 * before the chain is asked anything.
 */
export async function meterListingAttempt(ipHash: string): Promise<LimitDecision> {
  const { max, windowMinutes } = listingRateLimit();
  const row = await queryOne<{ count: string }>(
    `SELECT count(*) AS count FROM listing_attempts
      WHERE ip_hash = $1 AND attempted_at > now() - ($2 || ' minutes')::interval`,
    [ipHash, String(windowMinutes)],
  );
  if (Number(row?.count ?? 0) >= max) {
    return {
      limited: true,
      retryAfterSeconds: windowMinutes * 60,
      message: "Too many listings started from this address recently. Try again shortly.",
    };
  }

  await query(`INSERT INTO listing_attempts (id, ip_hash) VALUES ($1,$2)`, [
    `la_${randomUUID().replaceAll("-", "")}`,
    ipHash,
  ]);
  await pruneListingAttempts();
  return { limited: false };
}

/** Swept from the write path, like the other two attempt tables. */
async function pruneListingAttempts(): Promise<void> {
  await query(
    `DELETE FROM listing_attempts
      WHERE attempted_at <= now() - ($1 || ' hours')::interval`,
    [String(ATTEMPT_RETENTION_HOURS)],
  );
}

/**
 * Records a verification attempt.
 *
 * **Called BEFORE the RPC call it meters, not after.** A limiter that only
 * counts attempts that produced an answer does not limit anything: the
 * expensive path is the outbound request, and that is spent whether or not the
 * payment turns out to exist.
 */
export async function recordVerificationAttempt(
  subjectId: string,
  ipHash: string,
): Promise<void> {
  await query(
    `INSERT INTO verification_attempts (id, subject_id, ip_hash) VALUES ($1,$2,$3)`,
    [`va_${randomUUID().replaceAll("-", "")}`, subjectId, ipHash],
  );
  await pruneVerificationAttempts();
}

/**
 * Sweeps rows older than the window, from the write path that produces them.
 *
 * Hung off the INSERT rather than a job of its own, for the reason the sibling
 * project's admin sweep gives: a table nobody sweeps grows forever, slowly,
 * which is exactly why nobody notices. It is deliberately NOT hung off the READ
 * path, which runs on every attempt and would spend a DELETE to reap a handful
 * of rows.
 *
 * The retention is far wider than the limiter's own window, because it is not
 * for the code — "was somebody hammering this while I was away" is asked after
 * the fact, and a sweep tight enough to serve only the query above would answer
 * it with nothing.
 */
const ATTEMPT_RETENTION_HOURS = 24;

async function pruneVerificationAttempts(): Promise<void> {
  await query(
    `DELETE FROM verification_attempts
      WHERE attempted_at <= now() - ($1 || ' hours')::interval`,
    [String(ATTEMPT_RETENTION_HOURS)],
  );
}

/**
 * Caps how often a payment may be checked.
 *
 * Three limits, because they stop three different things:
 *
 *  - `minIntervalSeconds` stops a retry loop in a browser tab from spending an
 *    order's whole budget in a second.
 *  - `perOrder` stops one order id — which anyone holding the URL has — from
 *    driving unlimited RPC calls.
 *  - `perIp` stops the same caller doing it across many orders, which the
 *    per-order cap alone would not see.
 */
export async function checkVerificationLimits(
  subjectId: string,
  ipHash: string,
): Promise<LimitDecision> {
  const since = new Date(Date.now() - VERIFY_LIMITS.windowMinutes * 60_000);

  const last = await queryOne<{ attempted_at: Date }>(
    `SELECT attempted_at FROM verification_attempts
      WHERE subject_id = $1 ORDER BY attempted_at DESC LIMIT 1`,
    [subjectId],
  );
  if (last) {
    const elapsed = (Date.now() - last.attempted_at.getTime()) / 1000;
    if (elapsed < VERIFY_LIMITS.minIntervalSeconds) {
      const wait = Math.ceil(VERIFY_LIMITS.minIntervalSeconds - elapsed);
      return {
        limited: true,
        retryAfterSeconds: wait,
        message: `Slow down. Wait ${wait} second${wait === 1 ? "" : "s"} before checking again.`,
      };
    }
  }

  const forOrder = await queryOne<{ count: string }>(
    `SELECT count(*) AS count FROM verification_attempts
      WHERE subject_id = $1 AND attempted_at > $2`,
    [subjectId, since],
  );
  if (Number(forOrder?.count ?? 0) >= VERIFY_LIMITS.perOrder) {
    return {
      limited: true,
      retryAfterSeconds: VERIFY_LIMITS.windowMinutes * 60,
      message:
        `This order has been checked ${VERIFY_LIMITS.perOrder} times in the last ` +
        `${VERIFY_LIMITS.windowMinutes} minutes. Wait before trying again.`,
    };
  }

  const forIp = await queryOne<{ count: string }>(
    `SELECT count(*) AS count FROM verification_attempts
      WHERE ip_hash = $1 AND attempted_at > $2`,
    [ipHash, since],
  );
  if (Number(forIp?.count ?? 0) >= VERIFY_LIMITS.perIp) {
    return {
      limited: true,
      retryAfterSeconds: VERIFY_LIMITS.windowMinutes * 60,
      message: "Too many payment checks from here recently. Try again shortly.",
    };
  }

  return { limited: false };
}
