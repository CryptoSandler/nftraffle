# nftraffle

A self-serve NFT launchpad on Solana whose distribution mechanism is the raffle.

`nftraffle` is a working name. The domain is not bought yet, and the name lives
in exactly three places — `package.json`, user-facing copy, and `SITE_URL` — so
a rename stays a find-and-replace plus one environment variable.

## The thesis

We are not competing with Magic Eden or Tensor on orderbook depth or curation.
The loop is:

    instant launch, no vetting  →  raffle the supply to bootstrap it  →  the
    secondary market for that collection is raffles here

Every feature is judged against those three arrows. A feature that shortens none
of them belongs to a different product. [`DESIGN.md`](DESIGN.md) §1 states this
normatively and lists what it forbids.

## Three legs

1. **Launchpad** — a creator connects a wallet, pays a flat fee in SOL, and gets
   a Metaplex Core collection and Core Candy Machine with a mint page. The
   creator signs everything and this server custodies nothing: mint proceeds go
   straight to the creator, and the platform's share is charged by the candy
   machine's own `solFixedFee` guard rather than by any code of ours.
2. **Raffles** — a seller escrows an NFT, verified on chain by exact mint and
   sending wallet, and sells tickets in SOL. The draw is commit–reveal against
   the blockhash of a slot announced before any ticket was sold. Payouts are
   made by hand and verified on chain before they are recorded.
3. **Collection pages** — every collection launched here has a page with its
   mints, its live raffles and the history of every draw. That is the market.
   Not an orderbook.

## What this codebase never does

**It holds no private key.** Not for the payment wallet, not for the escrow
wallet, not for anything. Every outbound transfer is performed by a human from a
wallet this code cannot reach, and the code's job is to *verify* it afterwards.
That is why payouts are manual and why `/admin` is a work queue rather than a
button that moves money.

The Solana Pay reference keypair minted per order has its private half discarded
at the moment of creation — generated, public half read out, never exported.

**It never accepts an uploaded image or a metadata URL.** Every image and name
comes from on-chain sources via DAS. Launch art is uploaded by the creator, paid
for by the creator, and signed by the creator.

**It never quotes a fee it did not read from configuration.** No fee has a
default anywhere in code or copy. A deployment with no fee set closes that
surface rather than charging a guess.

## Running it

Requires Node 24+, a Postgres, and nothing else to see the read-only surfaces.

```bash
npm install
cp .env.example .env.local     # then fill in DATABASE_URL and TEST_DATABASE_URL

npm run db:up                  # migrates both databases; stamps the test one disposable
npm run dev
```

A fresh deployment is a readable site that cannot yet take money. That is the
intended state: the surfaces that need a wallet, an RPC or a fee close with
their own screen and say nothing has been charged. Fill in the Solana variables
in `.env.example` to open them.

For demo data locally:

```bash
npx tsx scripts/seed-demo.mts
```

It drives the real code paths rather than inserting rows, so it doubles as a
wiring check.

### Tests

```bash
npm test
```

The suite truncates every table between tests, so it refuses to run against a
database that does not carry a `disposable_database` stamp — written only by
`npm run db:migrate:test`, and deliberately **not** by a migration, because a
migration would put it on production too. A second guard refuses if
`TEST_DATABASE_URL` and `DATABASE_URL` point at the same place. The two answer
different questions and both stay.

## Layout

```
docs/superpowers/specs/   the design spec; §0 is the analysis round behind it
docs/decisions.md         the owner's decisions, what each costs, when to revisit
docs/operations.md        rules that live in configuration, not in the schema
docs/devnet-rehearsal.md  run a whole raffle server-side on devnet, before money
docs/deploy.md            Vercel + Neon checklist, env matrix, the triple noindex
docs/first-raffle.md      pre-flight for the first raffle with real money
DESIGN.md                 §1 and §8 are normative; §2–§7 are an unbuilt direction
migrations/               numbered SQL, never edited once applied
src/lib/raffles/          draw, lifecycle, tickets, escrow, payout
src/lib/chain/            RPC, DAS, asset transfers, cluster classification
src/lib/payments/         config, signature shape, the native SOL verifier
```

## Conventions

Read [`CLAUDE.md`](CLAUDE.md) before changing anything. The rules that bite most
often:

- **Never edit a migration that has been applied.** Add the next number.
- **Every new module names its caller** in its own doc comment. "Nothing yet" is
  an acceptable answer and has to be said out loud.
- **A status is never an input.** `src/lib/raffles/lifecycle.ts` owns every
  transition; no route writes a status directly.
- **Money verdicts are read off the chain, never claimed by a caller** — the
  payer, the escrow deposit, and the payout all.
