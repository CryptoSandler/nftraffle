-- Split the draw's seed into the secret half and the published half.
--
-- THE DEFECT THIS CORRECTS. Migration 001 gave `raffles` a single `seed`
-- column, commented "stays NULL until the draw". That comment described an
-- intention the schema could not enforce, and the code could not honour it
-- either: the server generates the seed when the raffle is CREATED — that is
-- what the commitment commits to — and has to be able to retrieve it an hour or
-- a month later to reveal it. So the seed had to be written at creation, into
-- the same column the public verification page reads.
--
-- The page rendered `seed ?? "not revealed"`, so a raffle still selling tickets
-- would have published its seed. That is not immediately exploitable — the
-- winner also needs the announced slot's blockhash, which does not exist yet —
-- but it destroys the property the whole scheme is built to have, and a
-- mechanism whose safety depends on a page remembering to hide a column is a
-- mechanism one refactor away from being wrong.
--
-- Two columns make the bad state unrepresentable instead:
--
--   seed_secret  written at creation, never rendered, never returned by any
--                route. The only reader is the draw.
--   seed         written at the draw and NULL before it. This is the published
--                value, and `raffles_drawn_is_revealed` already requires it to
--                be present for a raffle to be `drawn` — that constraint now
--                means what it says.
--
-- A public reader that renders `seed` therefore cannot leak anything, whatever
-- it does, because before the draw there is nothing in it.
--
-- 001 IS NOT EDITED. It has been applied, and editing an applied migration
-- fixes the file and nothing else: every database that already ran the old
-- version keeps the old schema while the file claims otherwise (CLAUDE.md,
-- "Migrations"). This is the next number.

ALTER TABLE raffles ADD COLUMN seed_secret TEXT;

-- Not NOT NULL, and that is deliberate rather than laziness. Adding the column
-- to a table that may already hold rows means those rows have no secret, and a
-- backfill would have to invent one — which would silently break the commitment
-- for every raffle created before this ran, since a seed that does not hash to
-- the published `seed_hash` is a raffle that can never be drawn. Leaving it
-- nullable makes those raffles fail loudly at the draw, where an operator can
-- see it, rather than quietly at a hash comparison nobody is watching.
--
-- No such rows exist today: this migration lands before the first deployment.
-- The reasoning is recorded because the next reader cannot know that.
COMMENT ON COLUMN raffles.seed_secret IS
  'The draw seed, held from creation. Never published; copied into raffles.seed at the draw.';

COMMENT ON COLUMN raffles.seed IS
  'The REVEALED seed. NULL until the draw. Safe for any public reader by construction.';
