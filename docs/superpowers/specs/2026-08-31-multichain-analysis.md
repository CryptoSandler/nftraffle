# Multichain — analysis before any code

**Date:** 2026-08-31
**Status:** analysis and recommendation. **Nothing in here is built.**

The brief: nftraffle becomes multichain — Solana plus Robinhood Chain — with one
interface per concern and two adapters behind it. This document is the round
CLAUDE.md requires before a data-model change: what is chain-specific today, the
proposed seam, the strongest case against doing it now, and what survives.

---

## 0. The chain facts, verified

Checked against Robinhood's own documentation rather than recalled. Every value
in the brief holds.

| Fact | Value | Source |
|---|---|---|
| Mainnet chain ID | `4663` (hex `0x1237`) | docs.robinhood.com/chain/deploy-smart-contracts |
| Mainnet RPC | `https://rpc.mainnet.chain.robinhood.com` | same |
| Gas token | ETH — "ETH as its native gas token" | docs.robinhood.com/chain |
| Mainnet explorer | `robinhoodchain.blockscout.com` | docs.robinhood.com/chain/deploy-smart-contracts |
| Testnet chain ID | `46630` | same |
| Testnet RPC | `https://rpc.testnet.chain.robinhood.com` | same |
| Testnet explorer | `explorer.testnet.chain.robinhood.com` | same |
| Deployment | permissionless — "Anyone can interact with the network, build applications, and deploy smart contracts" | docs.robinhood.com/chain |
| Stack | Arbitrum Orbit / Nitro, settles to Ethereum, blobs for DA | docs.robinhood.com/chain |

**Two things the brief asserts that I could NOT confirm from the official docs**,
flagged rather than passed through:

- **The faucet at `faucet.testnet.chain.robinhood.com`.** Widely reported by
  third parties; absent from the official deploy page I read. Confirm it before a
  plan depends on it, because the testnet strategy in §5 does.
- **Block time.** No official figure was found, and §3.4 shows why guessing it
  is not acceptable: the draw's announcement margin is computed from it, and a
  wrong figure announces a block that arrives before the raffle closes.
  **Since resolved by measuring it** rather than taking a third party's number —
  ≈0.101 s/block, ≈35,600 blocks/hour, stable to 1.01× across 5.8 days of
  history. Method, figures and the safety direction are in
  [`docs/decisions.md`](../../decisions.md) Q8. Note this is ~2.5× faster than
  the ~250ms commonly quoted for Nitro chains, which is exactly why it was
  measured.

---

## 1. What is chain-specific today

Grepped, not remembered. The result is better than expected and it changes the
shape of the recommendation.

### 1.1 The raffle core is already almost chain-agnostic

`escrow.ts`, `payout.ts` and `tickets.ts` import **only types** from the Solana
verifier. Every actual chain call is a function passed in by the caller:

```
escrow.ts   → currentOwner, readTransfer, verify        (all injected)
payout.ts   → readPrizeTransfer, verifyProceeds         (all injected)
tickets.ts  → verify                                    (injected)
```

That was not foresight about multichain. It was testability: those functions had
to be drivable from Node without a network, so the network went behind a
parameter. **The seam the brief asks for is largely already cut**, and by
accident. That is the single most important fact in this document, because it
moves the cost of the interface from "a refactor" to "naming what is there".

The only *runtime* Solana couplings left in the raffle core are three:

| Module | Coupling | Nature |
|---|---|---|
| `tickets.ts` | `base58Encode` for the Solana Pay reference key | genuinely Solana-only (§3.3) |
| `escrow.ts` | `BLOCKTIME_SKEW_SECONDS` | a per-chain *value*, not a per-chain concept |
| `payout.ts` | `feeLamports` | pure integer arithmetic, misnamed |

`lifecycle.ts`, `listing.ts` and `draw.ts` touch no chain at all. `draw.ts` takes
a hash as a `string` and does sha256 arithmetic; it does not care where the hash
came from.

