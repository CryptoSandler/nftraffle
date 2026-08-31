import { describe, expect, it, vi } from "vitest";
import { findBlockAtOrAfter, type BlockReader } from "../anchor";

/**
 * Finding the first block at or after an instant.
 *
 * **This search is the whole of the new draw anchor**, and it is deliberately
 * chain-agnostic: it asks only for a current height and a block-by-height
 * reader, so Solana's skipped slots and EVM's dense numbering run the same code.
 *
 * The property under test is not "it finds a block" — it is **"it never returns
 * a block earlier than the anchor"**. Returning an early block is the defect
 * this design replaces, so every test below is aimed at that.
 */

/**
 * A synthetic chain: block N has timestamp `start + N * spacing`, and any height
 * in `holes` was skipped (Solana does this; EVM does not).
 */
function chain(opts: {
  spacing: number;
  head: number;
  holes?: Set<number>;
  start?: number;
  /**
   * Heights below this read as `null`, the way a real node answers for blocks
   * it has pruned. Public Solana RPC keeps only recent history.
   */
  prunedBelow?: number;
}) {
  const start = opts.start ?? 1_000_000_000_000;
  const holes = opts.holes ?? new Set<number>();
  const reader: BlockReader = {
    currentHeight: async () => BigInt(opts.head),
    blockAt: async (h) => {
      const n = Number(h);
      if (n < 0 || n > opts.head || holes.has(n)) return null;
      if (opts.prunedBelow !== undefined && n < opts.prunedBelow) return null;
      return { hash: `hash-${n}`, timeMs: start + n * opts.spacing };
    },
  };
  return { reader, timeAt: (n: number) => start + n * opts.spacing };
}

