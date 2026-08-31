# Operating rules

Decisions that live in configuration rather than in the schema, and are
therefore only true while somebody keeps them true.

A rule an operator can read and break is a rule that can be revisited; a
constraint is a rule that has to be excavated. Everything below is deliberately
the first kind — see CLAUDE.md, "Decisions with a door", for when something
belongs here rather than in a `CHECK`.

---

## The mint fee is frozen when a collection launches

**`MINT_FEE_BPS` applies to collections launched AFTER you change it. It never
reaches a candy machine that is already deployed.**

This is arithmetic, not policy. The platform's cut is charged by the candy
machine's own `solFixedFee` guard (spec §0.1), and that guard takes a fixed
number of lamports rather than a rate. The lamports are computed once, from the
mint price and the rate in force at that moment, and written into an immutable
on-chain account.

`collections.mint_fee_lamports` and `collections.mint_fee_bps` record what each
collection actually charges, and the collection page reads the row rather than
the current setting — so a page can always say what a given collection charges,
even when that disagrees with what a new launch would charge today.

**What this means in practice.** Raising the fee does not increase revenue from
existing collections, and lowering it does not relieve them. If a live
collection's fee has to change, the candy machine has to be replaced, which
means a new mint page and a new address. Treat the number as close to permanent
per launch and set it deliberately.

**Why not enforce the fee in our own code instead, so it could be changed
freely?** Because code we control is code that is not in the enforcement path.
The candy machine is a public on-chain account and its mint instruction is
public; a minter who assembles their own transaction omits any instruction our
client would have appended. A fee that a determined minter can skip is not a
fee, it is a suggestion with a UI.

## The house fee is frozen when a raffle is listed

Same shape, different reason. `raffles.house_fee_bps` is written when the seller
creates the draft, and every payout reads the row.

Here it is not arithmetic — nothing on chain forces it — it is fairness. A
seller committed an asset to escrow on the strength of a number they were shown.
Reaching back and taking more of a sale they already agreed to would be changing
the terms after the goods were handed over, and the fact that we technically
could is exactly why the schema is written so that we do not.

## Ceilings a seller may not exceed

**Not in the schema, deliberately.** These bound what a seller may choose and
they are judgement calls, not invariants:

| What | Suggested ceiling | Why a ceiling at all |
|---|---|---|
| Ticket price | 10 SOL | A mis-typed price is a raffle nobody can enter, and the seller does not find out until it closes empty. |
| Tickets per raffle | 10,000 | The draw writes one row per ticket and the verification page lists them all. Past this the page stops being readable, which defeats its purpose. |
| Raffle duration | 30 days | Escrow holds somebody else's property for the whole window, and every day of that is a day the operator is responsible for an asset they cannot sell, move or insure. |

The ticket ceiling is the only one with a mechanical reason behind it. The other
two are operational and can move.

## Launch caps

| What | Cap | Why |
|---|---|---|
| Items per collection | 1,000 | "Self-serve" is not "unbounded". Each item is an upload the creator pays for and a row the candy machine has to be loaded with. |
| Image size | 10 MB | Above this the upload becomes the slowest part of the flow, and the first arrow of the loop is "instant". |

Both are enforced in the browser and re-checked before the candy machine is
created. Neither is in the schema, because both are about what is reasonable
today rather than about what the data model can represent.

## No minimum sales, and the seller is shown the floor

**A raffle draws on whatever sold.** There is no minimum and none is enforced,
so a raffle that sells one ticket transfers the prize for one ticket's price.

The mechanism is not the risk — a seller who did not do the arithmetic is. So
the create screen shows what they receive at one ticket and at a sell-out, net
of the house fee, at the moment they set price and supply.

**Decided: no enforced minimum** (`docs/decisions.md` Q2). An enforced minimum
means an automatic refund path, and an automatic refund means the server moves
money — which it cannot do, because it holds no private key. So "yes" was never
a field on a form.

## Cancelling is the operator's, and refunds are manual

A cancellation must always carry a reason, because the public page shows it to
people who bought tickets.

