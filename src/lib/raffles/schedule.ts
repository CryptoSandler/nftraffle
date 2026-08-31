import type { ChainId } from "../chain/adapter";

/**
 * What a seller may choose, and when their raffle's entropy is anchored.
 *
 * **The height arithmetic that used to live here, then moved to the adapters,
 * is gone entirely** — see `docs/decisions.md` Q14. Both versions predicted a
 * block NUMBER from an assumed rate, and both were wrong in the same way: the
 * measured rate is not the actual rate, so the predicted block landed early by
 * whatever the error was. On mainnet that was 317 ms against an assumed 400,
 * which surfaced the draw's entropy while tickets were still selling.
 *
 * What replaced it is in this file and is chain-neutral **because a wall-clock
 * instant is chain-neutral**: the raffle commits to a TIME, and each chain's
 * adapter resolves that time to whichever of its blocks came first at or after
 * it. A chain running at any rate, drifting in any direction, resolves the same
 * instant. There is no rate constant left to be wrong about.
 *
 * WHO CALLS THIS: `POST /api/raffles`, and nothing else.
 */

/**
 * Ceilings on what a seller may choose.
 *
 * **Deliberately constants here rather than CHECK constraints** (CLAUDE.md,
 * "Decisions with a door"). Two of the three are judgement calls that should be
 * changeable without a migration, and a limit frozen into the schema is one
 * nobody can later tell was a decision rather than an accident.
 *
 * `docs/operations.md` carries the same numbers with their reasoning for
 * whoever operates this. The one with a mechanical reason behind it is
 * `maxTickets`: the draw writes one row per ticket and the public verification
 * page lists every one, so past this the page stops being readable — which
 * defeats the only thing that page is for.
 */
/**
 * How long after the close the draw's entropy is anchored.
 *
 * **The single number the whole draw commitment rests on**, and what it has to
 * buy is one thing: that no block eligible to decide this raffle can exist
 * while a ticket can still be bought. Ten minutes does that with room to spare
 * on both chains — Solana's clock is a stake-weighted median of validator
 * timestamps and drifts from real time by seconds, not minutes, and Robinhood's
 * proposer sets a timestamp bounded by the sequencer.
 *
 * **Why not longer.** Every minute here is a minute the seller and the winner
 * wait after the sale ends, staring at a page that says the draw has not
 * happened. That is the cost, it is paid by the honest case every time, and an
 * hour would buy nothing the ten minutes does not.
 *
 * **Why not shorter.** Below a couple of minutes the margin starts to be the
 * same order as the chain-clock drift it exists to absorb, and the failure it
 * would allow is the one this whole redesign exists to remove.
 *
 * Unlike the old rate constants, being wrong about this is not silent: it is
 * checked at the draw against the block's own timestamp (`checkDrawAnchor` in
 * `raffles/draw.ts`), and a block that predates the close is REFUSED rather
 * than used.
 */
export const DRAW_ANCHOR_DELAY_MS = 10 * 60_000;

/**
 * The instant a raffle's entropy is anchored to, from its close.
 *
 * One line, exported, and called by both the create route and the tests, so
 * that "ten minutes after the close" has exactly one definition. The database
 * independently refuses anything not after the close (`raffles_anchor_after_close`,
 * migration 005).
 */
export function drawAnchorFor(endsAt: Date): Date {
  return new Date(endsAt.getTime() + DRAW_ANCHOR_DELAY_MS);
}

/**
 * The most a ticket may cost, PER CHAIN, in that chain's smallest unit.
 *
 * **This was one shared number and the door for splitting it has now opened**
 * (docs/decisions.md Q13: shared until the Robinhood surface opens, split the
 * day it does). Q17 opened it, so this is that split.
 *
 * The shared value was 10,000,000,000 — ten SOL in lamports, and simultaneously
 * ten BILLIONTHS of an ETH in wei. As a Robinhood ceiling it was not merely the
 * wrong magnitude, it was a ceiling no real raffle could ever exceed, which is
 * the same thing as no ceiling at all.
 *
 * **Why a ceiling exists.** Not to price the market: a mis-typed price is a
 * raffle nobody can enter, and the seller does not find out until it closes
 * empty. It is a typo guard, so each chain's value is set where a plausible
 * ticket stops and a slipped decimal point begins.
 *
 * - Solana: **10 SOL**. Unchanged.
 * - Robinhood: **0.5 ETH**. Lower in fiat terms than Solana's on purpose —
 *   ETH's unit is worth far more, an extra zero costs far more, and this chain
 *   is the one about to meet an audience that has never used this product.
 *
 * // ponytail: two constants; if a third chain arrives, this wants a table
 * // keyed by ChainId rather than another entry bolted on.
 */
export const MAX_TICKET_PRICE_NATIVE: Record<ChainId, bigint> = {
  /** 10 SOL, in lamports. */
  solana: 10_000_000_000n,
  /** 0.5 ETH, in wei. */
  robinhood: 500_000_000_000_000_000n,
};

export const SELLER_LIMITS = {
  maxTickets: 10_000,
  minDurationMinutes: 15,
  maxDurationDays: 30,
} as const;

export type ChoiceFailure =
  | "price_too_high"
  | "price_too_low"
  | "too_many_tickets"
  | "too_few_tickets"
  | "duration_too_short"
  | "duration_too_long";

export type ChoiceResult =
  | { ok: true; endsAt: Date; drawAt: Date }
  | { ok: false; reason: ChoiceFailure; message: string };

/**
 * Validates the seller's three numbers, and returns the close and the anchor
 * they imply.
 *
 * Both times come back together deliberately. They are one decision — a raffle
 * whose close and anchor were computed by two different callers is a raffle
 * where the gap between them is whatever those callers happened to agree on.
 */
export function checkSellerChoices(input: {
  ticketPriceNative: bigint;
  maxTickets: number;
  durationMinutes: number;
  nowMs: number;
  /** Which chain's ceiling applies. Required: there is no shared one any more. */
  chain: ChainId;
}): ChoiceResult {
  if (input.ticketPriceNative <= 0n) {
    return { ok: false, reason: "price_too_low", message: "A ticket has to cost something." };
  }
  if (input.ticketPriceNative > MAX_TICKET_PRICE_NATIVE[input.chain]) {
    return {
      ok: false,
      reason: "price_too_high",
      message: "That ticket price is above the maximum this deployment allows.",
    };
  }
  if (!Number.isInteger(input.maxTickets) || input.maxTickets < 1) {
    return { ok: false, reason: "too_few_tickets", message: "A raffle needs at least one ticket." };
  }
  if (input.maxTickets > SELLER_LIMITS.maxTickets) {
    return {
      ok: false,
      reason: "too_many_tickets",
      message: `A raffle can offer at most ${SELLER_LIMITS.maxTickets} tickets.`,
    };
  }
  if (!Number.isFinite(input.durationMinutes) || input.durationMinutes < SELLER_LIMITS.minDurationMinutes) {
    return {
      ok: false,
      reason: "duration_too_short",
      message: `A raffle has to run for at least ${SELLER_LIMITS.minDurationMinutes} minutes.`,
    };
  }
  if (input.durationMinutes > SELLER_LIMITS.maxDurationDays * 24 * 60) {
    return {
      ok: false,
      reason: "duration_too_long",
      message: `A raffle can run for at most ${SELLER_LIMITS.maxDurationDays} days.`,
    };
  }

  const endsAt = new Date(input.nowMs + input.durationMinutes * 60_000);
  return { ok: true, endsAt, drawAt: drawAnchorFor(endsAt) };
}
