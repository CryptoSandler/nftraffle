/**
 * The seller's choices, and the slot the draw commits to.
 *
 * Two things live here and they are related: what a seller may choose, and the
 * future slot announced at creation. The second depends on the first, because
 * the slot has to be comfortably beyond whatever close time the seller picked.
 *
 * WHO CALLS THIS: `POST /api/raffles`, and nothing else.
 */

/**
 * Solana's target slot time. Not a setting — it is the protocol's own target,
 * and using a configured value here would let a typo announce a slot that
 * arrives days early or never.
 */
export const SLOT_MS = 400;

/**
 * How far past `ends_at` the announced slot sits.
 *
 * **This margin is the whole safety property of the announcement.** The slot
 * must not exist yet when the commitment is published, and it must still be
 * reachable soon after the raffle closes. Both ends are real:
 *
 * - TOO CLOSE and the network's real pace — which runs slower than the 400ms
 *   target whenever there are skipped slots, and there are always skipped
 *   slots — puts the announced slot before the close. A slot whose blockhash
 *   exists while tickets are still selling is a slot somebody can watch, and
 *   with the seed hash published they could not compute the winner from it, but
 *   it removes the one property the announcement is for.
 * - TOO FAR and every draw waits hours after its raffle closed, with the prize
 *   sitting in escrow and the winner not knowing.
 *
 * An hour is roughly 9,000 slots at target pace and comfortably more real time
 * than that in practice, since skipped slots make the chain's slot number
 * advance more slowly than the wall clock would suggest. That direction is the
 * safe one: it means the announced slot arrives LATER than an hour, never
 * earlier.
 */
export const DRAW_MARGIN_MS = 60 * 60 * 1000;

/**
 * The slot to announce for a raffle closing at `endsAt`.
 *
 * Rounded up so a fractional slot never lands on the current one, and returned
 * as `bigint` because slot numbers pass 2^53 in less than a human lifetime and
 * `raffles.draw_slot` is a `BIGINT`.
 */
export function announceDrawSlot(input: {
  currentSlot: bigint;
  nowMs: number;
  endsAtMs: number;
}): bigint {
  const aheadMs = input.endsAtMs - input.nowMs + DRAW_MARGIN_MS;
  const slotsAhead = BigInt(Math.ceil(aheadMs / SLOT_MS));
  // A raffle that somehow closes in the past still gets a slot in the future:
  // announcing one that already exists would publish a commitment whose
  // randomness is already knowable.
  return input.currentSlot + (slotsAhead > 0n ? slotsAhead : 1n);
}

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
  maxTicketPriceLamports: 10_000_000_000n,
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
  ticketPriceLamports: bigint;
  maxTickets: number;
  durationMinutes: number;
  nowMs: number;
}): ChoiceResult {
  if (input.ticketPriceLamports <= 0n) {
    return { ok: false, reason: "price_too_low", message: "A ticket has to cost something." };
  }
  if (input.ticketPriceLamports > SELLER_LIMITS.maxTicketPriceLamports) {
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
