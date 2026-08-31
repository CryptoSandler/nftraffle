-- Make the schema chain-neutral.
--
-- Read alongside docs/decisions.md Q9 and Q10 and
-- docs/superpowers/specs/2026-08-31-multichain-analysis.md §2.1.
--
-- WHY THE RENAMES ARE NOT COSMETIC. A column called `amount_lamports` holding
-- wei is off by a factor of 10^9, and it is wrong in the direction where a
-- reader believes they understand it. That is worse than an opaque name: an
-- operator reconciling a payout, or a future query written from the column list,
-- would be confidently wrong about somebody's money. `*_native` says what is
-- actually true on every chain — an integer count of the chain's smallest unit,
-- whose scale the adapter knows and the database does not.
--
-- WHY NOW. Nothing is deployed. Renaming eight columns costs one migration
-- today and costs a coordinated data migration plus a deploy window after the
-- first real raffle. This is the cheapest hour this change will ever take.

-- ---------------------------------------------------------------------------
-- Which chain a row belongs to.
-- ---------------------------------------------------------------------------
--
-- TEXT with a CHECK rather than a Postgres ENUM. An ENUM's value list is
-- altered by DDL, which means adding a chain becomes a migration that has to be
-- coordinated with a deploy; a CHECK is edited by the next migration like any
-- other constraint, and reading it does not require querying pg_enum. The
-- constraint is still the database's, not the application's — an unknown chain
-- is refused by Postgres.
--
-- DEFAULT 'solana' so existing rows are correct rather than guessed at: every
-- row that exists when this runs was created by the Solana-only code. The
-- default is dropped immediately afterwards, because a row inserted later must
-- state its chain rather than inherit an assumption that was only true once.
ALTER TABLE raffles       ADD COLUMN chain TEXT NOT NULL DEFAULT 'solana';
ALTER TABLE ticket_orders ADD COLUMN chain TEXT NOT NULL DEFAULT 'solana';
ALTER TABLE collections   ADD COLUMN chain TEXT NOT NULL DEFAULT 'solana';

ALTER TABLE raffles       ALTER COLUMN chain DROP DEFAULT;
ALTER TABLE ticket_orders ALTER COLUMN chain DROP DEFAULT;
ALTER TABLE collections   ALTER COLUMN chain DROP DEFAULT;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_chain_known CHECK (chain IN ('solana', 'robinhood'));
ALTER TABLE ticket_orders
  ADD CONSTRAINT ticket_orders_chain_known CHECK (chain IN ('solana', 'robinhood'));
ALTER TABLE collections
  ADD CONSTRAINT collections_chain_known CHECK (chain IN ('solana', 'robinhood'));

-- An order's chain must match its raffle's. Without this a ticket priced in SOL
-- could be settled by a verifier reading an EVM receipt — the two amounts are
-- both integers and nothing else would notice.
--
-- Enforced with a composite foreign key, which needs a unique target: the
-- (id, chain) pair on raffles. `id` is already the primary key, so this adds no
-- meaningful index cost and buys a guarantee the application cannot forget.
ALTER TABLE raffles ADD CONSTRAINT raffles_id_chain UNIQUE (id, chain);
ALTER TABLE ticket_orders
  ADD CONSTRAINT ticket_orders_chain_matches_raffle
  FOREIGN KEY (raffle_id, chain) REFERENCES raffles (id, chain);

-- ---------------------------------------------------------------------------
-- Amounts: the chain's smallest unit, named for what they are.
-- ---------------------------------------------------------------------------
ALTER TABLE raffles            RENAME COLUMN ticket_price_lamports TO ticket_price_native;
ALTER TABLE ticket_orders      RENAME COLUMN amount_lamports       TO amount_native;
ALTER TABLE collections        RENAME COLUMN price_lamports        TO price_native;
ALTER TABLE collections        RENAME COLUMN mint_fee_lamports     TO mint_fee_native;
ALTER TABLE unmatched_payments RENAME COLUMN received_lamports     TO received_native;
ALTER TABLE unmatched_payments RENAME COLUMN expected_lamports     TO expected_native;

-- ---------------------------------------------------------------------------
-- The prize: an asset reference, not a Solana mint.
-- ---------------------------------------------------------------------------
--
-- ONE OPAQUE STRING PER CHAIN, parsed only by that chain's adapter. Solana
-- stores the mint address. EVM stores `<contract>/<tokenId>`.
--
-- The alternative — `prize_contract` plus `prize_token_id` — would be honest
-- about the structure and would leave a column that is NULL and meaningless on
-- every Solana row. The database never needs the parts: it stores, compares for
-- equality, and enforces uniqueness, all of which work on the whole string.
-- Only the adapter needs the structure, and it is the only thing that has it.
--
-- The cost is real and is recorded so nobody rediscovers it: an operator
-- reading SQL sees `0xabc.../42` and has to know the encoding. It is documented
-- on the column below.
ALTER TABLE raffles RENAME COLUMN prize_mint TO prize_asset;
ALTER TABLE orphan_deposits RENAME COLUMN mint TO asset;

COMMENT ON COLUMN raffles.prize_asset IS
  'Chain-scoped asset reference. Solana: the mint address. EVM: <contract>/<tokenId>. Opaque to SQL; parsed only by the chain adapter.';

-- The partial unique index that stops two live drafts claiming one asset was
-- built on the old column name and follows it automatically, but it is now
-- wrong in a way a rename cannot fix: two different chains can legitimately
-- produce the same string, and an EVM contract address is not a Solana mint
-- even when both are text. The uniqueness has to be per chain.
DROP INDEX raffles_live_prize;
CREATE UNIQUE INDEX raffles_live_prize
  ON raffles (chain, prize_asset)
  WHERE status IN ('draft', 'open', 'closed', 'drawn');

-- ---------------------------------------------------------------------------
-- The payment reference is Solana-only.
-- ---------------------------------------------------------------------------
--
-- Solana Pay's reference pubkey exists so a reconcile pass can find a payment
-- whose payer never came back with a signature. EVM has no such convention and
-- needs none: transfers to the payment wallet can be listed by block range and
-- matched on (from, value, window), which is strictly more capable because it
-- does not depend on the payer's client having attached anything.
--
-- So the column becomes nullable. NULLs do not collide in a Postgres UNIQUE
-- index, so the "one reference per order" guarantee still holds wherever a
-- reference exists. The guarantee that covers BOTH chains is
-- `consumed_signatures`, which is a primary key and always has.
ALTER TABLE ticket_orders ALTER COLUMN reference_pubkey DROP NOT NULL;

COMMENT ON COLUMN ticket_orders.reference_pubkey IS
  'Solana Pay reference. NULL on chains with no equivalent. One signature still claims one order via consumed_signatures.';

-- ---------------------------------------------------------------------------
-- Reads that are now per chain.
-- ---------------------------------------------------------------------------
--
-- The home page and the collection pages filter by chain (docs/decisions.md
-- Q10: a collection lives on one chain, and there are no cross-chain pages), so
-- the status/time indexes gain the chain as their leading column.
DROP INDEX raffles_status_ends;
CREATE INDEX raffles_chain_status_ends ON raffles (chain, status, ends_at);

DROP INDEX collections_live;
CREATE INDEX collections_chain_live ON collections (chain, status, created_at DESC);
