-- The draw's entropy anchor becomes a wall-clock instant.
--
-- WHY, in one line: expressing a TIME requirement in HEIGHT units made the
-- guarantee depend on a slot-rate constant, and the constant was wrong.
-- docs/findings-2026-08-31-draw-margin.md has the measurement;
-- docs/decisions.md Q14 has the design and the rejected alternatives.
--
-- The old `draw_slot` was announced at creation as
-- `currentSlot + (duration + 1h)/400ms`. Solana mainnet runs at 317 ms/slot and
-- devnet at 166, so that slot arrived EARLY — and past roughly four hours of
-- duration its hash existed while tickets were still on sale, which is the one
-- thing the announcement exists to prevent.
--
-- `draw_at` replaces it. A block at or after a given instant cannot exist before
-- that instant, on any chain, at any slot rate. There is no arithmetic left to
-- be wrong about.

-- The committed anchor: published at creation, alongside seed_hash.
ALTER TABLE raffles ADD COLUMN draw_at TIMESTAMPTZ;

-- Existing rows get the anchor the new rule would have given them. Ten minutes
-- past the close, matching DRAW_ANCHOR_DELAY_MS in raffles/schedule.ts.
--
-- This is a backfill of a value that was never published for these rows, and it
-- is honest only because none of them is a mainnet raffle: every row that exists
-- when this runs is a local or devnet rehearsal. A mainnet raffle mid-flight
-- could NOT be migrated this way — its published commitment named a slot, and
-- changing the anchor after the fact would be changing the rules of a draw
-- somebody already bought into. There are none.
UPDATE raffles SET draw_at = ends_at + INTERVAL '10 minutes' WHERE draw_at IS NULL;

ALTER TABLE raffles ALTER COLUMN draw_at SET NOT NULL;

-- `draw_slot` held the ANNOUNCED slot. It now holds the RESOLVED height — the
-- block the draw actually used — so it is nullable until the draw runs, and it
-- is renamed because "slot" is Solana's word and this column also holds an EVM
-- block number.
ALTER TABLE raffles RENAME COLUMN draw_slot TO draw_height;
ALTER TABLE raffles ALTER COLUMN draw_height DROP NOT NULL;

-- Rows that were never drawn carry a meaningless announced slot in that column.
-- Clearing it is what makes "draw_height IS NOT NULL" mean "this draw resolved a
-- block", which the constraint below then relies on.
UPDATE raffles SET draw_height = NULL WHERE status NOT IN ('drawn', 'paid');

-- The old CHECK required a revealed seed, a blockhash, a winner and a ticket for
-- a drawn raffle. It now also requires the resolved height, so a drawn row can
-- always answer "which block did this use" — the question a verifier asks first.
ALTER TABLE raffles DROP CONSTRAINT raffles_drawn_is_revealed;
ALTER TABLE raffles ADD CONSTRAINT raffles_drawn_is_revealed CHECK (
  status NOT IN ('drawn', 'paid')
  OR (seed IS NOT NULL
      AND draw_blockhash IS NOT NULL
      AND draw_height IS NOT NULL
      AND winner_wallet IS NOT NULL
      AND winning_ticket IS NOT NULL
      AND drawn_at IS NOT NULL)
);

-- The anchor must be after the close. This is the safety property of the whole
-- design, and it belongs in the schema rather than only in the code that writes
-- the row: a raffle whose anchor is at or before its own close is one whose
-- entropy is available while tickets are still selling, and no route should be
-- able to create one by any path.
ALTER TABLE raffles ADD CONSTRAINT raffles_anchor_after_close CHECK (draw_at > ends_at);

COMMENT ON COLUMN raffles.draw_at IS
  'Committed wall-clock anchor. The draw uses the first block at or after this instant. Chain-agnostic and immune to slot-rate drift.';
COMMENT ON COLUMN raffles.draw_height IS
  'The height the anchor RESOLVED to, recorded at draw time. NULL before the draw.';