### 1.2 What IS chain-specific, by concern

| Concern | Solana today | Robinhood Chain equivalent | Difficulty |
|---|---|---|---|
| **Ticket payment** | native SOL transfer, verified by `preBalances`/`postBalances` deltas | native ETH transfer, verified by tx receipt `from`/`to`/`value` | **easy** — same shape, simpler on EVM |
| **Payment intent** | Solana Pay reference pubkey on the tx | no equivalent, and none needed | **easy**, see §3.3 |
| **Escrow deposit** | Core `TransferV1` instruction + DAS ownership | ERC-721 `Transfer` event log + `ownerOf()` | **easy** — arguably cleaner, an event is an explicit record |
| **Ownership proof** | DAS `getAsset().ownership.owner` | `ownerOf(tokenId)` `eth_call` | **easy** |
| **Asset identity** | one mint address | `(contract, tokenId)` pair | **medium** — schema change, §3.2 |
| **Asset metadata** | DAS, one call | `tokenURI()` then fetch off-chain JSON | **medium** — the JSON is off-chain and attacker-controlled, §3.5 |
| **Draw anchor** | future slot's blockhash | future block's hash | **medium**, and the trust assumption weakens — §3.4 |
| **Payout** | manual transfer, verified after | identical, different verifier | **easy** |
| **Launchpad** | Metaplex Core Candy Machine, `solFixedFee` guard | **no vendor program exists** — we write the contract | **hard, and categorically different** — §4.3 |

---

## 2. The proposed interface

One interface, two adapters. Deliberately narrow: every method below exists
because some module already calls something shaped like it.

```
type ChainId = "solana" | "robinhood"

interface ChainAdapter {
  id, nativeSymbol, decimals, blocktimeSkewSeconds

  // identity and formatting
  isAddress(value)                → boolean
  isTxId(value)                   → boolean
  formatNative(amount: bigint)    → string
  assetRef(raw)                   → AssetRef | null      // parses the stored identity

  // money in: tickets, listing fee, launch fee
  verifyNativeTransfer({ txId, recipient, minAmount, expectedPayer?, window? })
                                  → TransferResult

  // the prize
  readAssetTransfer(txId, asset)  → AssetTransferResult   // who sent what, where, when
  assetOwner(asset)               → address | null
  assetMetadata(asset)            → { name, image } | null

  // the draw's anchor
  currentHeight()                 → bigint | null
  hashAtHeight(height)            → string | null
  announceHeight({ currentHeight, nowMs, endsAtMs }) → bigint

  // payment intent, where the chain has one
  paymentReference()              → string | null         // Solana: a pubkey. EVM: null.
}
```

**Every existing signature already matches.** `verifyNativeTransfer` is
`verifySolTransfer` with `lamports` renamed; `readAssetTransfer` is
`readAssetTransfer` unchanged; `assetOwner` is `assetOwner` unchanged. The
adapters wrap code that exists rather than replacing it.

### 2.1 Technical decisions taken, and their costs

**D1 — Amounts are one `bigint` in the chain's smallest unit, with `decimals` on
the adapter.** Not a per-chain numeric type. `formatNative` is the only thing
that needs to know 9 from 18.
*Cost:* the schema's `*_lamports` columns become actively misleading the moment
they hold wei — a reader is wrong by a factor of 10⁹. **That forces a rename
migration, and the rename is not cosmetic**: it is the difference between a
column a reader can trust and one that lies. Migration 004 renames
`amount_lamports` → `amount_native`, `ticket_price_lamports` →
`ticket_price_native`, and the four others, and adds `chain` to `raffles`,
`ticket_orders` and `collections`.

