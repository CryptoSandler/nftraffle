-- Metering how often drafts are opened from one address.
--
-- `POST /api/raffles` became reachable from a browser when the listing form
-- landed. Until then its only caller was a person with curl and a runbook, and
-- an unmetered route was a route nobody could find. Every attempt that gets as
-- far as the ownership check spends a DAS read on a paid provider, so the count
-- has to exist somewhere both instances of a serverless deployment can see it —
-- which means here, not in a module-level Map.
--
-- WHY NOT A COLUMN ON `raffles`. Two reasons, and the second is the one that
-- decides it. An attempt that is refused writes no raffle row, so the rows that
-- need counting are exactly the ones that table does not have; and `raffles` is
-- kept forever while an address is a visitor identifier that should not be.
-- Rows here are swept at 24 hours by the write path that makes them.
--
-- WHY NOT `verification_attempts`, which has this exact shape. Its per-IP query
-- counts every row an address has, with no filter on what the attempt was for.
-- Sharing the table would make listing attempts eat a payer's budget for
-- checking their own payment, and a person who cannot confirm a payment they
-- already made is the worst refusal this product has. One table per limiter is
-- the pattern this schema already follows -- `admin_login_attempts` is the
-- other one -- rather than one table with a discriminator.
--
-- No `subject_id` here, unlike the other two. The wallet axis is already
-- covered by `raffles_live_prize`: one live raffle per asset means a seller
-- cannot pile up drafts for the same thing, signature or no signature. Add the
-- column if a wallet-shaped abuse ever appears that the index does not stop.
CREATE TABLE listing_attempts (
  id           TEXT PRIMARY KEY,
  ip_hash      TEXT        NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX listing_attempts_ip ON listing_attempts (ip_hash, attempted_at DESC);
