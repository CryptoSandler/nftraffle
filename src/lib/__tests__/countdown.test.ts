import { describe, expect, it } from "vitest";
import { formatRemaining, remaining, utcInstant } from "../countdown";

/**
 * The clock.
 *
 * `DESIGN.md` §2 names this product's register as "a clock running down in
 * public", and the page rendered an ISO timestamp with milliseconds. These
 * tests are about what a person can read at a glance and what they can check
 * afterwards — both, because the absolute instant did not go away, it moved
 * alongside.
 */

const T = Date.parse("2026-09-01T12:00:00Z");
const at = (ms: number) => formatRemaining(remaining(T, T - ms));

describe("remaining", () => {
  it("splits a duration into days, hours, minutes and seconds", () => {
    expect(remaining(T, T - (2 * 86_400 + 4 * 3_600 + 17 * 60 + 9) * 1000)).toMatchObject({
      days: 2, hours: 4, minutes: 17, seconds: 9, elapsed: false,
    });
  });

  it("never goes negative once the target has passed", () => {
    // A countdown that ticks into negative numbers on a closed raffle is a page
    // that looks broken at exactly the moment people are watching it.
    const past = remaining(T, T + 60_000);
    expect(past).toMatchObject({ days: 0, hours: 0, minutes: 0, seconds: 0, elapsed: true });
  });

  it("is elapsed exactly at the target, not a second after", () => {
    expect(remaining(T, T).elapsed).toBe(true);
    expect(remaining(T, T - 1).elapsed).toBe(false);
  });
});

describe("formatRemaining", () => {
  it("drops units from the LEFT as time runs out", () => {
    // Never from the right: 2d 04h 17m 09s puts a digit that changes every
    // second beside one that changes every day, and the eye goes to the wrong
    // one.
    expect(at((2 * 86_400 + 4 * 3_600 + 17 * 60 + 9) * 1000)).toBe("2d 04h 17m");
    expect(at((4 * 3_600 + 17 * 60 + 9) * 1000)).toBe("4h 17m 09s");
    expect(at((17 * 60 + 9) * 1000)).toBe("17m 09s");
    expect(at(9 * 1000)).toBe("9s");
  });

  it("shows seconds only under an hour, where they start to matter", () => {
    expect(at(25 * 3_600 * 1000)).not.toMatch(/s$/);
    expect(at(59 * 60 * 1000)).toMatch(/s$/);
  });

  it("zero-pads, so the line does not shift as it counts", () => {
    // The figures are set in a tabular face; an unpadded number makes the whole
    // row move, which is motion the data does not have.
    expect(at((3_600 + 5 * 60 + 3) * 1000)).toBe("1h 05m 03s");
    expect(at((86_400 + 3_600 + 60) * 1000)).toBe("1d 01h 01m");
  });

  it("says 0s rather than going blank on a closed raffle", () => {
    expect(formatRemaining(remaining(T, T + 5_000))).toBe("0s");
  });

  it("holds at every boundary", () => {
    for (const seconds of [0, 1, 59, 60, 61, 3_599, 3_600, 3_601, 86_399, 86_400, 86_401]) {
      expect(() => at(seconds * 1000), `${seconds}s`).not.toThrow();
      expect(at(seconds * 1000), `${seconds}s`).not.toContain("NaN");
    }
  });
});

describe("utcInstant", () => {
  it("keeps seconds and drops milliseconds", () => {
    // No decision and no verification turns on a fraction of a second, and the
    // three characters cost more legibility than they buy precision.
    expect(utcInstant(new Date("2026-08-31T21:55:05.841Z"))).toBe("2026-08-31T21:55:05Z");
  });

  it("is always UTC, never a local rendering", () => {
    // A raffle closes at one instant for everybody. A timestamp that means
    // different things in different browsers is not a fact two people can check
    // together.
    expect(utcInstant(new Date("2026-08-31T21:55:05.841Z"))).toMatch(/Z$/);
  });
});
