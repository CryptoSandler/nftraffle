# nftraffle — design

**Status:** written from the owner's brief of 2026-08-28, plus the analysis round in §0.
**Date:** 2026-08-28
**Working name:** `nftraffle`, placeholder until the domain is bought. See CLAUDE.md.

A self-serve NFT launchpad on Solana whose distribution mechanism is the raffle.

The thesis, stated once here and normatively in DESIGN.md §1: **we are not
competing with Magic Eden or Tensor on orderbook depth or curation. We are
pump.fun for NFTs, with the raffle as the selling mechanism.** The loop is:

    instant launch, no vetting  →  raffle the supply to bootstrap it  →  the
    secondary market for that collection is raffles here

Every feature is judged against that loop. A feature that shortens none of those
three arrows belongs to a different product.

Read this alongside [`DESIGN.md`](../../../DESIGN.md) (aesthetic direction and its
invariants), [`docs/operations.md`](../../operations.md) (rules that live in
configuration, not in the schema) and
[`docs/open-questions.md`](../../open-questions.md) (the owner's open decisions,
which this document must not close on their behalf).

---

## 0. The analysis round

The brief asked for a round of analysis before the spec: what to add, improve or
cut, judged against the thesis, with cost. Ten items. The ones marked **ADOPTED**
are built into this spec. The ones marked **QUESTION** would change scope, so
they are recorded in `docs/open-questions.md` and are not built.

### 0.1 The platform mint fee is a guard, not an appended instruction — ADOPTED

**What.** The brief specifies the platform fee as "a % of the mint as an extra
transfer in the mint transaction". Build it as Core Candy Machine's `solFixedFee`
guard instead, with `destination = PAYMENT_WALLET`.

**Why.** An appended transfer instruction is enforced by our client code, and our
client code is not in the enforcement path. The candy machine is a public
on-chain account and its mint instruction is public; a minter who assembles their
own transaction omits our instruction and mints fee-free. Nothing on-chain
objects, because nothing on-chain was ever told about the fee. `solFixedFee` is
part of the guard set the program itself evaluates: without the payment, the mint
instruction fails. Same money, one config field, and the enforcement code we do
not write is the enforcement code that cannot be bypassed.

**Cost.** `solFixedFee` takes fixed lamports, not basis points, so the amount is
computed once at candy-machine creation as `price × MINT_FEE_BPS / 10_000` and
frozen for that machine's life. Changing `MINT_FEE_BPS` therefore applies to
collections launched afterwards and not to live ones. That is recorded per
collection (`collections.mint_fee_lamports`, `collections.mint_fee_bps`) so a
page can always say what a given collection actually charges, and
`docs/operations.md` says it out loud so nobody expects a retroactive change.

### 0.2 Asset storage: the creator uploads and the creator pays — ADOPTED

**What.** Art and metadata JSON are uploaded to Irys (Arweave) from the
creator's browser, paid for and signed by the creator's own wallet. This server
never receives image bytes, never stores them, and never proxies them.

**Why.** The three options were: host it ourselves, have the creator host it, or
have the creator pay a permanent-storage network directly. Hosting it ourselves
makes a no-doxx project into an image host for arbitrary art uploaded by
unvetted strangers — a cost, a moderation obligation, and a takedown surface, in
exchange for nothing the product needs. Creator-supplied URIs cost nothing and
make the launch flow "go and solve this elsewhere first", which breaks the
"instant launch" arrow of the loop. The third keeps custody, cost and liability
off us while still being one flow: the creator signs an upload and then signs a
create, and both signatures are theirs.

**Cost.** One dependency (`@metaplex-foundation/umi-uploader-irys`), a second
signature in the create flow, and the creator needs a little more SOL. Caps are
enforced so "self-serve" does not mean "unbounded": see §5.3.

### 0.3 A raffle exists before its deposit arrives — ADOPTED

**What.** Creating a raffle is a two-step flow with a `draft` state. The row is
written first, carrying the exact mint the seller intends to escrow and the
seller's wallet; then the seller transfers the NFT; then the server verifies and
the raffle becomes `open`.

