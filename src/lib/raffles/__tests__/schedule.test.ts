import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { announceDrawSlot, checkSellerChoices, DRAW_MARGIN_MS, SELLER_LIMITS, SLOT_MS } from "../schedule";

const NOW = Date.parse("2026-08-28T12:00:00Z");

describe("announceDrawSlot", () => {
  it("names a slot that does not exist yet", () => {
    // The one property the whole commitment scheme rests on. If the announced
    // slot already existed, its blockhash would be knowable when the
    // commitment was published.
    const slot = announceDrawSlot({
      currentSlot: 300_000_000n,
      nowMs: NOW,
      endsAtMs: NOW + 3_600_000,
    });
    expect(slot).toBeGreaterThan(300_000_000n);
  });

  it("sits past the close by the documented margin", () => {
    const currentSlot = 300_000_000n;
    const endsAtMs = NOW + 3_600_000;
    const slot = announceDrawSlot({ currentSlot, nowMs: NOW, endsAtMs });

    const slotsToClose = BigInt(Math.ceil((endsAtMs - NOW) / SLOT_MS));
    const marginSlots = BigInt(Math.ceil(DRAW_MARGIN_MS / SLOT_MS));
    expect(slot).toBe(currentSlot + slotsToClose + marginSlots);
  });

  it("still names a future slot when the close is already in the past", () => {
    // Not reachable through the create route, which validates duration first,
    // and guarded anyway: announcing a slot that already exists would publish a
    // commitment whose randomness is already knowable.
    const slot = announceDrawSlot({
      currentSlot: 300_000_000n,
      nowMs: NOW,
      endsAtMs: NOW - 10 * 3_600_000,
    });
    expect(slot).toBeGreaterThan(300_000_000n);
  });

  it("scales with the raffle's length", () => {
    const short = announceDrawSlot({ currentSlot: 1n, nowMs: NOW, endsAtMs: NOW + 3_600_000 });
    const long = announceDrawSlot({ currentSlot: 1n, nowMs: NOW, endsAtMs: NOW + 30 * 86_400_000 });
    expect(long).toBeGreaterThan(short);
  });
});

describe("the margin keeps its reason in the same file", () => {
  it("still explains why it is an hour, and which direction is the safe one", () => {
    /**
     * A test in another file can hold a number; it cannot stop somebody
     * deleting the sentence that says why, and once the why is gone the number
     * is arbitrary and the next person "optimises" it (CLAUDE.md).
     *
     * Matched on collapsed whitespace with comment markers stripped: these
     * sentences are hard-wrapped, and asserting the raw file would assert where
     * somebody's editor broke the line.
     */
    const source = readFileSync(new URL("../schedule.ts", import.meta.url), "utf8");
    const prose = source.replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ");

    expect(prose).toContain("This margin is the whole safety property of the announcement.");
    expect(prose).toContain("skipped slots make the chain's slot number advance more slowly");
    expect(prose).toContain("the announced slot arrives LATER than an hour, never earlier");
  });
});

describe("checkSellerChoices", () => {
  const base = { ticketPriceLamports: 100_000_000n, maxTickets: 100, durationMinutes: 1_440, nowMs: NOW };

  it("accepts an ordinary raffle and returns its close time", () => {
    const result = checkSellerChoices(base);
    expect(result).toEqual({ ok: true, endsAt: new Date(NOW + 1_440 * 60_000) });
  });

  it("refuses a free ticket", () => {
    expect(checkSellerChoices({ ...base, ticketPriceLamports: 0n })).toMatchObject({
      ok: false,
      reason: "price_too_low",
    });
  });

  it("refuses a price above the ceiling", () => {
    expect(
      checkSellerChoices({
        ...base,
        ticketPriceLamports: SELLER_LIMITS.maxTicketPriceLamports + 1n,
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
