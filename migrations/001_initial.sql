-- The three legs: collections (launchpad), raffles (escrow + tickets + draw),
-- and the money records both share.
--
-- Read alongside docs/superpowers/specs/2026-08-28-nftraffle-design.md §3.
--
-- Two rules govern every comment in this file. It describes the SCHEMA, never
-- the policy some module applies to it — the schema is frozen by definition and
-- the policy is not, so a comment about policy here is a comment that goes
-- stale where nobody can fix it (CLAUDE.md, "Migrations"). And no amount is
-- stored as a float: lamports are BIGINT and basis points are INTEGER, because
-- money that has been through a double is money nobody can reconcile.

-- ---------------------------------------------------------------------------
-- Collections — leg 1, the launchpad.
-- ---------------------------------------------------------------------------
--
-- A row exists before anything is on chain. The creator signs the collection
-- and candy machine from their own wallet, so this table records an INTENT
-- first and the on-chain addresses afterwards, once the server has read them
-- back and verified them. That is why collection_mint and candy_machine are
-- nullable and status starts at 'draft'.
--
-- Nothing here is a custody record. This project never holds a collection's
-- authority, its assets, or its mint proceeds.
CREATE TABLE collections (
  id                   TEXT PRIMARY KEY,
  slug                 TEXT        NOT NULL UNIQUE,

  -- The Core collection and Core Candy Machine addresses, once verified on
  -- chain. UNIQUE so one deployed machine cannot back two rows: without it, a
  -- second draft naming an existing candy machine would present somebody
  -- else's mint page as its own.
  collection_mint      TEXT UNIQUE,
  candy_machine        TEXT UNIQUE,

  creator_wallet       TEXT        NOT NULL,
  name                 TEXT        NOT NULL,
  symbol               TEXT        NOT NULL,
  description          TEXT        NOT NULL DEFAULT '',

  items_available      INTEGER     NOT NULL CHECK (items_available > 0),
  price_lamports       BIGINT      NOT NULL CHECK (price_lamports >= 0),

  -- What THIS collection charges the minter on our behalf, frozen at creation.
  --
  -- Two columns rather than one because they answer different questions and
  -- only one of them is enforceable. mint_fee_lamports is what the deployed
  -- `solFixedFee` guard actually takes, and it is the number a page may quote.
  -- mint_fee_bps is the rate it was derived from, kept so an operator can see
  -- why it is that number without recomputing it from a setting that may have
  -- moved since.
  mint_fee_bps         INTEGER     NOT NULL CHECK (mint_fee_bps BETWEEN 0 AND 10000),
  mint_fee_lamports    BIGINT      NOT NULL CHECK (mint_fee_lamports >= 0),

  -- The launch fee's transaction. UNIQUE, so one payment launches one
  -- collection: replaying a signature cannot mint a second launch, and the
  -- constraint enforces that rather than a check somebody remembers.
  launch_fee_signature TEXT UNIQUE,

  status               TEXT        NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'live', 'failed')),
  starts_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  launched_at          TIMESTAMPTZ,

  -- A live collection is one whose on-chain addresses are known and whose fee
  -- was paid. Enforced here rather than in application code because it is the
  -- difference between a mint page that exists and one that 404s for every
  -- visitor, and because a status is derived from data (CLAUDE.md) — this
  -- CHECK is what stops a route from writing the status without the data.
  CONSTRAINT collections_live_is_complete CHECK (
    status <> 'live'
    OR (collection_mint IS NOT NULL
        AND candy_machine IS NOT NULL
        AND launch_fee_signature IS NOT NULL
        AND launched_at IS NOT NULL)
  )
);

CREATE INDEX collections_live ON collections (status, created_at DESC);
CREATE INDEX collections_creator ON collections (creator_wallet);

