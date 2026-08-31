import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { announceRobinhoodHeight } from "../schedule";
import {
  ROBINHOOD_BLOCK_MS,
  ROBINHOOD_DRAW_MARGIN_MS,
  ROBINHOOD_SPEEDUP_SAFETY_FACTOR,
} from "../constants";

const NOW = Date.parse("2026-08-31T12:00:00Z");
const HEAD = 50_960_711n;

describe("announceRobinhoodHeight", () => {
  it("names a height that does not exist yet", () => {
    // The property the whole commitment rests on. If the announced block
    // already existed, its hash would be knowable when the commitment was
    // published.
    expect(announceRobinhoodHeight({ currentHeight: HEAD, nowMs: NOW, endsAtMs: NOW + 3_600_000 }))
      .toBeGreaterThan(HEAD);
  });

  it("assumes the chain could run at the safety factor's multiple of the measured rate", () => {
    /**
     * THE TEST THAT ENCODES THE SAFETY DIRECTION.
     *
     * On Solana the chain can only lag, so an announced slot arrives later than
     * intended and later is harmless. Here the failure that hurts is the chain
     * running FASTER than measured: the announced block, and its hash, would
     * arrive while tickets are still selling.
     *
     * So the height must be at least what the chain would reach at
     * SPEEDUP_SAFETY_FACTOR times the measured rate. Falsify it by dropping the
     * factor to 1 — the assertion below fails immediately.
     */
    const endsAtMs = NOW + 3_600_000;
    const height = announceRobinhoodHeight({ currentHeight: HEAD, nowMs: NOW, endsAtMs });

    const wallMs = endsAtMs - NOW + ROBINHOOD_DRAW_MARGIN_MS;
    const atMeasuredRate = BigInt(Math.ceil(wallMs / ROBINHOOD_BLOCK_MS));
    const atDoubleSpeed = atMeasuredRate * BigInt(ROBINHOOD_SPEEDUP_SAFETY_FACTOR);

    expect(height - HEAD).toBe(atDoubleSpeed);
    expect(height - HEAD).toBeGreaterThan(atMeasuredRate);
  });

  it("lands well past the close even if the chain doubles its speed", () => {
    // The scenario the factor exists for, stated as arithmetic rather than as
    // a comment: at 2x speed the chain reaches the announced height exactly at
    // the margin's end, never before the close.
    const endsAtMs = NOW + 3_600_000;
    const height = announceRobinhoodHeight({ currentHeight: HEAD, nowMs: NOW, endsAtMs });
    const blocksAhead = Number(height - HEAD);

    const msToReachAtDoubleSpeed = (blocksAhead * ROBINHOOD_BLOCK_MS) / 2;
    expect(NOW + msToReachAtDoubleSpeed).toBeGreaterThanOrEqual(endsAtMs);
  });

  it("still names a future height when the close is already in the past", () => {
    expect(
      announceRobinhoodHeight({ currentHeight: HEAD, nowMs: NOW, endsAtMs: NOW - 10 * 3_600_000 }),
    ).toBeGreaterThan(HEAD);
  });

  it("scales with the raffle's length", () => {
    const short = announceRobinhoodHeight({ currentHeight: 1n, nowMs: NOW, endsAtMs: NOW + 3_600_000 });
    const long = announceRobinhoodHeight({
      currentHeight: 1n,
      nowMs: NOW,
      endsAtMs: NOW + 30 * 86_400_000,
    });
    expect(long).toBeGreaterThan(short);
  });

  it("announces far more blocks ahead than Solana announces slots, because blocks are 4x faster", () => {
    // A sanity check on the units. Solana's slot is 400ms and announces ~9,000
    // slots for an hour; Robinhood's block is ~101ms and, doubled for safety,
    // announces on the order of 70,000.
    const height = announceRobinhoodHeight({ currentHeight: 0n, nowMs: NOW, endsAtMs: NOW });
    expect(Number(height)).toBeGreaterThan(50_000);
    expect(Number(height)).toBeLessThan(100_000);
  });
});

describe("the measurement keeps its reason in the same file", () => {
  it("still records how the block time was obtained and which direction is unsafe", () => {
    /**
     * A test in another file can hold a number; it cannot stop somebody
     * deleting the sentence that says why (CLAUDE.md). Here the sentence is
     * load-bearing twice: the figure is 2.5x off the value a reasonable person
     * would assume, and the safety direction is the reverse of the sibling
     * chain's.
     *
     * Matched on collapsed whitespace with comment markers stripped, so a
     * reflow does not fail the test.
     */
    const source = readFileSync(new URL("../constants.ts", import.meta.url), "utf8");
    const prose = source.replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ");

    expect(prose).toContain("MEASURED, NOT ASSUMED");
    expect(prose).toContain("THE SAFETY DIRECTION HERE IS THE OPPOSITE OF SOLANA'S");
    expect(prose).toContain("four seconds of span against one-second timestamp resolution");
    expect(prose).toContain("2026-08-31");
  });
});