describe("findBlockAtOrAfter", () => {
  it("finds the exact block when the anchor lands on one", async () => {
    const { reader, timeAt } = chain({ spacing: 400, head: 10_000 });
    const found = await findBlockAtOrAfter(reader, timeAt(5_000));
    expect(found).toMatchObject({ height: 5_000n, timeMs: timeAt(5_000) });
  });

  it("NEVER returns a block before the anchor", async () => {
    // The defect the whole redesign exists to remove, asserted directly and at
    // many anchors rather than at one convenient value.
    const { reader, timeAt } = chain({ spacing: 400, head: 10_000 });
    for (const target of [1, 999, 1_000, 1_001, 4_567, 9_999]) {
      const anchor = timeAt(target) - 1;
      const found = await findBlockAtOrAfter(reader, anchor);
      expect(found, `anchor before block ${target}`).not.toBeNull();
      expect(found!.timeMs, `anchor before block ${target}`).toBeGreaterThanOrEqual(anchor);
    }
  });

  it("returns the FIRST such block, not merely any later one", async () => {
    // "Any block after T" would be satisfiable by the head, which would make the
    // draw depend on when it was run rather than on the anchor. Determinism is
    // the point: two people checking must get the same block.
    const { reader, timeAt } = chain({ spacing: 400, head: 10_000 });
    const found = await findBlockAtOrAfter(reader, timeAt(3_000) + 1);
    expect(found!.height).toBe(3_001n);
  });

  it("is deterministic — the same anchor always resolves the same block", async () => {
    const { reader, timeAt } = chain({ spacing: 400, head: 10_000 });
    const anchor = timeAt(7_777) - 200;
    expect(await findBlockAtOrAfter(reader, anchor)).toEqual(
      await findBlockAtOrAfter(reader, anchor),
    );
  });

  it("steps over skipped heights, which Solana produces routinely", async () => {
    // A skipped slot reads as null. Treating that as "no block after here" would
    // strand a draw; treating it as "keep looking" is correct.
    const holes = new Set([5_000, 5_001, 5_002, 5_003]);
    const { reader, timeAt } = chain({ spacing: 400, head: 10_000, holes });
    const found = await findBlockAtOrAfter(reader, timeAt(5_000));
    expect(found!.height).toBe(5_004n);
    expect(found!.timeMs).toBeGreaterThanOrEqual(timeAt(5_000));
  });

  it("returns null when the anchor has not arrived yet", async () => {
    // The ordinary case between close and draw. Null means "wait", and the
    // caller must not substitute anything.
    const { reader, timeAt } = chain({ spacing: 400, head: 1_000 });
    expect(await findBlockAtOrAfter(reader, timeAt(5_000))).toBeNull();
  });

  it("is immune to slot rate — a 2.5x faster chain resolves the same instant", async () => {
    /**
     * THE PROPERTY THE OLD DESIGN LACKED. Mainnet runs at 317 ms/slot and devnet
     * at 166 against an assumed 400, so the announced-height design landed early
     * by that ratio. Here the anchor is a time, so a chain running at any rate
     * resolves the same INSTANT — only the height differs.
     */
    const slow = chain({ spacing: 400, head: 50_000, start: 0 });
    const fast = chain({ spacing: 160, head: 50_000, start: 0 });
    const anchor = 2_000_000;

    const a = await findBlockAtOrAfter(slow.reader, anchor);
    const b = await findBlockAtOrAfter(fast.reader, anchor);

    expect(a!.height).not.toBe(b!.height);
    expect(a!.timeMs).toBeGreaterThanOrEqual(anchor);
    expect(b!.timeMs).toBeGreaterThanOrEqual(anchor);
  });

  it("does not read the whole chain", async () => {
    // A linear scan would be thousands of RPC calls on a real chain.
    const { reader, timeAt } = chain({ spacing: 400, head: 1_000_000 });
    const spy = vi.spyOn(reader, "blockAt");
    await findBlockAtOrAfter(reader, timeAt(999_000));
    expect(spy.mock.calls.length).toBeLessThan(60);
  });

  it("gives up rather than looping when a long run of heights is missing", async () => {
    // Bounded work: an adapter answering null for everything must not hang a
    // request forever.
    const holes = new Set(Array.from({ length: 10_000 }, (_, i) => 5_000 + i));
    const { reader, timeAt } = chain({ spacing: 400, head: 10_000, holes });
    expect(await findBlockAtOrAfter(reader, timeAt(5_000))).toBeNull();
  });

  it("resolves a recent anchor on a node that has PRUNED its old blocks", async () => {
    /**
     * THE DEFECT THE DEVNET REHEARSAL FOUND, and the reason this test exists.
     *
     * The first version searched from height 0. On a real node the low end of
     * that range is pruned and reads as `null` — and `null` means "skipped slot,
     * look upward", which is exactly backwards for pruned history: those heights
     * are OLD, hence before the anchor. The search walked down into the pruned
     * region and reported no block, on a chain that had passed the anchor twenty
     * minutes earlier. Every synthetic test passed, because a synthetic chain
     * answers for every height.
     *
     * The search now brackets from the head, so it never asks about a height a
     * node would not serve.
     */
    const { reader, timeAt } = chain({
      spacing: 400,
      head: 400_000,
      prunedBelow: 390_000, // only the last ~4,000 seconds are readable
    });
    const found = await findBlockAtOrAfter(reader, timeAt(399_000));
    expect(found?.height).toBe(399_000n);
    expect(found!.timeMs).toBeGreaterThanOrEqual(timeAt(399_000));
  });

  it("refuses rather than guessing when the anchor is inside pruned history", async () => {
    // The other half of the same rule. If the anchor predates what the node can
    // show, firstness cannot be established — so it returns null and the caller
    // waits, instead of handing back the oldest readable block as though it were
    // the first one after the anchor.
    const { reader, timeAt } = chain({ spacing: 400, head: 400_000, prunedBelow: 390_000 });
    expect(await findBlockAtOrAfter(reader, timeAt(100_000))).toBeNull();
  });

  it("does not read the whole chain to reach a recent anchor", async () => {
    // A head-relative bracket costs ~log2(distance) reads. Searching from zero
    // would be ~log2(head) plus a walk through every gap it landed in.
    const { reader, timeAt } = chain({ spacing: 400, head: 500_000_000 });
    const spy = vi.spyOn(reader, "blockAt");
    const found = await findBlockAtOrAfter(reader, timeAt(499_999_000));
    expect(found?.height).toBe(499_999_000n);
    expect(spy.mock.calls.length).toBeLessThan(80);
  });

  it("returns null rather than throwing when the head cannot be read", async () => {
    // An RPC outage must be distinguishable from "not yet" only in the log; both
    // mean the caller waits, and neither may produce a block.
    const reader: BlockReader = { currentHeight: async () => null, blockAt: async () => null };
    expect(await findBlockAtOrAfter(reader, 1)).toBeNull();
  });
});