**A SELLER may cancel their own raffle, but only while zero tickets have sold**
(`docs/decisions.md` Q3) — `cancelRaffleAsSeller`, via
`POST /api/raffles/[slug]/cancel`. With nothing sold there is nobody with a
claim, so the asset simply returns to escrow for an operator to hand back.

**An OPERATOR may cancel at any point before payout**, including with tickets
sold, because refunding those is work the operator is signing up for. A seller
cannot volunteer that work.

Refunds are done by hand either way, from a wallet this codebase cannot reach.
There is no automated refund and no copy anywhere implies there is one.

## The two wallets are separate, and both are exclusive to this project

`PAYMENT_WALLET` receives fees and ticket money. `ESCROW_WALLET` holds prizes.

**They must be two different wallets, and neither may be a wallet another
project uses.** Fees are ours; escrowed assets are not. Keeping them in one
wallet makes "what do we actually owe people right now" unanswerable at exactly
the moment somebody asks it — and sharing a receiving wallet across projects
means two independent verifiers looking at the same transfers.

## A payout is verified before it is recorded

The operator sends both transfers by hand and then pastes both signatures.
**The server checks them on chain before it accepts the mark** — the exact prize
mint out of escrow to the winner, and the seller's net to the seller.

A signature that does not check out is refused, not stored with a warning. This
occasionally means an operator who really did send the right transfers has to
wait for confirmation and try again, and that cost is accepted deliberately: the
public raffle page shows this mark to the person who did not send the transfers,
and it is the only thing that person has.

## Test databases

**A branch that adds a migration runs against its OWN database**, deleted when
the branch merges. Branches that add no migration share `tests`.

**Merge order follows from this and is not optional.** The branch without
migrations merges first; the one with them rebases on top and re-runs. The
reverse puts the migration-free branch on a `main` whose database has already
moved.

## Opening the second chain

**One switch: `OPEN_CHAINS` in `src/lib/surfaces.ts`.** Setting the
`*_ROBINHOOD` variables does NOT open it, and a test asserts that — configuration
and permission are deliberately two different things, so a deployment can be
fully configured for a chain it is not yet serving.

**The condition is not a green test suite.** It is one real raffle run end to end
on Solana: a ticket bought, a draw revealed against a real announced slot, and a
payout verified against real transfers. The point of the delay is that a bug in
the shared core gets found once, on the chain that has the audience, instead of
being fixed twice or blamed on an adapter.

Before opening it, three things need doing that are deliberately deferred:

1. **The ticket-price ceiling is one number for both chains** and is meaningful
   on Solana only — ten SOL and ten ETH are not comparable sums. Make
   `SELLER_LIMITS.maxTicketPriceNative` per chain.
2. **`assetMetadata` returns null on Robinhood.** ERC-721 metadata needs a
   bounded `tokenURI` fetch — size cap, timeout, no redirects into private
   ranges — and a half-bounded fetch of attacker-controlled JSON is worse than
   none.
3. **`/api/rpc` is Solana-only.** The browser proxy exists so the endpoint stays
   server-side; the second chain needs its own route rather than a chain
   parameter, because a caller-selected upstream is a caller-selected upstream.

## Block time on Robinhood Chain, and why it is measured

**≈0.101 s/block, measured 2026-08-31**, not taken from a third party — the
commonly quoted figure for Nitro chains is ~250ms, which is 2.5× wrong here. The
measurement and its method are in `src/lib/chain/robinhood/constants.ts`.

**The safety direction is the opposite of Solana's**, which is the part worth
remembering. Solana can only lag, so an announced slot arrives late and late is
harmless. Robinhood Chain running *faster* than measured would surface the
announced block's hash while tickets are still selling. The margin is therefore
computed at twice the measured rate.

**Re-measure if anything about the chain's cadence changes.** The constant
carries its date so staleness is visible rather than assumed.

## Launching: the three things to undo

The site is invisible to search engines by three independent mechanisms, and
they have to be removed together or it stays invisible while looking open:

1. `src/app/robots.ts` — change `disallow` to `allow`.
2. `src/app/layout.tsx` — drop the `robots` block from `metadata`.
3. `next.config.ts` — drop the `X-Robots-Tag` entry from `SECURITY_HEADERS`.

Each covers a different path (see the comment in `robots.ts`), which is why
there are three.