**Why.** Verification needs something to verify *against*. Without a prior
record, an incoming NFT at `ESCROW_WALLET` is an orphan the server has to guess
about, and two sellers depositing assets from the same collection in the same
minute are indistinguishable. With the draft first, the check is exact: this
mint, from this wallet, into escrow, after this row was created.

**Cost.** One extra state and one screen that says "send the NFT now". It also
buys the orphan-deposit queue for free, because a deposit that matches no draft
is by definition unmatched and gets filed for the operator rather than lost.

### 0.4 The draw's failure mode is refusal, not bias — ADOPTED

**What.** Commit–reveal as briefed: `hash(seed)` published when the raffle is
created, `seed` plus the blockhash of a slot announced in advance published at
close. Added: the announced slot is stored at creation, the actual slot and
blockhash used are stored at draw, and the public verification page treats
"committed but never revealed" as a loud, named failure state rather than an
empty section.

**Why.** The commitment removes the server's ability to *bias* the outcome — it
cannot choose a seed after seeing the blockhash, because the hash was published
before the blockhash existed. It does not remove the server's ability to *stall*:
an operator who dislikes the result can decline to reveal. That residual risk
cannot be engineered away without an on-chain program or a VRF, both of which
this project has ruled out. What can be done is make it visible, so the failure
is legible to everyone rather than looking like a page that has not loaded.

**Cost.** One extra state on the public page and one column. Effectively free,
and it is the difference between an honest mechanism and a mechanism that only
looks honest.

### 0.5 A payout is verified on-chain before it is called a payout — ADOPTED

**What.** `/admin` marking a raffle `paid` requires the transaction signature, and
the server verifies it on-chain before accepting: the exact prize mint moved from
`ESCROW_WALLET` to the winner's wallet, and the seller's net moved to the
seller's wallet. A signature that does not check out is refused, not stored with
a warning.

**Why.** Payouts are manual by design, and manual means the "paid" mark is an
operator's claim about themselves. The public raffle page displays that mark to
the person who did *not* send the transfer, and it is the only thing that person
has. An unverified mark on that page is the product asserting something nothing
checked. We already own every piece needed to check it — the transfer verifier
for the SOL leg and a DAS/RPC ownership lookup for the NFT leg — so the honest
version costs a verification path, not a system.

**Cost.** One more verifier and a slower admin action. It also produces the
evidence link the page shows, which had to exist anyway.

### 0.6 Price the raffle with its floor visible — ADOPTED (copy only)

**What.** No minimum sales, exactly as briefed: the draw runs on whatever sold.
The seller's create screen shows, at the moment they set price and supply, what
they receive if only one ticket sells and what they receive at a sell-out, both
net of `HOUSE_FEE_BPS`.

**Why.** "No minimum" is a real decision with a real edge: a rare asset can
transfer for one ticket's worth of SOL. The mechanism is not the problem — the
problem is a seller who did not do the arithmetic. Showing the arithmetic where
the decision is made costs one computed line and removes the entire class of
"I did not realise".

**Cost.** Two numbers on a screen. Whether sellers should be able to set an
enforced minimum at all is §0.10's question.

### 0.7 Tickets belong to wallets, not to browsers — ADOPTED

**What.** A ticket's owner is the payer public key the chain reports, bound at
purchase the way the sibling project binds an order's payer. There is no account,
no login, no email anywhere in this product.

**Why.** The winner has to be paid, and paying requires an address. Deriving that
address from the chain rather than from a form means the winner is whoever
actually paid, the payout target needs no separate collection step, and a lost
cookie loses nothing. It also falls out of the payment binding we were building
regardless, so it is not a feature so much as a consequence named out loud.

**Cost.** Zero. A wallet connection is already required to buy.

### 0.8 Cut: no explore, ranking, or filtering surface — ADOPTED

**What.** v1 has a home page listing live raffles and recent launches, newest
first, and a page per collection. There is no global browse with sorts, filters,
floor prices, trait rarity or watchlists.

**Why.** Judged against the loop, ranking serves none of the three arrows. It is
what a marketplace with liquidity builds so buyers can find the good stuff among
the volume, and it is Magic Eden's game played with a hundredth of their volume.
Newest-first is honest about what the product is at launch and needs no
maintenance.

