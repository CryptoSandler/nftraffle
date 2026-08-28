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

Whether sellers should be able to set an ENFORCED minimum is the owner's open
decision and is not built. See `docs/open-questions.md` Q2: an enforced minimum
means an automatic refund path, and an automatic refund means the server moves
money, which it cannot do because it holds no private key.

## Cancelling is the operator's, and refunds are manual

Only `/admin` can cancel a raffle, and a cancellation must carry a reason
because the public page shows it to people who bought tickets.

Refunding those tickets is done by hand, from a wallet this codebase cannot
reach. There is no automated refund and no copy anywhere implies there is one.

Whether a SELLER may cancel their own raffle is open — `docs/open-questions.md`
Q3. The transition already exists with the right guards, so granting it later is
an authorisation change rather than a new mechanism.

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

## Launching: the three things to undo

The site is invisible to search engines by three independent mechanisms, and
they have to be removed together or it stays invisible while looking open:

1. `src/app/robots.ts` — change `disallow` to `allow`.
2. `src/app/layout.tsx` — drop the `robots` block from `metadata`.
3. `next.config.ts` — drop the `X-Robots-Tag` entry from `SECURITY_HEADERS`.

Each covers a different path (see the comment in `robots.ts`), which is why
there are three.