-- ---------------------------------------------------------------------------
-- Raffles — leg 2.
-- ---------------------------------------------------------------------------
--
-- Like a collection, a raffle exists as a draft before the asset arrives. The
-- draft is what the escrow deposit is verified AGAINST: this mint, from this
-- wallet, into escrow, after this row was created. Without a prior record an
-- incoming NFT is an orphan the server would have to guess about.
CREATE TABLE raffles (
  id                    TEXT PRIMARY KEY,
  slug                  TEXT        NOT NULL UNIQUE,
  seller_wallet         TEXT        NOT NULL,

  -- The exact asset. Named by the seller at draft time and never changed
  -- afterwards: it is half of what the escrow check compares against, so a
  -- mutable value here would be a raffle that can be re-pointed at a cheaper
  -- asset after tickets have sold.
  prize_mint            TEXT        NOT NULL,

  -- Set when the prize belongs to a collection launched here, NULL for a
  -- secondary raffle of an outside asset. Nullable rather than a separate
  -- table because it is one optional fact about a raffle, not a different kind
  -- of raffle.
  collection_id         TEXT        REFERENCES collections (id),

  ticket_price_lamports BIGINT      NOT NULL CHECK (ticket_price_lamports > 0),
  max_tickets           INTEGER     NOT NULL CHECK (max_tickets > 0),

  -- The house's share, frozen per raffle for the same reason a collection
  -- freezes its mint fee: a seller decided to list against this number, and a
  -- later change to the setting must not reach back and take more of a sale
  -- they already agreed to.
  house_fee_bps         INTEGER     NOT NULL CHECK (house_fee_bps BETWEEN 0 AND 10000),

  listing_fee_signature TEXT UNIQUE,
  escrow_signature      TEXT UNIQUE,

  status                TEXT        NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'open', 'closed', 'drawn', 'paid', 'cancelled')),

  -- Commit–reveal.
  --
  -- seed_hash is written at creation and is NOT NULL: a raffle with no
  -- published commitment is a raffle whose draw cannot be checked, and the
  -- column being mandatory is what makes the commitment a property of the row
  -- rather than of the code path that happened to create it.
  --
  -- seed stays NULL until the draw. draw_slot is announced at creation and
  -- names a slot that does not exist yet, which is the whole mechanism: the
  -- commitment is published before its own randomness is knowable.
  seed_hash             TEXT        NOT NULL,
  seed                  TEXT,
  draw_slot             BIGINT      NOT NULL CHECK (draw_slot > 0),
  draw_blockhash        TEXT,

  winner_wallet         TEXT,
  winning_ticket        INTEGER,

  opens_at              TIMESTAMPTZ,
  ends_at               TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  drawn_at              TIMESTAMPTZ,

  -- Payout evidence. Both are transaction signatures, and both are verified on
  -- chain before they are written: the prize leg moved prize_mint from escrow
  -- to winner_wallet, the proceeds leg moved the seller's net to
  -- seller_wallet. A NULL here means it has not been proved, never "we think
  -- it happened".
  prize_signature       TEXT,
  proceeds_signature    TEXT,
  paid_at               TIMESTAMPTZ,

  cancelled_reason      TEXT,

  -- An open raffle has a verified deposit behind it. This is the constraint
  -- that makes "the prize is really in escrow" a property of the schema rather
  -- than a promise of whichever route set the status.
  CONSTRAINT raffles_open_is_escrowed CHECK (
    status IN ('draft', 'cancelled')
    OR (escrow_signature IS NOT NULL AND listing_fee_signature IS NOT NULL)
  ),

  -- A drawn raffle has revealed its seed and named the blockhash it used.
  -- Without this, 'drawn' could be written with a winner and no way to check
  -- where that winner came from — which is the one failure the whole
  -- commit-reveal design exists to prevent.
  CONSTRAINT raffles_drawn_is_revealed CHECK (
    status NOT IN ('drawn', 'paid')
    OR (seed IS NOT NULL
        AND draw_blockhash IS NOT NULL
        AND winner_wallet IS NOT NULL
        AND winning_ticket IS NOT NULL
        AND drawn_at IS NOT NULL)
  ),

  -- A paid raffle has both legs proved.
  CONSTRAINT raffles_paid_has_evidence CHECK (
    status <> 'paid'
    OR (prize_signature IS NOT NULL AND proceeds_signature IS NOT NULL AND paid_at IS NOT NULL)
  ),

  -- A cancelled raffle says why, because the public page shows it.
  CONSTRAINT raffles_cancelled_has_reason CHECK (
    status <> 'cancelled' OR cancelled_reason IS NOT NULL
  )
);

-- The home page lists open raffles by soonest close; /admin lists drawn ones by
-- when they were drawn. Both are (status, time) scans, which is this index.
CREATE INDEX raffles_status_ends ON raffles (status, ends_at);
CREATE INDEX raffles_collection ON raffles (collection_id) WHERE collection_id IS NOT NULL;
CREATE INDEX raffles_seller ON raffles (seller_wallet);

-- One live draft per (seller, mint).
--
-- A partial unique index rather than a plain one: a seller may legitimately
-- raffle the same asset again after a previous raffle finished or was
-- cancelled, so only the states where the asset is actually spoken for are
-- constrained. Without this, two drafts naming one mint would both match the
-- same deposit, and the one that published first would take an asset the other
-- seller believed was theirs.
CREATE UNIQUE INDEX raffles_live_prize
  ON raffles (prize_mint)
  WHERE status IN ('draft', 'open', 'closed', 'drawn');

