/**
 * What a seller may choose.
 *
 * **The announced-height arithmetic used to live here and does not any more.**
 * It moved onto the chain adapters when the second chain arrived, because the
 * two chains disagree about the one thing that matters — which direction the
 * estimate is allowed to be wrong in. Solana can only lag; an EVM chain running
 * faster than measured would surface the announced hash while tickets are still
 * selling. Each adapter carries its own measurement and its own margin.
 *
 * What stayed is chain-neutral: these are product limits on a seller's
 * choices, and they are the same on every chain.
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
export const SELLER_LIMITS = {
  /**
   * Ten SOL, expressed in that chain's smallest unit by the caller.
   *
   * **A per-chain ceiling would be better and is deliberately not built yet**:
   * ten SOL and ten ETH are wildly different sums, so this bound is meaningful
   * on Solana and nearly meaningless on an EVM chain. The Robinhood surface is
   * closed, so nothing can hit it yet.
   * **The owner's decision (docs/decisions.md Q13): shared now, split per chain
   * the day the Robinhood surface opens, not before.** Nothing can reach the
   * wrong value in the meantime, because `OPEN_CHAINS` closes that chain.
   * // ponytail: single ceiling; make it per-chain as item 1 of the
   * // "Opening the second chain" checklist in docs/operations.md.
   */
  maxTicketPriceNative: 10_000_000_000n,
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
  | { ok: true; endsAt: Date }
  | { ok: false; reason: ChoiceFailure; message: string };

/** Validates the seller's three numbers, and returns the close time they imply. */
export function checkSellerChoices(input: {
  ticketPriceNative: bigint;
  maxTickets: number;
  durationMinutes: number;
  nowMs: number;
}): ChoiceResult {
  if (input.ticketPriceNative <= 0n) {
    return { ok: false, reason: "price_too_low", message: "A ticket has to cost something." };
  }
  if (input.ticketPriceNative > SELLER_LIMITS.maxTicketPriceNative) {
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

  return { ok: true, endsAt: new Date(input.nowMs + input.durationMinutes * 60_000) };
}
