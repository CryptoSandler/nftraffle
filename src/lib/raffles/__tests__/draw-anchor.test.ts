import { describe, expect, it } from "vitest";
import { checkDrawAnchor } from "../draw";
import { checkSellerChoices, DRAW_ANCHOR_DELAY_MS, drawAnchorFor, SELLER_LIMITS } from "../schedule";

/**
 * THE ATTACK THIS BATCH EXISTS TO REMOVE, written down as a test.
 *
 * `docs/findings-2026-08-31-draw-margin.md`: the previous design announced a
 * BLOCK NUMBER at creation, predicted from an assumed 400 ms slot rate. Mainnet
 * runs at 317 ms and devnet at 166. So the announced block arrived early by
 * that ratio, and for any raffle running longer than about four hours on
 * mainnet — under an hour on devnet — it arrived BEFORE the sale closed.
 *
 * A block that exists during the sale has a hash that is public during the
 * sale. Anyone who reads it can compute the winning ticket number and then buy
 * exactly that ticket. The draw stays perfectly verifiable while being
 * perfectly rigged, which is worse than an unverifiable one.
 *
 * The redesign (docs/decisions.md Q14) anchors to a wall-clock instant. These
 * tests hold the line at the two places it can be crossed: the rule itself, and
 * the seller choices that feed it. The third place — the database — is
 * `raffles_anchor_block_after_close` from migration 006, asserted in
 * `lifecycle.test.ts` against a real INSERT.
 */

describe("checkDrawAnchor — a block from during the sale is refused", () => {
  const CLOSE = Date.parse("2026-09-01T12:00:00Z");
  const ANCHOR = CLOSE + DRAW_ANCHOR_DELAY_MS;

  it("REFUSES a block produced before the sale closed", async () => {
    // The attack, stated as directly as it can be. Under the old design this
    // was not merely possible, it was the ordinary case for a long raffle.
    const verdict = checkDrawAnchor({
      blockTimeMs: CLOSE - 1000,
      endsAtMs: CLOSE,
      drawAtMs: ANCHOR,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ reason: "anchor_before_close" });
  });

  it("REFUSES a block produced at the exact moment of the close", async () => {
    // The boundary is exclusive on purpose. A block sharing its second with the
    // close cannot be shown to have come after it — chain timestamps have
    // one-second resolution — and "cannot be shown" is not good enough for the
    // one property this mechanism sells.
    expect(checkDrawAnchor({ blockTimeMs: CLOSE, endsAtMs: CLOSE, drawAtMs: ANCHOR })).toMatchObject(
      { ok: false, reason: "anchor_before_close" },
    );
  });

  it("REFUSES a block after the close but before the published anchor", async () => {
    // Not the attack — this block did not exist during the sale — but it is not
    // the block the raffle committed to either. Accepting it would give the
    // server a choice of blocks in the window, and a choice is exactly what the
    // commitment is supposed to remove.
    expect(
      checkDrawAnchor({ blockTimeMs: CLOSE + 60_000, endsAtMs: CLOSE, drawAtMs: ANCHOR }),
    ).toMatchObject({ ok: false, reason: "anchor_before_commitment" });
  });

  it("accepts the first block at or after the anchor", async () => {
    expect(checkDrawAnchor({ blockTimeMs: ANCHOR, endsAtMs: CLOSE, drawAtMs: ANCHOR })).toEqual({
      ok: true,
    });
    expect(
      checkDrawAnchor({ blockTimeMs: ANCHOR + 400, endsAtMs: CLOSE, drawAtMs: ANCHOR }),
    ).toEqual({ ok: true });
  });

  it("does not care how late the draw is run", async () => {
    // The property the old design lacked. An operator who waits a week gains no
    // choice: the anchor still resolves to the same block, and this rule still
    // accepts it. Discretion over WHEN to draw must not become discretion over
    // WHAT the draw produces.
    expect(
      checkDrawAnchor({ blockTimeMs: ANCHOR + 7 * 24 * 3_600_000, endsAtMs: CLOSE, drawAtMs: ANCHOR }),
    ).toEqual({ ok: true });
  });
});

describe("the anchor is after the close for every duration a seller can pick", () => {
  /**
   * WHAT RESTORES `maxDurationDays` TO ITS FULL VALUE (docs/decisions.md Q15).
   *
   * The interim rule in `docs/operations.md` capped raffles at two hours,
   * because under the old design the safe ceiling depended on the slot rate and
   * a 30-day raffle was far past it. The cap comes off when a test shows the
   * new rule holds at the extreme, which is this.
   *
   * The check is not "30 days works". It is that the margin is INDEPENDENT of
   * duration — which is the actual difference between the two designs. The old
   * margin shrank as a fraction of a growing raffle; this one is a fixed offset
   * from whenever the close lands.
   */
  const NOW = Date.parse("2026-09-01T00:00:00Z");

  it("holds at the maximum duration a seller may choose", async () => {
    const result = checkSellerChoices({
      ticketPriceNative: 1_000_000n,
      maxTickets: 10,
      durationMinutes: SELLER_LIMITS.maxDurationDays * 24 * 60,
      nowMs: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.drawAt.getTime()).toBeGreaterThan(result.endsAt.getTime());
    expect(result.drawAt.getTime() - result.endsAt.getTime()).toBe(DRAW_ANCHOR_DELAY_MS);
  });

  it("gives the SAME margin at every duration, which is the point", async () => {
    // Under the old design this loop would have produced a margin that fell
    // away as the duration grew, and somewhere in this list it would have gone
    // negative. Asserting equality across the whole range is what says the
    // defect is gone rather than merely smaller.
    const margins = [15, 60, 120, 24 * 60, 7 * 24 * 60, SELLER_LIMITS.maxDurationDays * 24 * 60].map(
      (durationMinutes) => {
        const result = checkSellerChoices({
          ticketPriceNative: 1_000_000n,
          maxTickets: 10,
          durationMinutes,
          nowMs: NOW,
        });
        if (!result.ok) throw new Error(`duration ${durationMinutes} was rejected`);
        return result.drawAt.getTime() - result.endsAt.getTime();
      },
    );
    expect(new Set(margins)).toEqual(new Set([DRAW_ANCHOR_DELAY_MS]));
  });

  it("puts the anchor after the close for the shortest raffle too", async () => {
    // The other end. A 15-minute raffle is where a fixed offset is largest
    // relative to the sale, and where an operator is most tempted to shorten it.
    const result = checkSellerChoices({
      ticketPriceNative: 1_000_000n,
      maxTickets: 10,
      durationMinutes: SELLER_LIMITS.minDurationMinutes,
      nowMs: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.drawAt.getTime()).toBeGreaterThan(result.endsAt.getTime());
  });

  it("agrees with drawAnchorFor, so there is one definition and not two", async () => {
    const result = checkSellerChoices({
      ticketPriceNative: 1_000_000n,
      maxTickets: 10,
      durationMinutes: 90,
      nowMs: NOW,
    });
    if (!result.ok) throw new Error("rejected");
    expect(result.drawAt).toEqual(drawAnchorFor(result.endsAt));
  });
});