**Cost.** Saved: ranking, cache invalidation, pagination, and the ongoing
argument about what "top" means. Given up: discovery, which the product does not
yet have enough inventory to need.

### 0.9 Cut: one public mint phase, no allowlists or guard groups in v1 — ADOPTED

**What.** A launch configures price, supply, start time, per-wallet mint limit
and bot tax. Not allowlists, not merkle roots, not whitelist-then-public phases.

**Why.** "Instant launch, no vetting" is the first arrow of the loop, and every
extra field is friction on it. Guard groups are also exactly the feature a
creator needs *after* they have an audience, and a creator with an audience is
not the creator this product is for yet.

**Cost.** Saved: a substantial amount of UI and merkle-proof plumbing. Given up:
nothing permanent — the candy machine supports groups natively, so adding a
phase later is a config change on new launches rather than a rebuild.

### 0.10 The product sells chance for money, and the copy must never pretend otherwise — ADOPTED as a rule; two QUESTIONS

**What is adopted.** A copy rule in DESIGN.md §8: nothing in this application
promises legality, describes odds as anything other than the mechanical ratio of
tickets held to tickets sold, or uses the word "guaranteed". The public
verification page is the product's honest defence and it is built in v1, not
deferred.

**What is not decided here.** Two things are the owner's, and both are recorded
in `docs/open-questions.md` rather than built:

- **Q1. Should any jurisdiction be refused?** Geo-blocking, a terms page, an age
  affirmation. All of these are one-way promises the moment they appear, and all
  of them are legal posture rather than engineering. Nothing in the schema
  prevents adding them later.
- **Q2. Should a seller be able to set an enforced minimum?** §0.6 shows the
  floor; it does not stop the seller accepting it. An enforced minimum means an
  automatic refund path, which means refunds stop being purely manual — a real
  scope change and the reason it is a question rather than a decision.

---

## 1. The three legs

### Leg 1 — Launchpad

A creator connects a wallet, pays `LAUNCH_FEE_SOL`, and gets a Core collection
plus a Core Candy Machine with a mint page, in minutes. The creator signs
everything. **This server never custodies anything in this leg** — not the
assets, not the collection authority, not the mint proceeds. `solPayment` sends
mint proceeds to the creator's own wallet; `solFixedFee` sends the platform's
cut to `PAYMENT_WALLET`. Neither ever touches us.

### Leg 2 — Raffles

Primary (a creator raffling supply to bootstrap a launch) or secondary (anyone
raffling an NFT they hold). The seller deposits the prize into `ESCROW_WALLET`,
verified on-chain by exact mint and sending wallet, and pays
`RAFFLE_LISTING_FEE_SOL`. Tickets are bought in SOL with a Solana Pay reference
key and verified server-side. The draw is commit–reveal against an announced
future slot's blockhash. Payouts are manual and evidence-backed.

This is the only leg where the project holds anything, and it holds it in a
wallet whose key is not in this repository or on the server that runs it.

### Leg 3 — Collection pages

Every collection launched here has a page: its mints, its live raffles, and the
history of every draw ever run for it. **That is the market.** Not an orderbook,
not a floor chart. Metadata and images come from on-chain sources and DAS only —
never from an upload and never from a URL a form supplied.

---

## 2. What we inherit, and what we adapt

Taken close to verbatim from `pixelwar` and `outbid-tokens`:

- `lib/db.ts` — pool, `query`/`queryOne`/`execute`/`transaction`,
  `isUniqueViolation`, `violatedConstraint`.
- `lib/config.ts` — environment readers that throw rather than default.
- `lib/http.ts` — `identify`, `refuseForeignOrigin`, `json`, `NO_STORE`.
- `lib/client-ip.ts` — `clientIp` reading `x-forwarded-for` from the right,
  `hashIp`, `subnetKey`.
- `lib/admin.ts` and `lib/admin-guard.ts` — revocable sessions, login lockout
  counted from the most recent failures, digest comparison of tokens, the single
  refusal, and `REFUSAL_FLOOR_MS`.
- `lib/base58.ts`, `lib/payments/signature.ts` — one decoder, one shape check.
- `lib/payments/sol-transfer.ts` — the native SOL verifier reading
  `preBalances`/`postBalances`, with the payer derived from the largest signer
  debit.