**D2 — Asset identity is one opaque string per chain, parsed only by the
adapter.** Solana stores the mint. EVM stores `<contract>/<tokenId>`.
*Why not two columns:* `prize_contract` + `prize_token_id` would be honest about
structure and leave a NULL column that is meaningless on half the rows, and the
database never needs to reason about the parts — only the adapter does. The
existing `raffles_live_prize` unique index keeps working unchanged on the opaque
string, which is the constraint that stops two drafts claiming one asset.
*Cost:* an operator reading SQL sees `0xabc…/42` and needs to know the encoding.
Documented in the migration.

**D3 — `HOUSE_FEE_BPS` and `MINT_FEE_BPS` stay unsuffixed; the amount fees get a
chain suffix.** The brief says suffix all of them. A basis point is a ratio with
no currency in it, so `HOUSE_FEE_BPS_SOLANA` and `HOUSE_FEE_BPS_ROBINHOOD` would
be two names for one policy that will always be set to the same number.
*Applied recommendation:* suffix the two amount fees
(`RAFFLE_LISTING_FEE_SOLANA`, `RAFFLE_LISTING_FEE_ROBINHOOD`, likewise the launch
fee), leave the two bps fees shared. **Left as a question in §6** because it is
the one place I am departing from the brief's letter.

**D4 — Wallets: EIP-6963 read directly, exactly as the Wallet Standard now is.**
The EVM analogue of what was just built is EIP-6963 multi-injected provider
discovery — a browser event announcing each injected provider, filterable the
same way. No wagmi, no RainbowKit, no connector library.
*Why this is not dogma:* the audit was cleaned an hour ago by removing a wallet
library, and reaching for a heavier one on the EVM side would undo that for the
same convenience. `lib/wallet/solana-standard.ts`'s shape ports directly.
*Cost:* no WalletConnect, so no mobile-wallet-by-QR on EVM either.

**D5 — Verification reads the RPC, with Blockscout as a fallback for logs only.**
`eth_getTransactionReceipt` gives the ERC-721 `Transfer` log and the native
value; `eth_call` gives `ownerOf`. Blockscout is used only where a range scan is
needed (finding a payment whose payer never came back — §3.3), never as the
source of truth for a verdict.
*Why:* an explorer is a re-indexer. A verdict about somebody's money should come
from the chain, and the brief's "sin oráculo propio" says the same thing.

---

## 3. The five concerns in detail

### 3.1 Ticket payments — easiest, and slightly better on EVM

`verifySolTransfer` derives the payer from the largest signer debit because
Solana's `preBalances`/`postBalances` are positional and include the fee. An EVM
receipt states `from`, `to` and `value` directly. The payer-derivation subtlety
that module documents at length simply does not arise.

Everything else transfers unchanged: the window binding, the payer binding, the
"signature already claimed" PRIMARY KEY, the retryable-vs-permanent split.

### 3.2 Escrow — cleaner on EVM

A `Transfer(from, to, tokenId)` event in the receipt is an explicit record of the
movement, where the Solana path has to match instruction account positions and
then re-check ownership through DAS because it does not decode the instruction
data (`asset-transfer.ts` says so out loud).

**The two-question discipline still applies unchanged**: the event says a deposit
happened, `ownerOf` says the asset is still there, and the deposit-and-withdraw
attack needs both to be asked. Nothing about EVM removes that.

### 3.3 The payment reference — Solana-only, and that is fine

Solana Pay's reference pubkey exists so a reconcile pass can find a payment whose
payer never came back with a signature. EVM has no such convention.

It also does not need one: `eth_getLogs` / Blockscout can list transfers to
`PAYMENT_WALLET_ROBINHOOD` over a block range, and match by `(from, value,
block window)` against pending orders. **That is strictly more capable than the
reference key**, which only works if the payer's client attached it.

*Schema consequence:* `ticket_orders.reference_pubkey` is `NOT NULL UNIQUE`
today. It becomes nullable, and `paymentReference()` returns null on EVM.
*Named risk:* a nullable UNIQUE column is fine in Postgres — NULLs do not
collide — but the "one reference per order" guarantee then holds only on Solana.
The EVM side's equivalent guarantee is `consumed_signatures`, which already
covers both.

