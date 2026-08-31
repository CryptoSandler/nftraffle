import { describe, expect, it } from "vitest";
import { checkSellerChoices, SELLER_LIMITS } from "../schedule";

/**
 * The seller's ceilings. Chain-neutral by design.
 *
 * The announced-height arithmetic that used to be tested here now lives with
 * each chain's adapter — `chain/solana/index.ts` and
 * `chain/robinhood/schedule.ts` — because the two chains disagree about which
 * direction the estimate may err in. See `chain/robinhood/__tests__/schedule.test.ts`.
 */

const NOW = Date.parse("2026-08-28T12:00:00Z");

describe("checkSellerChoices", () => {
  const base = { ticketPriceNative: 100_000_000n, maxTickets: 100, durationMinutes: 1_440, nowMs: NOW };

  it("accepts an ordinary raffle and returns its close time", () => {
    const result = checkSellerChoices(base);
    expect(result).toEqual({ ok: true, endsAt: new Date(NOW + 1_440 * 60_000) });
  });

  it("refuses a free ticket", () => {
    expect(checkSellerChoices({ ...base, ticketPriceNative: 0n })).toMatchObject({
      ok: false,
      reason: "price_too_low",
    });
  });

  it("refuses a price above the ceiling", () => {
    expect(
      checkSellerChoices({
        ...base,
        ticketPriceNative: SELLER_LIMITS.maxTicketPriceNative + 1n,
      }),
    ).toMatchObject({ ok: false, reason: "price_too_high" });
  });

  it("refuses more tickets than the verification page can list", () => {
    // The mechanical ceiling: the draw writes one row per ticket and the public
    // page lists every one. Past this the page stops being readable, which
    // defeats the only thing it is for.
    expect(checkSellerChoices({ ...base, maxTickets: SELLER_LIMITS.maxTickets + 1 })).toMatchObject({
      ok: false,
      reason: "too_many_tickets",
    });
  });

  it("accepts exactly the ceiling", () => {
    expect(checkSellerChoices({ ...base, maxTickets: SELLER_LIMITS.maxTickets }).ok).toBe(true);
  });

  it("refuses a fractional or non-numeric ticket count", () => {
    for (const maxTickets of [1.5, Number.NaN, 0, -1]) {
      expect(checkSellerChoices({ ...base, maxTickets }).ok, `${maxTickets}`).toBe(false);
    }
  });

  it("refuses a raffle too short to reach anyone", () => {
    expect(checkSellerChoices({ ...base, durationMinutes: 1 })).toMatchObject({
      ok: false,
      reason: "duration_too_short",
    });
  });

  it("refuses a raffle that would hold escrow for longer than the ceiling", () => {
    // Escrow holds somebody else's property for the whole window, and every day
    // of that is a day the operator is responsible for an asset they cannot
    // sell, move or insure.
    expect(
      checkSellerChoices({ ...base, durationMinutes: SELLER_LIMITS.maxDurationDays * 24 * 60 + 1 }),
    ).toMatchObject({ ok: false, reason: "duration_too_long" });
  });
});
