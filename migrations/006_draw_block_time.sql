-- The anchor block's own timestamp, and the constraint that makes the attack
-- unrepresentable.
--
-- Migration 005 gave the raffle a wall-clock anchor (`draw_at`) instead of a
-- predicted block number. This records WHICH INSTANT the block the draw
-- actually used carries, for two reasons that are not the same reason:
--
--  1. `/r/[slug]/verify` can state the block's time and check it against the
--     close without calling an RPC, and a reader can confirm that same figure
--     against the chain themselves. A verify page that omits the timestamp is
--     asking the reader to take "the block came after the close" on trust,
--     which is the one thing that page exists not to do.
--
--  2. The CHECK below. `checkDrawAnchor` in the application refuses a block
--     that predates the close; this refuses to STORE one. The application check
--     can be bypassed by a bug, a script, or a hand-written UPDATE; a
--     constraint cannot. Given docs/findings-2026-08-31-draw-margin.md — where
--     the previous design was safe by an argument that turned out to rest on a
--     wrong constant — the same rule is worth having in a place that does not
--     depend on any argument being right.
--
-- Nullable, because it is a result rather than a commitment: it is written at
-- the draw, like draw_height and draw_blockhash.

ALTER TABLE raffles ADD COLUMN draw_block_time TIMESTAMPTZ;

-- No backfill. Every existing row predates the anchor design, so there is no
-- honest value to put here; inventing one would make an unverifiable draw look
-- verified. The verify page renders the absence.

ALTER TABLE raffles ADD CONSTRAINT raffles_anchor_block_after_close CHECK (
  draw_block_time IS NULL
  OR (draw_block_time > ends_at AND draw_block_time >= draw_at)
);