### 3.4 The draw — this is where the product gets weaker, and it must be said

The mechanism ports directly in shape: commit `sha256(seed)` at creation,
announce a future height, reveal at close, derive from
`sha256(seedHash + seed + hash + raffleId)`. `draw.ts` needs no change at all.

**But the trust assumption is not the same, and DESIGN.md §8.4 forbids pretending
it is.**

On Solana, a future slot's blockhash is unknowable to everyone, including the
validators, far enough ahead. On an Arbitrum Orbit chain the sequencer is a
single operator — here, Robinhood's. A future block's hash is unknowable to *us*,
which preserves the property that **we** cannot bias the draw; it is not
unknowable to the party ordering the blocks.

So the honest statement on a Robinhood Chain raffle's verify page is narrower:
*we cannot bias this, and the chain's sequencer is trusted not to.* That is a
real, publishable claim. It is a weaker one, and the page must make the
distinction rather than reuse the Solana wording.

**Second, smaller issue:** `announceDrawSlot`'s margin is derived from Solana's
400ms slot target, with a documented safety direction — skipped slots make the
chain advance *slower* than the clock, so the announced slot arrives later than
intended, never earlier. **That reasoning does not transfer**: an EVM chain's
block number advances on its own schedule and the equivalent margin must be
derived from a measured block time on the live chain. `announceHeight` therefore
belongs on the adapter, with its own defended constant and its own test asserting
the reason is still written down.

### 3.5 Metadata — the one place EVM is meaningfully worse

DAS returns name and image in one call, already parsed. ERC-721 gives
`tokenURI()`, which is a URL to JSON somebody else hosts, which contains a URL to
an image somebody else hosts.

That is an off-chain fetch of attacker-controlled content, on a page we render.
The existing `img-src` allowlist in `next.config.ts` handles the image; the JSON
fetch is new and needs its own bound — size cap, timeout, no redirects to private
ranges. **It is the only genuinely new class of risk in the raffle half of this
work**, and it is manageable.

---

## 4. The strongest case against doing this now

Not caveats. The version that would change the decision if true.

### 4.1 Liquidity does not split; it halves

The thesis is a two-sided market with no liquidity yet. Arrow three — "the
secondary market for that collection is raffles here" — is the arrow most
sensitive to fragmentation. Two chains means a raffle with three tickets on each
instead of six, twice the surface to explain, and a buyer who has to care which
chain a prize is on before they can want it.

Judged against the loop, a second chain makes arrow three **weaker**, and arrows
one and two no stronger. That is the test CLAUDE.md says to apply, and this fails
it as stated.

### 4.2 Robinhood Chain has no NFT audience

It launched on 1 July 2026 for tokenized equities and real-world assets. It is
permissionless and technically fine. But "pump.fun for NFTs" needs NFT
collectors, NFT wallets, and people who already want to gamble on JPEGs — and
that population is on Solana, not on a tokenized-stock L2 two months old.

**This is the argument I find hardest to answer.** The engineering is
straightforward; the demand is the question. Building a correct raffle mechanism
for a chain with no collectors produces a correct, empty product.

The counter, and it is not nothing: being first on a chain with distribution
behind it is a real bet, and Robinhood's user base is enormous. If that base ever
gets an NFT surface, being early matters. That is a bet on Robinhood's roadmap,
not on our code.

### 4.3 The launchpad on EVM destroys this project's best safety property

Today the strongest sentence in the README is that **we wrote no on-chain
program**. The platform fee is enforced by Metaplex's audited candy machine, not
by us. `CLAUDE.md` has a whole section on it: "which guard already is this".

