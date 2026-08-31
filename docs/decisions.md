# Decisions

The questions this repository deliberately refused to answer on the owner's
behalf, and the owner's answers. Q1–Q6 are the product questions raised by the
original spec; Q7–Q12 come from the multichain scope change. **All decided
2026-08-31.**

Each entry records what was decided, where it is applied, and — the part worth
keeping — what the decision costs and what would make it worth revisiting. A
decision with no recorded cost reads later as a decision nobody thought about.

This file replaces `docs/open-questions.md`. New open questions go in a new
"Still open" section at the bottom rather than back into a separate file, so
there is one place to look.

---

## Q1 — Jurisdictions: no geo-blocking

**Decided: no geo-blocking in code. The notice lives in terms, not in a request
handler.**

**Where it is applied.** Nowhere in the code, which is the point. There is no
block list, no country check, and no refusal screen. DESIGN.md §8.1 already
forbids copy that promises legality, and that stays — silence about legality is
now a *decided* silence rather than an unexamined one.

**What it costs.** Every jurisdiction reaches the product, including ones where
a raffle for value is a regulated lottery. The exposure is real and it is
accepted deliberately at this scale.

**What makes it worth revisiting.** Volume, a payment partner that asks, or a
specific jurisdiction making contact. The mechanism to add it later is cheap —
`clientIp` already resolves a trustworthy address for rate limiting, so a geo
decision would have an identity to hang off without a new mechanism. Nothing in
the schema or the request path needs to change in advance, and nothing has been
built in advance.

**The one thing that must not happen quietly:** adding a terms page that asserts
legality anywhere. The terms notice is the owner's text, written once,
deliberately.

## Q2 — No enforced seller minimum

**Decided: the seller is shown the floor and is not protected from it.**

**Where it is applied.** `raffles/payout.ts`'s `payoutSplit` is the one function
that computes it, and the seller's create screen shows what they receive at one
ticket and at a sell-out, net of `HOUSE_FEE_BPS` (Batch D task D1). No minimum
is enforced anywhere and none should be added.

**What it costs.** A rare asset can transfer for one ticket's price. That is the
mechanism working as designed, not a failure of it.

**Why the alternative was not taken, and this is the load-bearing part.** An
enforced minimum means an *automatic* refund path when the bar is not met, and
an automatic refund means the server moves money — which it cannot do, because
it holds no private key. So "yes" was never a field on a form; it was either a
manual queue at a scale humans cannot serve, or the first feature that needs a
signing server and a new threat model.

**What makes it worth revisiting:** nothing short of the server gaining the
ability to sign, which is a different conversation entirely.

## Q3 — A seller may cancel, only with zero tickets sold

**Decided: yes, bounded at zero tickets.**

**Where it is applied.** `cancelRaffleAsSeller` in `raffles/lifecycle.ts`, with
`POST /api/raffles/[slug]/cancel` as its caller. Both bounds — the caller is the
raffle's own seller, and no ticket has been sold — are checked inside a
transaction holding `FOR UPDATE` on the raffle row, the same lock
`settleTicketOrder` takes before it allocates ticket numbers. Without that lock,
a settlement committing between the count and the update would leave a cancelled
raffle holding a paid ticket.

Two entry points, two authorisations, **one transition**. The operator's
`cancelRaffle` may still cancel a raffle with tickets sold, because refunding
them is work the operator is signing up for. A seller cannot volunteer that work.

**What it costs.** Almost nothing, which is exactly why the bound is what makes
it safe: with zero tickets sold there is nobody with a claim, so the worst
outcome is that a seller's own asset stops being raffled and sits in escrow until
an operator returns it.

**What would have to change if the bound moves.** `POST /api/raffles/[slug]/cancel`
currently takes the seller wallet as a claim rather than proving it with a
signature, and that is only defensible because naming somebody else's wallet
cancels nothing and a zero-ticket raffle has no victim. **If a seller is ever
allowed to cancel a raffle with tickets sold, that route needs a
challenge/verify signature first.** The route's own comment says so.