- `app/api/rpc/route.ts` — the method-whitelisted proxy that never relays an
  upstream body.
- `next.config.ts` security headers, the triple noindex, `scripts/migrate.mts`,
  `vitest.global-setup.ts`'s advisory lock and disposable stamp, the shape and
  commenting style of `.env.example`, `/cierre`.

Adapted:

- **The RPC whitelist grows.** pixelwar's list served one USDC transfer. This
  project needs DAS methods for asset metadata and ownership, and the candy
  machine mint path needs more account reads. The list is still a whitelist and
  still refuses batches containing anything outside it. See §7.
- **The payment verifier is native SOL only.** There is no USDC anywhere in this
  product, so `solana.ts`'s token-balance verifier does not come across;
  `sol-transfer.ts` does, and it becomes the main path rather than a second one.
- **Rate limiting is per `ip_hash` in Postgres** for the deliberate, rare actions
  (creating a raffle, creating a launch, buying a ticket, verifying a payment)
  and in memory for `/api/rpc`, exactly as the sibling reasons about it.
- **Admin gains a work queue with money in it.** pixelwar's `/admin` filed
  orphaned payments. Here it also holds the payout queue, which is the one place
  an operator action has a consequence outside the database.

Dropped: the canvas, the palette and its invariants, painting, wars, DexScreener
metadata, the token/chain modules, USDC, the reconcile cron.

---

## 3. Data model

Postgres, `pg`, no ORM. Every statement is parameterised by hand and nothing is
ever string-interpolated into SQL.

### 3.1 Collections (leg 1)

```sql
CREATE TABLE collections (
  id                  TEXT PRIMARY KEY,
  slug                TEXT        NOT NULL UNIQUE,
  -- The Core collection address. NULL until the creator's create transaction is
  -- verified on-chain, which is what moves this row out of 'draft'.
  collection_mint     TEXT UNIQUE,
  candy_machine       TEXT UNIQUE,
  creator_wallet      TEXT        NOT NULL,
  name                TEXT        NOT NULL,
  symbol              TEXT        NOT NULL,
  description         TEXT        NOT NULL DEFAULT '',
  items_available     INTEGER     NOT NULL CHECK (items_available > 0),
  price_lamports      BIGINT      NOT NULL CHECK (price_lamports >= 0),
  -- What THIS collection charges, frozen at creation. See spec §0.1: the guard
  -- takes fixed lamports, so a later change to MINT_FEE_BPS cannot reach a
  -- machine that is already deployed, and a page must be able to say what this
  -- one actually charges rather than what the current setting says.
  mint_fee_bps        INTEGER     NOT NULL CHECK (mint_fee_bps BETWEEN 0 AND 10000),
  mint_fee_lamports   BIGINT      NOT NULL CHECK (mint_fee_lamports >= 0),
  launch_fee_signature TEXT       UNIQUE,
  status              TEXT        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','live','failed')),
  starts_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  launched_at         TIMESTAMPTZ
);
```