On Robinhood Chain there is no candy machine. Leg 1 there means we write the
collection contract, it holds the mint logic and the fee, creators deploy it from
a factory we deployed, and **a bug in it is a bug in somebody else's money, on a
contract that cannot be patched**. That is a categorically different risk from
anything in this repository, and it is not made smaller by an audit — an audit
reduces it, it does not move it back to zero the way "we deployed nothing" did.

The brief already separates it into its own batch with review before deploy,
which is the right instinct. I would go further: it is the piece to defer
hardest.

### 4.4 Nothing on the Solana side has run yet

Batches C, D and E are unbuilt. No ticket has ever been bought, no raffle has ever
been drawn against a real slot, no payout has ever been verified against a real
transfer. Adding a second chain now doubles the surface of work whose first
version has not been proven once.

The specific failure this invites: a bug in the shared core gets found on chain
two and fixed twice, or gets attributed to the adapter when it is in the core.

---

## 5. Recommendation

**Cut the seam now. Ship the second chain later.**

Three parts, and the order matters:

1. **Do the interface and the rename now, while nothing is deployed.** The seam
   is 80% cut already (§1.1) and the migration that renames `*_lamports` and adds
   `chain` is free today and expensive after the first real raffle. This is the
   cheapest hour this work will ever cost. It also forces the Solana
   implementation behind an interface, which is good for it regardless.

2. **Build the Robinhood adapter and its tests against testnet/mocks, but do not
   open the surface** until one real Solana raffle has run end to end. The
   adapter can be complete and `surfaceState` can still answer "closed" for that
   chain — the mechanism for that already exists and is tested.

3. **Defer the EVM launchpad hardest**, exactly as the brief sequences it, and
   treat the contract as its own project with its own review, not as a batch of
   this one.

**Where I differ from the brief:** it asks for Robinhood Chain raffles built and
presumably live. I would build them and keep the surface closed until Solana has
proven the core once. If that is overruled, the work order is unchanged — only
the moment the surface opens moves — so this is a cheap disagreement to have.

---

## 6. Product questions — ANSWERED 2026-08-31

**These were put to the owner and all six are decided.** The answers, with cost
and trigger, are Q7–Q12 in [`docs/decisions.md`](../../decisions.md); that file
is the live source and this section is kept as the record of what was asked.

Two answers went against the recommendation below, and both are recorded there:
fees are suffixed per chain including the basis-point ones (P1 overruled), and
the chain is named in the collection route (P3 sharpened to `/c/[chain]/[slug]`).
The block time in §3.4 has since been **measured** rather than assumed —
≈0.101 s/block, and the safety direction is the opposite of Solana's.

**P1 — Should the two `*_BPS` fees stay unsuffixed?** *Applied:* yes, shared;
only amount-denominated fees get a chain suffix. A ratio has no currency, and two
names for one policy drift. Overruling this is one line.

**P2 — Does a raffle name its chain in its URL?** *Applied:* no — the slug stays
global and the chain is a column. Two raffles on two chains are still two
raffles, and `/r/<slug>` staying stable matters more than a tidy namespace.

**P3 — Can one collection page show raffles from both chains?** *Applied:* no.
An asset exists on one chain; a collection page is per chain. Merging them would
imply a bridge that does not exist.

**P4 — Do the Solana and Robinhood house fees have to be equal?** *Applied:*
they are the same variable, so yes (see P1). If pricing should differ per chain —
plausible, since gas and audience differ — that is P1 flipped.

**P5 — Is the weaker draw claim acceptable on Robinhood Chain?** §3.4 means a
Robinhood Chain raffle's verify page says something narrower than Solana's. That
is publishable and honest. Whether the product wants two different fairness
claims on two chains is a positioning decision, not an engineering one. *Applied:*
say the narrower thing, per chain, and never reuse the Solana wording.

**P6 — Does the EVM launchpad happen at all?** §4.3 is the strongest argument in
this document. *Applied:* keep it sequenced last and treat the contract as a
separate project. Not built, not started, and worth a deliberate yes before it is.