## Q4 — The copy promises nothing about an unrevealed seed

**Decided: name the state, promise no timetable.**

**Where it is applied.** `/r/[slug]/verify` renders "committed but never
revealed" as an explicit, named state — not an empty section and not a spinner —
and says the draw cannot be checked by anyone, including us, until the seed is
published. It stops there. There is no "refunded within N hours", no "we will
always reveal", and none may be added without the owner deciding to.

**What it costs.** A buyer looking at a stalled raffle is told what is true and
not what happens next, which is less reassuring than a promise would be.

**Why that is the right trade.** The commit–reveal scheme makes a biased draw
impossible and a withheld one obvious. It cannot make withholding impossible
without an on-chain program, which this project does not have. A promise about
what happens next is a promise about our own labour and our own money, and
writing it into a public page is the kind of sentence a product cannot walk back.

## Q5 — Every collection gets a page; outside ones are DAS-only

**Decided: a page for any collection, not only the ones launched here.**

**Where it is applied.** `/c/[slug]` now resolves two ways. A slug matching a
row in `collections` is a collection we launched, and shows the numbers we
recorded — supply, mint price, and the fee that specific candy machine charges.
A slug that is a Solana address is a collection we did not launch, and
**everything shown comes from DAS and nothing else**: `rafflesByPrizeMints` in
`raffles/listing.ts` joins it to raffles here by asking the chain which
collection each prize belongs to, because `raffles.collection_id` is NULL for an
outside asset.

**The asymmetry is deliberate and visible.** An outside collection's page
carries fewer facts and says so in a sentence: not launched here, nothing below
is ours. No supply we did not verify, no price, no fee — inventing those would
make an outside collection look like one we stand behind.

**What it costs.** DAS calls per page view, bounded at 200 items and 500 mints,
and a page that can be created for any address by anybody who visits the URL.
Nothing is written to the database by visiting one.

**What this changes about leg 3.** "The market lives here" now means the raffles
here for any collection, not only ours. That is a bigger claim than the spec
originally made and it is the owner's call.

## Q6 — `SUPPORT_CONTACT` follows the siblings' convention

**Decided: the same convention bidoor and pixelwar use — a `support@` inbox on
this project's own domain.**

**One correction worth recording, because "the same channel" is not quite what
exists.** There is no single shared mailbox across the three projects: bidoor
uses `support@bidoor.lol` and pixelwar uses `support@pixelwar.fun`. What they
share is the *convention*, one address per domain. This project follows it.

**Where it is applied.** `.env.example` documents the convention and the
variable is **left empty**, because this project has no domain yet. Writing
`support@<working-name>` would be exactly the placeholder that file's own first
rule forbids — an address that looks routable and is not, printed to somebody
whose money is missing. `supportContact()` returning null is a supported state
and the copy degrades to "this has been recorded".

**Action for the owner:** set it the day the domain is bought. It is on the
owner-only list.

---

# Multichain — decided 2026-08-31

The scope change to Solana + Robinhood Chain. The analysis that preceded these is
[`docs/superpowers/specs/2026-08-31-multichain-analysis.md`](superpowers/specs/2026-08-31-multichain-analysis.md);
its six open questions are answered here.

**The sequence, approved as recommended:** cut the adapter seam and do the
`*_lamports` rename now while nothing is deployed; build the Robinhood adapter
against testnet; **keep the Robinhood surface closed until one real raffle has
run end to end on Solana.**

*What that costs:* the second chain is finished and invisible for a while, which
feels like waste. *What it buys:* a bug found in the shared core is found once,
on the chain that has the audience, instead of being fixed twice or misattributed
to the adapter. The mechanism for a closed surface already exists and is tested.

## Q7 — The Robinhood verification page says the narrower thing

**Decided: the Robinhood Chain draw claim is stated narrowly and never reuses the
Solana wording.**

