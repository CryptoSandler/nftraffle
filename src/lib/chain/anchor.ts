/**
 * The first block at or after an instant.
 *
 * **This is the draw's entropy anchor**, and it is deliberately chain-agnostic:
 * it asks an adapter only for a current height and a block-by-height reader, so
 * Solana's skipped slots and EVM's dense numbering run identical code. That
 * shared search is the reason a time anchor was chosen over anything cleverer —
 * both chains had the same defect and this removes it from both without a
 * per-chain constant (docs/decisions.md Q14).
 *
 * **The guarantee: the returned block's timestamp is never before the anchor.**
 * A block at or after an instant cannot exist before that instant, on any chain,
 * at any slot rate. The old design derived a height from an assumed 400 ms/slot;
 * mainnet runs at 317 and devnet at 166, so it landed early and the draw's
 * entropy became available while tickets were still on sale
 * (docs/findings-2026-08-31-draw-margin.md).
 *
 * WHO CALLS THIS: `POST /api/admin/raffles/[id]/draw`, through
 * `ChainAdapter.blockAtOrAfter`.
 */

export type AnchorBlock = { height: bigint; hash: string; timeMs: number };

export type BlockReader = {
  currentHeight(): Promise<bigint | null>;
  /** `null` for a height with no block — a skipped Solana slot, or out of range. */
  blockAt(height: bigint): Promise<{ hash: string; timeMs: number } | null>;
};

/**
 * How many consecutive empty heights the walk tolerates before giving up.
 *
 * Solana skips slots routinely, usually in ones and twos and occasionally in
 * longer runs during an outage. Five hundred is far past any ordinary gap and
 * still bounds the work: without a ceiling, an adapter answering `null` for
 * everything would hold a request open indefinitely.
 *
 * Giving up returns `null`, which the caller treats as "not yet" — it waits and
 * tries again. It never substitutes a different block.
 */
const MAX_CONSECUTIVE_GAPS = 500;

/** Bounds each phase of the search, which needs ~log2(distance) steps. */
const MAX_PROBES = 64;

/**
 * How far below the head the search will look, in heights.
 *
 * **This bounds where the search may go, not how it decides.** The anchor is
 * always minutes old in practice — `DRAW_ANCHOR_DELAY_MS` is ten — so a few
 * million heights is a wide margin on the fastest chain here (Robinhood at
 * ~0.101 s/block covers a day in ~856,000). It exists so a raffle drawn absurdly
 * late, or a corrupt `draw_at`, cannot start a search across the chain's whole
 * history.
 *
 * It is not a slot-rate assumption of the kind Q14 removed: no result depends on
 * it. Exceeding it returns `null`, which means "wait", never a substituted block.
 */
const MAX_LOOKBACK = 5_000_000n;

export async function findBlockAtOrAfter(
  reader: BlockReader,
  anchorMs: number,
): Promise<AnchorBlock | null> {
  const head = await reader.currentHeight();
  if (head === null) return null;

  // The ordinary case between close and draw: the chain has not reached the
  // anchor at all. One read instead of a whole search.
  const headBlock = await firstProducedAtOrBelow(reader, head);
  if (!headBlock || headBlock.timeMs < anchorMs) return null;

  /**
   * PHASE 1 — bracket the anchor by stepping BACK from the head in doubling
   * strides, until a block earlier than the anchor is found.
   *
   * **The search must never begin at height 0, and this is not an optimisation.**
   * It used to, and against a real node it did not merely run slowly — it
   * returned the wrong answer. Nodes prune old blocks, so historical heights
   * read as `null`, and the search treats `null` as "at or after the anchor" (a
   * skipped slot tells you nothing, so it looks upward). In pruned history that
   * reading is exactly backwards: those heights are OLD, hence before the
   * anchor. The search walked down into the pruned region and reported that no
   * block existed — on a chain that had passed the anchor twenty minutes
   * earlier. Found by running `docs/devnet-rehearsal.md` against public devnet,
   * which is what a rehearsal is for.
   *
   * Stepping back from the head keeps every probe inside the range a node
   * actually serves, and the bracket is found in ~log2(distance) reads.
   */
  let hi = headBlock;
  let lo: AnchorBlock | null = null;
  let stride = 1n;

  for (let step = 0; step < MAX_PROBES; step++) {
    const floor = headBlock.height > MAX_LOOKBACK ? headBlock.height - MAX_LOOKBACK : 0n;
    const candidate = headBlock.height > stride ? headBlock.height - stride : 0n;

    if (candidate < floor) {
      // Past the lookback bound without bracketing the anchor. Fails closed:
      // the caller waits rather than being handed a block we cannot show is
      // the first one.
      return null;
    }

    const block = await firstProducedAtOrAbove(reader, candidate, hi.height);
    if (!block) {
      // An unreadable stretch — pruned history, or a node that has lost it.
      // We cannot prove firstness across a hole we cannot see into, so we do
      // not claim to.
      return null;
    }

    if (block.timeMs < anchorMs) {
      lo = block;
      break;
    }

    hi = block;
    if (candidate === 0n) {
      // Reached the bottom of the readable chain and every block is still at or
      // after the anchor, so the earliest one IS the first such block.
      return hi;
    }
    stride *= 2n;
  }

  if (!lo) return null;

  /**
   * PHASE 2 — binary search inside the bracket for the LOWEST height whose
   * first produced block is at or after the anchor.
   *
   * "The first such block" rather than "any later one" is what makes the draw
   * deterministic: two people checking must resolve the same block, and a
   * later-block rule would resolve to whenever each happened to look.
   */
  let low = lo.height + 1n;
  let high = hi.height;

  for (let step = 0; step < MAX_PROBES && low < high; step++) {
    const mid = low + (high - low) / 2n;
    const block = await firstProducedAtOrAbove(reader, mid, high);

    if (!block || block.timeMs >= anchorMs) {
      // Everything at or above `mid` within the bracket is either a gap or
      // already past the anchor, so the answer is at or below it. `hi` is known
      // to qualify, so this stays correct when the whole span is gaps.
      high = mid;
    } else {
      // This block predates the anchor, so the answer is strictly above it.
      low = block.height + 1n;
    }
  }

  const found = await firstProducedAtOrAbove(reader, low, hi.height);
  return found && found.timeMs >= anchorMs ? found : null;
}

/** The first produced block at or above `from`, within `[from, limit]`. */
async function firstProducedAtOrAbove(
  reader: BlockReader,
  from: bigint,
  limit: bigint,
): Promise<AnchorBlock | null> {
  for (let i = 0; i < MAX_CONSECUTIVE_GAPS; i++) {
    const height = from + BigInt(i);
    if (height > limit) return null;
    const block = await reader.blockAt(height);
    if (block) return { height, ...block };
  }
  return null;
}

/** The first produced block at or below `from`. Used only to read the head. */
async function firstProducedAtOrBelow(
  reader: BlockReader,
  from: bigint,
): Promise<AnchorBlock | null> {
  for (let i = 0; i < MAX_CONSECUTIVE_GAPS; i++) {
    const height = from - BigInt(i);
    if (height < 0n) return null;
    const block = await reader.blockAt(height);
    if (block) return { height, ...block };
  }
  return null;
}