-- ---------------------------------------------------------------------------
-- Ticket orders and tickets.
-- ---------------------------------------------------------------------------
CREATE TABLE ticket_orders (
  id               TEXT PRIMARY KEY,
  raffle_id        TEXT        NOT NULL REFERENCES raffles (id),
  quantity         INTEGER     NOT NULL CHECK (quantity > 0),
  amount_lamports  BIGINT      NOT NULL CHECK (amount_lamports > 0),

  -- NOT NULL: every ticket buyer connects a wallet, so every order knows who
  -- must pay it. The sibling project allowed a NULL payer for a paste-a-
  -- signature fallback and that path was first-to-claim inside the window.
  -- There is no such fallback here, so the binding is unconditional.
  payer_pubkey     TEXT        NOT NULL,

  -- The Solana Pay reference. UNIQUE because it is generated per order and is
  -- how a reconcile pass finds a payment whose payer never came back.
  reference_pubkey TEXT        NOT NULL UNIQUE,

  ip_hash          TEXT,
  status           TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'paid', 'expired', 'failed')),
  failure_reason   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  paid_at          TIMESTAMPTZ,

  CHECK (expires_at > created_at)
);

CREATE INDEX ticket_orders_raffle ON ticket_orders (raffle_id, status);
-- Matches the rate limiter's WHERE (ip_hash = $1 AND created_at > $2): equality
-- first, then the range the scan walks backwards.
CREATE INDEX ticket_orders_ip ON ticket_orders (ip_hash, created_at DESC);

-- One row per ticket.
--
-- A row each rather than a quantity on the order, because the draw indexes into
-- a sorted list and an off-by-one in a cumulative-sum walk over quantities is a
-- wrong winner that nobody can see. Ten thousand rows is nothing; a draw
-- nobody can reproduce is everything.
--
-- The PRIMARY KEY is what enforces "no two buyers hold ticket 41 of this
-- raffle" — a database constraint rather than an application check, so two
-- concurrent confirmations cannot both believe they got it.
CREATE TABLE tickets (
  raffle_id TEXT    NOT NULL REFERENCES raffles (id),
  number    INTEGER NOT NULL CHECK (number > 0),
  order_id  TEXT    NOT NULL REFERENCES ticket_orders (id),
  -- Denormalised from the order deliberately: the draw reads it, and the draw
  -- must be reproducible from the public ticket list alone without a join to a
  -- table that carries an ip_hash.
  wallet    TEXT    NOT NULL,
  PRIMARY KEY (raffle_id, number)
);

CREATE INDEX tickets_order ON tickets (order_id);
CREATE INDEX tickets_wallet ON tickets (raffle_id, wallet);

-- ---------------------------------------------------------------------------
-- Money records shared by every leg.
-- ---------------------------------------------------------------------------

-- One signature, one claim, forever.
--
-- The PRIMARY KEY is the guarantee: a signature cannot pay for two things, and
-- the database enforces it rather than a SELECT-then-INSERT that two concurrent
-- callers would both pass. `purpose` and `subject_id` say what it was spent on,
-- so an operator holding a signature can find what it bought.
CREATE TABLE consumed_signatures (
  signature  TEXT PRIMARY KEY,
  purpose    TEXT        NOT NULL
               CHECK (purpose IN ('ticket', 'listing_fee', 'launch_fee', 'escrow', 'payout')),
  subject_id TEXT        NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX consumed_signatures_subject ON consumed_signatures (subject_id);

-- Real money that arrived and could not be applied.
--
-- Kept because the alternative is somebody's SOL vanishing with no record that
-- it ever arrived. Reuniting it with its payer is manual, from /admin.
CREATE TABLE unmatched_payments (
  id                TEXT PRIMARY KEY,
  signature         TEXT        NOT NULL UNIQUE,
  -- The lead an operator needs, when there is one. NULL when a payment matched
  -- nothing at all.
  subject_id        TEXT,
  received_lamports BIGINT      NOT NULL,
  expected_lamports BIGINT,
  -- Read off the chain, never claimed by a caller: the payer this transaction
  -- actually had. An operator reuniting a stray payment must not be trusting an
  -- id supplied by whoever pasted the signature.
  sender_pubkey     TEXT,
  reason            TEXT        NOT NULL,
  resolved_at       TIMESTAMPTZ,
  resolved_note     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX unmatched_payments_open ON unmatched_payments (created_at DESC)
  WHERE resolved_at IS NULL;

-- An NFT sitting in ESCROW_WALLET that matches no draft.
--
-- The mirror of unmatched_payments for leg 2's other asset class. A deposit is
-- either matched to a draft or it is here; it is never guessed at.
CREATE TABLE orphan_deposits (
  id            TEXT PRIMARY KEY,
  mint          TEXT        NOT NULL UNIQUE,
  signature     TEXT,
  sender_pubkey TEXT,
  noticed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  resolved_note TEXT
);

-- Every attempt to verify a payment, whether or not it succeeded.
--
-- Drives the per-order and per-caller verification limits. A row is written
-- BEFORE the RPC call it meters, because a limiter that only counts successful
-- checks does not limit anything.
CREATE TABLE verification_attempts (
  id           TEXT PRIMARY KEY,
  subject_id   TEXT        NOT NULL,
  ip_hash      TEXT        NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX verification_attempts_subject ON verification_attempts (subject_id, attempted_at DESC);
CREATE INDEX verification_attempts_ip ON verification_attempts (ip_hash, attempted_at DESC);