On Solana a future slot's hash is unknowable to everyone. On an Arbitrum Orbit
chain the sequencer is a single operator, so a future block hash is unknowable to
**us** — which preserves the property that we cannot bias the draw — but is not
provably unknowable to the party ordering the blocks.

**What is applied.** Two distinct texts, per chain. The Robinhood page says we
cannot bias the outcome and that the chain's sequencer is trusted not to. It does
not say "nobody can know", because on that chain it is not true.

**What it costs.** A strictly weaker claim on one chain, and two pieces of copy
to keep honest instead of one. DESIGN.md §8.4 already requires exactly this — a
page that only says "provably fair" has proved nothing.

**Trigger to revisit:** Robinhood Chain decentralising its sequencer, or adding a
verifiable randomness source. Either would let the claim widen.

## Q8 — Block time is measured, not taken from third parties

**Decided: measure it against the chain, derive the announcement margin from the
measurement, and write down the slack.**

**Measured 2026-08-31 against `https://rpc.mainnet.chain.robinhood.com`**, at
head block 50,960,711, over spans of 1,000 to 5,000,000 blocks (the widest
covering ~5.8 days):

| span (blocks) | elapsed s | s/block |
|---:|---:|---:|
| 1,000 | 101 | 0.1010 |
| 10,000 | 1,016 | 0.1016 |
| 100,000 | 10,078 | 0.1008 |
| 1,000,000 | 101,053 | 0.1011 |
| 5,000,000 | 504,818 | 0.1010 |

**≈0.101 s/block, ≈35,600 blocks/hour**, with a 1.01× spread across every span.
A first attempt sampling 40 consecutive blocks was discarded: 4 seconds of span
against 1-second timestamp resolution measures the resolution, not the chain.

**The safety direction is OPPOSITE to Solana's, and this is the finding that
matters.** On Solana, skipped slots make the chain advance *slower* than the
clock, so an announced slot arrives later than intended — never earlier, which is
the safe direction. On Robinhood Chain the failure that hurts is the chain
running *faster* than estimated, because then the announced block — and its hash
— arrives while tickets are still selling.

**What is applied.** The margin is computed from the *fastest* observed rate and
then doubled, so the announced block lands after the close even if the chain runs
at twice the measured speed. `announceHeight` lives on the adapter with its own
defended constant, its own recorded measurement and date, and a test asserting
the reasoning is still written down — the same discipline `schedule.ts` already
has for Solana.

**Trigger to revisit:** any observed rate outside 0.05–0.20 s/block, or a
sequencer upgrade. The measurement carries its date so staleness is visible.

## Q9 — Fees, RPC and ticket prices are per chain, with no conversion

**Decided: suffix all fee variables by chain, one RPC per chain by env, and price
tickets in each chain's native currency with no conversion.**

This **overrules the recommendation in the analysis (P1)**, which argued the two
basis-point fees should stay shared because a ratio has no currency. The owner's
call is uniformity, and it is the better one for a reason the analysis
underweighted: gas costs, audience and price expectations differ per chain, so a
house fee that must be equal across chains is a constraint nobody asked for.

**What is applied.** `LAUNCH_FEE_*`, `RAFFLE_LISTING_FEE_*`, `MINT_FEE_BPS_*`,
`HOUSE_FEE_BPS_*`, and one RPC URL per chain. Existing unsuffixed names —
`PAYMENT_WALLET`, `ESCROW_WALLET`, `SOLANA_RPC_URL` — gain the suffix in the same
change.

**No conversion, anywhere.** A ticket costs SOL on Solana and ETH on Robinhood
Chain, and the two numbers are never compared, summed or displayed in a common
unit. A price feed in the money path would bring its own outage, staleness window
and manipulation surface, to serve a comparison nobody needs.

**What it costs.** Eight fee variables instead of four, and a deployment can be
misconfigured on one chain while working on the other — which the closed-surface
mechanism already handles per chain.

