import { describe, expect, it } from "vitest";
import {
  checkSellerChoices,
  drawAnchorFor,
  MAX_TICKET_PRICE_NATIVE,
  SELLER_LIMITS,
} from "../schedule";

/**
 * The seller's ceilings, and the anchor their close implies.
 *
 * Chain-neutral, and now genuinely so. The announced-height arithmetic that
 * used to be tested here moved to the chain adapters when the second chain
 * arrived — the two disagreed about which direction a slot-rate estimate may
 * err in — and then went away entirely when it turned out the estimate erred in
 * the dangerous direction on BOTH (docs/decisions.md Q14). A wall-clock anchor
 * needs no per-chain arithmetic to test.
 *
 * The anchor's safety property is not here: it is in `draw-anchor.test.ts`,
 * which asserts what this margin has to buy.
 */

const NOW = Date.parse("2026-08-28T12:00:00Z");

describe("checkSellerChoices", () => {
  const base = {
    ticketPriceNative: 100_000_000n,
    maxTickets: 100,
    durationMinutes: 1_440,
    nowMs: NOW,
    chain: "solana" as const,
  };

  it("accepts an ordinary raffle and returns its close time", () => {
    const result = checkSellerChoices(base);
    const endsAt = new Date(NOW + 1_440 * 60_000);
    expect(result).toEqual({ ok: true, endsAt, drawAt: drawAnchorFor(endsAt) });
  });

  it("refuses a free ticket", () => {
    expect(checkSellerChoices({ ...base, ticketPriceNative: 0n })).toMatchObject({
      ok: false,
      reason: "price_too_low",
    });
  });

  it("refuses a price above the ceiling, per chain", () => {
    expect(
      checkSellerChoices({
        ...base,
        ticketPriceNative: MAX_TICKET_PRICE_NATIVE.solana + 1n,
      }),
    ).toMatchObject({ ok: false, reason: "price_too_high" });
  });

  it("applies each chain's OWN ceiling, which is the whole point of splitting it", () => {
    /**
     * The shared ceiling was 10,000,000,000 — ten SOL in lamports, and at the
     * same time ten billionths of an ETH in wei. As a Robinhood limit it was not
     * merely the wrong magnitude: no real raffle could ever have exceeded it, so
     * it was no limit at all (docs/decisions.md Q13).
     *
     * Asserted in both directions, because a single-chain check would pass
     * against a ceiling that was still shared.
     */
    // A price that is fine on Robinhood and far over Solana's ceiling.
    const bigOnSolana = MAX_TICKET_PRICE_NATIVE.solana + 1n;
    expect(checkSellerChoices({ ...base, ticketPriceNative: bigOnSolana })).toMatchObject({
      ok: false,
      reason: "price_too_high",
    });
    expect(
      checkSellerChoices({ ...base, chain: "robinhood", ticketPriceNative: bigOnSolana }),
    ).toMatchObject({ ok: true });

    // And Robinhood's own ceiling still bites, so it is a ceiling rather than
    // an absent check.
    expect(
      checkSellerChoices({
        ...base,
        chain: "robinhood",
        ticketPriceNative: MAX_TICKET_PRICE_NATIVE.robinhood + 1n,
      }),
    ).toMatchObject({ ok: false, reason: "price_too_high" });
  });

  it("the two ceilings are not the same number", () => {
    // The regression this guards: somebody "tidying" the record back into one
    // shared value would pass every other test in this file.
    expect(MAX_TICKET_PRICE_NATIVE.solana).not.toBe(MAX_TICKET_PRICE_NATIVE.robinhood);
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
