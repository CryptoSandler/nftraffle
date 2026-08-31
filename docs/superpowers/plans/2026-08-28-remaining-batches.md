# Remaining batches — implementation plan

**Date:** 2026-08-28
**Prerequisite reading:** the spec at
[`../specs/2026-08-28-nftraffle-design.md`](../specs/2026-08-28-nftraffle-design.md),
then `CLAUDE.md`, then `docs/decisions.md`.

## What is already built

Server-side, leg 2 is complete and tested: draft creation, escrow and
listing-fee verification, ticket orders and settlement, the commit–reveal draw,
the payout verification, the admin queues, and the public pages including the
verification page. The RPC proxy, the admin session surface, the rate limiter,
the security headers and the triple noindex are in place.

**What is missing is every surface that needs a wallet in the browser**, plus
the whole of leg 1. That is what these batches are.

## Global constraints

Every task below inherits these. They are not repeated per task.

- **Test first.** The suite must be green before a merge, and a run that was
  overtaken by edits is killed and restarted, not believed.
- **Every new module names its caller** in its own doc comment, with a file and
  a line. "Nothing yet" is an acceptable answer and must be said out loud.
- **No new fee, price or limit gets a default.** A missing value closes its
  surface through `lib/surfaces.ts`.
- **The server signs nothing.** Any task that seems to need a private key on the
  server is a task that has misread the design — say so rather than adding a
  `SIGNER_SECRET`.
- **A branch that adds a migration runs against its own database**, and merges
  after any migration-free branch.

---

## Batch C — the buy panel

The one flow that already has a complete server side and no client.

### Task C1: wallet connection — DISCOVERY IS DONE

`@solana/wallet-adapter-react` was dropped before anything depended on it. The
Wallet Standard is read directly: `lib/wallet/solana-standard.ts` holds the pure
filtering (which registered wallets can sign on this chain, and how) and
`components/useSolanaWallets.ts` reads the live registry through
`useSyncExternalStore`. Both are tested; the hook has no caller yet, which is
task C2.

What remains for C1 is the CONNECT call and holding the connected account — a
few lines over `standard:connect`, not a provider library.

**The cluster disclosure is not optional and is not cosmetic.** `lib/chain/cluster.ts`
already holds `classifyEndpoints` and `paymentSafety`; the page classifies
server-side and passes down the ANSWER, never the URL. `paymentSafety` returning
`{ok: false}` disables signing and shows its message. An `unknown` cluster
blocks — refusing to sign is the safe failure. `useSolanaWallets` takes the
chain as an argument for exactly this reason: a hook that read the endpoint
itself would undo the disclosure from the other direction.

**Still to pick: how a transaction gets built.** `@solana/web3.js` went with the
adapter — it was the other half of the audit noise, via `jayson` and `uuid`.
`@solana/kit` is the successor and the likely choice; whatever is picked, check
`npm audit` before committing to it, because staying at zero is the point of
having removed the first tree.

**What was given up, and it is a real gap:** the adapter's mobile deep-linking
and its prebuilt modal. Mobile wallets implementing the Wallet Standard in their
in-app browser still work; one reachable only by deep link does not.

### Task C2: the buy panel

On `/r/[slug]`, replacing the placeholder paragraph. Flow:

1. `POST /api/raffles/[slug]/orders` with quantity and the connected pubkey.
2. Build a native SOL transfer to `payTo` carrying `reference` as a read-only,
   non-signer account. Sign and send through `/api/rpc`.
3. `POST /api/orders/[id]/confirm` with the signature.

**Retry only the reasons that can change on their own** — `not_found`,
`no_block_time`, `rpc_unavailable`. Every attempt spends the order's
verification quota, so a retry loop on a permanent failure burns the budget the
payer needs for the attempt that would have worked. `raffles/tickets.ts` already
names the retryable set; the client must agree with it, and that agreement
belongs in a pure module with a test rather than inside the component.

**The message this flow must never produce is "your payment failed" to somebody
whose payment succeeded.** `signature_reused` with the order reading `paid` is
the benign case — a dropped response to a confirm that actually settled — and
must render as success.

### Task C3: the confirm-flow decisions, extracted

