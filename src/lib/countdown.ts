/**
 * Time remaining, as a person reads it.
 *
 * **The product's whole emotional register is "a clock running down in public"
 * (`DESIGN.md` §2), and until now it rendered
 * `2026-08-31T21:55:05.841Z`** — a raw ISO 8601 string, milliseconds included.
 * Precise, machine-readable, and the opposite of a clock
 * (`docs/design-state-2026-08-31.md` §3).
 *
 * **The absolute instant does not go away, it moves alongside.** A countdown is
 * what a person needs to decide; an exact UTC timestamp is what a person needs
 * to CHECK, and this product's entire claim is that everything it says can be
 * checked. Replacing one with the other would trade a verifiable fact for a
 * friendly one.
 *
 * Pure, and takes `nowMs` rather than reading the clock: that is what lets every
 * boundary below be tested, and it is the same discipline `raffles/draw.ts`
 * follows.
 *
 * WHO CALLS THIS: `components/Countdown.tsx`, which ticks it in the browser, and
 * the server render that produces the first frame.
 */

export type Remaining = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** True once the target has passed. The caller decides what to say then. */
  elapsed: boolean;
};

export function remaining(targetMs: number, nowMs: number): Remaining {
  const delta = Math.max(0, targetMs - nowMs);
  const total = Math.floor(delta / 1000);
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
    elapsed: targetMs <= nowMs,
  };
}

/**
 * The countdown as text.
 *
 * **Units are dropped from the left, never from the right.** A raffle with two
 * days left reads `2d 04h 17m`; one with four minutes reads `04m 09s`. Showing
 * `2d 04h 17m 09s` puts a digit that changes every second next to one that
 * changes every day, and the eye goes to the wrong one.
 *
 * **Seconds appear only under an hour**, which is where they start to matter,
 * and where a person is deciding whether they still have time to buy.
 *
 * **Zero-padded**, because the figures are set in a tabular face and an
 * unpadded number makes the whole line shift as it counts down — motion the
 * data does not have, which is exactly what `DESIGN.md` §4-6 forbids.
 */
export function formatRemaining(value: Remaining): string {
  if (value.elapsed) return "0s";
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (value.days > 0) return `${value.days}d ${pad(value.hours)}h ${pad(value.minutes)}m`;
  if (value.hours > 0) return `${value.hours}h ${pad(value.minutes)}m ${pad(value.seconds)}s`;
  if (value.minutes > 0) return `${value.minutes}m ${pad(value.seconds)}s`;
  return `${value.seconds}s`;
}

/**
 * The absolute instant, in UTC, for the reader who wants to check.
 *
 * **Seconds, not milliseconds.** `.841Z` on a close time is noise: no decision
 * and no verification turns on a fraction of a second, and the three characters
 * cost more legibility than they buy precision. The full value is still in the
 * database and in the API response for anyone reconciling.
 *
 * Always `Z`, never a local rendering. A raffle closes at one instant for
 * everybody, and a timestamp that means different things in different browsers
 * is not a fact two people can check together.
 */
export function utcInstant(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}