**Trigger to revisit:** nothing foreseeable. Renaming is free today because
nothing is deployed, and expensive after; that is why it happens in the seam
batch and not later.

## Q10 — A collection lives on one chain: `/c/[chain]/[slug]`

**Decided: routes carry the chain; there are no cross-chain collection pages.**

**What is applied.** `/c/[slug]` becomes `/c/[chain]/[slug]`. A collection page
shows raffles on that chain only. This supersedes the analysis's P3 by making the
chain explicit in the URL rather than implicit in the slug.

**What it costs.** A URL change to a route that already shipped, and the
outside-collection page from Q5 now needs its chain named too — a Solana mint and
an EVM contract address are not distinguishable by shape alone in every case, so
the route stops having to guess.

**What it buys.** An asset exists on exactly one chain. Merging two chains' views
of "a collection" would imply a bridge that does not exist, and the first person
to notice would be someone who assumed their NFT was reachable from the other
side.

**Trigger to revisit:** a real bridge, which would make one collection genuinely
exist on two chains. Not before.

## Q11 — The EVM launchpad is deferred behind a gate, and never on our own contract

**Decided: deferred, with an explicit gate, and constrained if it ever happens.**

**The gate** — both must hold before work starts:

1. one real raffle has run end to end on Robinhood Chain, and
2. there is demonstrated creator demand for launching there.

**The constraint, recorded as invariant I2 in [`SECURITY.md`](../SECURITY.md):**
if it is built, it is built on a **third-party ERC-721 factory that is already
audited and already deployed**. This project does not write, deploy or upgrade a
contract that holds or routes fees.

**What it costs, and this is not a small thing.** A third-party factory does not
know about us, so it will not collect our platform fee. On EVM the mint fee is
therefore either collected outside the mint — which a minter can skip, making it
a suggestion rather than a fee — or replaced by a larger launch fee, or not
charged. **That choice decides whether the leg has a business model, and it has
to be made before any EVM launchpad work begins.** SECURITY.md I2 says the same.

**What it buys.** The strongest property this project has: a full compromise of
the server moves no money, and no bug of ours is deployed immutably over somebody
else's funds.

**Trigger to revisit:** the gate above, plus an answer to the fee question.

## Q12 — Transaction building: `@solana/kit` and `viem`

**Decided by me, per the brief, with audit evidence taken before committing.**

Measured 2026-08-31 in a scratch project:

| package | vulnerabilities | packages installed |
|---|---|---|
| `@solana/kit` | 0 | 48 |
| `+ viem` | 0 | 61 total |

`@solana/web3.js` is not an option: it was half the audit noise removed with the
wallet adapter, via `jayson` and `uuid`. `@solana/kit` is its successor and is
clean. `viem` is the EVM counterpart, clean, and adds 13 packages.

**Neither is installed yet.** They arrive with the code that uses them, in the
seam batch — a dependency added ahead of its caller is the pattern this repo has
a rule against. The audit numbers are recorded here so the decision is evidenced
rather than assumed, and **the audit is re-checked at install time**, because a
clean result today is a measurement, not a guarantee.

**Trigger to revisit:** either package acquiring an advisory, which is what
`npm audit` in the close check is for.

## Q6 (restated) — `SUPPORT_CONTACT` stays empty until the domain

Reaffirmed unchanged: the `support@`-on-our-own-domain convention, left empty
until there is a domain to put it on. With two chains this now also means there
is no security contact to publish in `SECURITY.md`, which that file says out loud
rather than inventing one.

---

## Still open

Nothing from the twelve above. New questions go here as they arise, in the same
shape: what is undecided, what is built so either answer still fits, and what
changes on each answer.

One item is **decided in principle and unanswered in detail**, and it blocks a
batch rather than a release: **how the platform's mint fee works on EVM** (Q11).
Invariant I2 rules out our own fee-custodying contract, and a third-party factory
will not collect for us. Until that has an answer, the EVM launchpad has no
business model, and the gate in Q11 should not be considered passable.