A pure module (`lib/checkout.ts`) holding: is this failure retryable, what does
the payer see for each outcome, and how is a wallet error phrased. A component
that owns a wallet adapter and four phases of local state cannot be asserted
about from Node; these functions can, and they are the ones where being wrong
costs somebody money.

---

## Batch D — listing a raffle, in the browser

Server side is done (`POST /api/raffles`, `POST /api/raffles/[slug]/publish`).

### Task D1: the create form

Prize mint, ticket price, supply, duration. Validates against
`raffles/schedule.ts`'s `SELLER_LIMITS` client-side and the server re-checks.

**The floor is shown at the moment the decision is made** (spec §0.6): what the
seller receives if one ticket sells and at a sell-out, both net of
`HOUSE_FEE_BPS`, computed with `payoutSplit` so the screen and the payout use
one function. The owner has decided against an enforced minimum
(`docs/decisions.md` Q2) — do not quietly add one.

The seller's own view also needs a withdraw control, bounded to zero tickets
sold, calling `POST /api/raffles/[slug]/cancel`. The transition and the route
exist and are tested; only the UI is missing.

### Task D2: the deposit step

After the draft: show the escrow address, have the wallet send the asset and the
listing fee, then call publish. The asset transfer is built with Metaplex Core's
`transferV1`.

**Nothing here is taken on the seller's word** — `raffles/escrow.ts` re-reads
the mint, the sender, the destination, the timing and the current owner.

---

## Batch E — the launchpad

The largest batch, and the only one with no server side yet.

### Task E1: asset upload

Irys via `@metaplex-foundation/umi-uploader-irys`, signed and paid by the
creator (spec §0.2). **The bytes never reach this server.** Caps from
`docs/operations.md`: 1,000 items, 10 MB per image, enforced in the browser and
re-checked before the candy machine is created.

### Task E2: collection and candy machine creation

Core collection, then Core Candy Machine, both signed by the creator. Guards:

- `solPayment` → the creator's wallet. Mint proceeds never touch us.
- `solFixedFee` → `PAYMENT_WALLET`, `price × MINT_FEE_BPS / 10_000`.
- `startDate`, `mintLimit`, `botTax`.

**No guard groups and no allowlist** (spec §0.9). The candy machine supports
them natively, so adding a phase later is a config change on new launches.

### Task E3: `POST /api/collections/[slug]/publish`

**This task is what makes the platform fee real rather than intended.** The
creator assembles the candy machine transaction, so the creator can assemble one
without our guard. This route reads the deployed account back through the RPC
proxy and refuses to mark the collection `live` unless:

- the candy machine exists and its collection matches the row,
- its `solFixedFee` guard names `PAYMENT_WALLET`, and
- for at least `collections.mint_fee_lamports`.

Migration 001's `collections_live_is_complete` restates the same requirement in
the schema. Both stay.

### Task E4: the mint page

On `/c/[slug]`. `mintV1` from `@metaplex-foundation/mpl-core-candy-machine`.
Nothing server-side settles a mint: the guard collects our fee on chain, so
there is no payment for us to verify and no order to open. Say that out loud in
the module — the absence looks like a missing feature and is not.

---

## Batch F — orphans and unmatched

`unmatched_payments` and `orphan_deposits` are written by the settlement path
and read by nobody. Two admin screens, and a resolve action that records a note.

**This batch is the one most likely to be skipped and is the reason the sibling
project has a rule about it**: those tables accumulate real money and real
assets that could not be applied, and a queue nothing displays is a queue nobody
works. Until it exists, say so — do not let the schema imply a surface that is
not there.

---

## Batch G — the aesthetic pass

**Only after the mechanism stops changing** (DESIGN.md §10). Fills in DESIGN.md
§2–§7 and then implements them:

1. Settle the palette and MEASURE it. Every ratio asserted in a test suite, the
   way the sibling project does it, so a contrast regression fails the build.
2. The colours live in ONE module. A hex in the stylesheet is a second copy
   nothing polices and the first to drift.
3. The floor: 7:1 for body text, 8:1 for any figure somebody is about to make a
   money decision on. No text quieted with `opacity` or a `filter` — compositing
   turns a measured contrast into an unmeasured one.