`status` is derived and never accepted from a caller (CLAUDE.md, "a status is
never an input"). `draft` means the row exists and the fee has not been verified;
`live` means the fee signature verified AND the candy machine exists on-chain;
`failed` means the creator abandoned it.

### 3.2 Raffles (leg 2)

```sql
CREATE TABLE raffles (
  id                 TEXT PRIMARY KEY,
  slug               TEXT        NOT NULL UNIQUE,
  seller_wallet      TEXT        NOT NULL,
  -- The exact asset. Set at draft time by the seller, verified on-chain before
  -- the raffle opens: this mint, from seller_wallet, into ESCROW_WALLET.
  prize_mint         TEXT        NOT NULL,
  -- Set when this raffle is for a collection launched here. NULL for a
  -- secondary raffle of an outside asset.
  collection_id      TEXT        REFERENCES collections (id),
  ticket_price_lamports BIGINT   NOT NULL CHECK (ticket_price_lamports > 0),
  max_tickets        INTEGER     NOT NULL CHECK (max_tickets > 0),
  house_fee_bps      INTEGER     NOT NULL CHECK (house_fee_bps BETWEEN 0 AND 10000),
  listing_fee_signature TEXT     UNIQUE,
  escrow_signature   TEXT        UNIQUE,
  status             TEXT        NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','open','closed','drawn','paid','cancelled')),
  -- Commit-reveal. seed_hash is published at creation; seed is NULL until the
  -- draw. draw_slot is announced at creation and is the slot whose blockhash
  -- the draw uses.
  seed_hash          TEXT        NOT NULL,
  seed               TEXT,
  draw_slot          BIGINT      NOT NULL,
  draw_blockhash     TEXT,
  winner_wallet      TEXT,
  winning_ticket     INTEGER,
  opens_at           TIMESTAMPTZ,
  ends_at            TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  drawn_at           TIMESTAMPTZ,
  -- Payout evidence. Both verified on-chain before they are accepted (§0.5).
  prize_signature    TEXT,
  proceeds_signature TEXT,
  paid_at            TIMESTAMPTZ,
  cancelled_reason   TEXT
);
```

The six statuses are not interchangeable:

- `draft` — the row exists; the prize has not arrived and no ticket can be sold.
- `open` — escrow verified, listing fee verified, selling.
- `closed` — `ends_at` passed or `max_tickets` sold. No more tickets. Not drawn.
- `drawn` — seed revealed, blockhash read, winner derived. Nothing has moved.
- `paid` — both transfers verified on-chain. Terminal.
- `cancelled` — an operator ended it. Refunds are manual; the reason is recorded
  because the public page shows it.

### 3.3 Tickets and their orders

Ticket purchase reuses the sibling's order shape exactly: an order is opened with
a Solana Pay reference key and the connected wallet's public key, the payer signs
a native SOL transfer, and the server verifies signature, amount, destination and
window before tickets exist.

```sql
CREATE TABLE ticket_orders (
  id                TEXT PRIMARY KEY,
  raffle_id         TEXT        NOT NULL REFERENCES raffles (id),
  quantity          INTEGER     NOT NULL CHECK (quantity > 0),
  amount_lamports   BIGINT      NOT NULL CHECK (amount_lamports > 0),
  payer_pubkey      TEXT        NOT NULL,
  reference_pubkey  TEXT        NOT NULL UNIQUE,
  ip_hash           TEXT,
  status            TEXT        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','paid','expired','failed')),
  failure_reason    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  paid_at           TIMESTAMPTZ
);

-- One row per ticket, so the draw indexes into rows rather than doing
-- arithmetic over quantities. Ten thousand rows is nothing and an off-by-one in
-- a cumulative-sum walk is a wrong winner nobody can see.
CREATE TABLE tickets (
  raffle_id  TEXT    NOT NULL REFERENCES raffles (id),
  number     INTEGER NOT NULL,
  order_id   TEXT    NOT NULL REFERENCES ticket_orders (id),
  wallet     TEXT    NOT NULL,
  PRIMARY KEY (raffle_id, number)
);
```

`consumed_signatures` carries the same one-signature-one-claim guarantee the
sibling relies on, and `unmatched_payments` files real money that arrived and
could not be applied.

---

## 4. The draw

Announced at creation, computed at close, recomputable by anyone.

**At creation** the server generates a 32-byte `seed`, publishes
`seed_hash = sha256(seed)` and announces `draw_slot` — a slot comfortably after
`ends_at`, so it does not exist yet and nobody can know its blockhash.

**At close** the server reads the blockhash of `draw_slot`, publishes the `seed`,
and derives:

    tickets sorted by number ascending, 1..n
    material = sha256(seed_hash || seed || draw_blockhash || raffle_id)
    winning_ticket = (material as big-endian integer mod n) + 1
    winner = the wallet holding that ticket

**Why each ingredient is there.** The seed stops the chain from deciding alone
and is committed before the blockhash exists, so we cannot pick it to suit a
result. The blockhash stops us from deciding alone and comes from a slot named
before any ticket was sold. `raffle_id` stops two raffles that happen to close on
the same slot from having correlated outcomes. Sorting by ticket number rather
than by insertion order makes the input reproducible from the public ticket list.

**What this does not defend against**, stated because a mechanism that oversells
itself is worse than one that does not exist: an operator who dislikes the
outcome can refuse to reveal the seed. The commitment makes bias impossible and
makes refusal obvious; it cannot make refusal impossible without an on-chain
program, which this project does not have and does not want. `/r/[slug]/verify`
names that state explicitly.

---

## 5. Flows

### 5.1 Buying a ticket

1. `POST /api/raffles/[slug]/orders` — quantity, connected wallet. Server checks
   the raffle is `open`, that enough tickets remain, rate-limits by `ip_hash`,
   mints a reference keypair (public half kept, private half discarded), and
   answers with `payTo`, `amountLamports`, `reference`, `expiresAt`.
2. The browser builds a native SOL transfer to `PAYMENT_WALLET` carrying the
   reference as a read-only account, and the wallet signs it.
3. `POST /api/orders/[id]/confirm` — the signature. The server verifies with
   `verifySolTransfer`: amount at or above the order's price, destination is
   `PAYMENT_WALLET`, the transaction landed inside the order's window, the payer
   matches the wallet the order was opened with, and the signature has never been
   consumed. Only then are ticket rows written, in the same transaction that
   marks the order `paid`.

Ticket numbers are allocated inside that transaction against a `FOR UPDATE` lock
on the raffle row, so two concurrent confirmations cannot both take number 41 and
cannot together exceed `max_tickets`.

### 5.2 Listing a raffle

1. `POST /api/raffles` — prize mint, ticket price, max tickets, duration. The
   server validates against the admin ceilings in `docs/operations.md`, resolves
   the asset's metadata through DAS to confirm it exists and that
   `seller_wallet` currently owns it, generates the seed and its hash, announces
   `draw_slot`, and writes a `draft`.
2. The seller pays `RAFFLE_LISTING_FEE_SOL` and transfers the NFT to
   `ESCROW_WALLET`, both from the wallet the draft names.
3. `POST /api/raffles/[slug]/publish` — both signatures. The server verifies the
   listing fee as a SOL transfer, and verifies the escrow deposit by asking the
   chain who owns `prize_mint` now and which transaction moved it: it must be
   `ESCROW_WALLET`, moved from `seller_wallet`, after the draft was created.
   Only then does the raffle become `open`.

A deposit at `ESCROW_WALLET` matching no draft is filed as an orphan for the
operator. Nothing is guessed and nothing is auto-assigned.

### 5.3 Launching a collection

1. The creator connects, fills in name, symbol, supply, price, start time, and
   selects art. Caps: at most **1,000 items** and **10 MB per image**, refused in
   the browser and re-checked before the candy machine is created. "Self-serve"
   is not "unbounded", and a cap named in `docs/operations.md` is a cap an
   operator can move without a migration.
2. The creator's wallet signs the Irys uploads. The bytes never reach this
   server.
3. The creator's wallet signs: the `LAUNCH_FEE_SOL` transfer to `PAYMENT_WALLET`,
   the Core collection creation, and the candy machine creation with guards —
   `solPayment` to the creator, `solFixedFee` to `PAYMENT_WALLET`, `startDate`,
   `mintLimit`, `botTax`.
4. `POST /api/collections/[slug]/publish` — the launch fee signature and the
   candy machine address. The server verifies the fee on-chain, reads the candy
   machine account back through the RPC proxy to confirm it exists, that its
   collection matches, and **that its `solFixedFee` guard names `PAYMENT_WALLET`
   for at least `mint_fee_lamports`**. A launch whose guard was tampered with
   does not go `live`.

Step 4's guard check is the one that makes §0.1 true rather than merely intended:
the creator assembles the transaction, so the creator can also assemble one
without our fee. Reading the deployed account back is what catches that.

---

## 6. Configuration, and being switched off

Four fees, all from environment, **no defaults anywhere in code or copy**:
`LAUNCH_FEE_SOL`, `MINT_FEE_BPS`, `RAFFLE_LISTING_FEE_SOL`, `HOUSE_FEE_BPS`.

Three variables gate whole surfaces, and their absence is a first-class state
with its own screen, never a placeholder and never a crash:

| Missing | What closes |
|---|---|
| `SOLANA_RPC_URL` | everything on-chain: launching, listing, buying |
| `PAYMENT_WALLET` | buying tickets, launching (both take money) |
| `ESCROW_WALLET` | listing a raffle (nothing to deposit into) |

The screen says what is not available and does not name the variable — that
detail goes to the server log, where configuration faults belong. The pattern is
the sibling's `PAYMENTS_UNCONFIGURED_MESSAGE`, and the reason a placeholder is
never used is that a placeholder wallet address is an address, and an address
collects money.

---

## 7. The RPC proxy

Same shape as the sibling's: server-side endpoint, method whitelist checked
before any forward, batches rejected whole if any member is outside the list,
body capped while reading, no upstream body ever relayed on any status code, and
per-`ip_hash` in-memory rate limiting.

The whitelist for this project:

- `getLatestBlockhash`, `sendTransaction`, `getSignatureStatuses` — signing.
- `getAccountInfo`, `getMultipleAccounts`, `getMinimumBalanceForRentExemption` —
  reading the candy machine and collection accounts back.
- `getBlock` — resolving `draw_slot`'s blockhash. Restricted to the fields the
  draw needs.
- `getAsset`, `getAssetsByOwner`, `getAssetsByGroup` — DAS, for prize metadata,
  escrow ownership, and a collection's mints.

Nothing else. Not `getProgramAccounts`, not `getSignaturesForAddress` on
arbitrary accounts.

---

## 8. Admin

Behind `ADMIN_TOKEN`, with the sibling's revocable sessions, lockout, and single
refusal with its time floor. `/admin` holds:

- **The payout queue.** Every raffle in `drawn`: prize mint, winner wallet,
  seller wallet, gross, house fee, seller net. Marking `paid` takes two
  signatures and verifies both (§0.5).
- **Orphan deposits.** NFTs at `ESCROW_WALLET` matching no draft.
- **Unmatched payments.** SOL that arrived and could not be applied.
- **Ceilings.** The maximum ticket price, maximum supply and maximum duration a
  seller may choose, and the launch caps. Operational, in `docs/operations.md`.
- **Cancel.** With a reason, because the public page shows it.

---

## 9. Security headers, noindex, testing, deployment

Security headers as the sibling's `next.config.ts`, with `img-src` widened to the
on-chain metadata gateways the DAS responses actually reference, and nothing
else.

The triple noindex stays until launch: `robots.ts`, `metadata.robots`, and the
`X-Robots-Tag` header — three layers because they fail in different places, and
only the header reaches a JSON route.

Testing: `vitest`, `pool: "forks"`, `fileParallelism: false`, the advisory lock
in `globalSetup`, the `disposable_database` stamp written only by
`db:migrate:test`, and truncation between tests. Until Neon exists, the runner
points at a local Postgres carrying the same stamp.

Deployment: Vercel, scope `sandler`, Neon branches `production` and `tests`.

---

## 10. Deferred, explicitly

Not "later" in the sense of forgotten — named so nobody rebuilds them by
accident: automated payouts of any kind, a signing server, VRF or any on-chain
program of our own, allowlists and guard groups, secondary royalties enforcement
beyond what Core does natively, ranking and discovery surfaces, compressed NFTs,
and any account system.

---

## 11. File layout

```
migrations/            numbered SQL, never edited once applied
scripts/migrate.mts    applies unapplied migrations; writes the disposable stamp on --test
src/lib/
  db.ts config.ts http.ts client-ip.ts base58.ts
  admin.ts admin-guard.ts
  payments/    config.ts signature.ts sol-transfer.ts orders.ts settle.ts
  raffles/     lifecycle.ts draw.ts escrow.ts tickets.ts
  launch/      collections.ts guards.ts
  chain/       das.ts cluster.ts
src/app/
  page.tsx                      live raffles + recent launches
  r/[slug]/page.tsx             a raffle
  r/[slug]/verify/page.tsx      how to recompute the winner
  c/[slug]/page.tsx             a collection
  launch/page.tsx               create a collection
  raffle/new/page.tsx           list a raffle
  admin/…                       payout queue, orphans, unmatched
  api/…
```
