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

**Built on 2026-08-31** (branch `chain-adapter-seam`): `ChainAdapter` in
`src/lib/chain/adapter.ts`, the Solana adapter wrapping what already existed,
the Robinhood adapter new, and migration 004 renaming every `*_lamports` column
and adding `chain`. The one switch that opens the second chain is `OPEN_CHAINS`
in `src/lib/surfaces.ts`, and a test asserts Robinhood stays shut even with
every one of its variables set.

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

## Q13 — The ticket-price ceiling stays shared until Robinhood opens

**Decided: one shared ceiling now; split it per chain the day the Robinhood
surface opens, and not before.**

`SELLER_LIMITS.maxTicketPriceNative` is a single value expressed in the chain's
smallest unit. It is meaningful on Solana — ten SOL — and close to meaningless
on an EVM chain, where the same integer is ten ETH.

**Why it is safe to leave.** Nothing can reach it: `OPEN_CHAINS` in
`src/lib/surfaces.ts` closes every Robinhood surface, so no raffle can be listed
on that chain at any price. The wrong ceiling is unreachable rather than merely
unlikely.

**What it costs.** A second thing to remember at the moment the chain opens,
which is exactly when attention is elsewhere. That is why it is written in three
places rather than one: the `// ponytail` comment at the constant, the
"Opening the second chain" checklist in `docs/operations.md`, and here.

**Trigger:** opening the Robinhood surface. It is item 1 on that checklist and
the surface should not open with it outstanding.

**Done, 2026-08-31**, in the batch that opened the chain. `MAX_TICKET_PRICE_NATIVE`
in `raffles/schedule.ts` is now a record keyed by chain: **10 SOL** and
**0.5 ETH**. The Robinhood figure is deliberately lower in fiat terms — ETH's
unit is worth far more, so a slipped decimal costs far more, and this is the
chain about to meet an audience that has never used this product.

`checkSellerChoices` now REQUIRES a chain argument rather than defaulting to
one. That is what turned the split from a value somebody must remember into a
compile error at every call site, which is the only version of "remember this"
that works.

## Q6 (restated) — `SUPPORT_CONTACT` stays empty until the domain

Reaffirmed unchanged: the `support@`-on-our-own-domain convention, left empty
until there is a domain to put it on. With two chains this now also means there
is no security contact to publish in `SECURITY.md`, which that file says out loud
rather than inventing one.

---

# The draw's entropy anchor — decided 2026-09-01

## Q14 — Commit to a wall-clock instant, not a block height

**Decided: a raffle publishes a TIME `draw_at`, and the draw uses the first block
at or after it.** The announced-height design is removed, not patched.

### The defect it replaces

`docs/findings-2026-08-31-draw-margin.md`. The old design announced
`currentSlot + (duration + 1h)/400ms` and argued the chain could only lag.
Measured: mainnet runs at 317 ms/slot, devnet at 166. The chain runs FASTER than
assumed, so the announced slot arrived early — and past roughly four hours of
duration on mainnet, its hash existed while tickets were still on sale. The seed
holder could then compute the winning ticket before the sale ended.

**A smaller constant does not fix this.** Any slot-rate figure is a claim about
the world that decays: it differs per cluster, drifts with load, and would have
to be re-measured forever. The bug was not the number 400; it was expressing a
*time* requirement in *height* units.

### The mechanism

At creation the raffle publishes `draw_at = ends_at + 10 minutes`, alongside
`sha256(seed)`. At the draw, the server finds **the first block whose timestamp
is at or after `draw_at`** and uses that block's hash:

    material      = sha256(seedHash + seed + blockHash + raffleId)
    winningTicket = (material as a big-endian integer mod ticketCount) + 1

`draw_at` is a wall-clock instant, so no slot-rate assumption enters anywhere.

**Why the entropy cannot be known early, by construction.** Tickets settle only
while the raffle is `open`, which ends at `ends_at`. `draw_at` is strictly after
`ends_at`, and a block at or after `draw_at` cannot exist before `draw_at`
arrives. There is no arithmetic that can make the anchor land early, because
there is no arithmetic — the chain's own clock decides.

**Why 10 minutes and not zero.** A payment made just before `ends_at` may be
confirmed a little after it, and our clock and the chain's are not the same
clock. Ten minutes covers both with room, and — unlike the old hour — it is not
load-bearing for safety, only for tidiness. Being wrong about it by a few minutes
costs nothing.

**What a third party checks, without trusting us.** `draw_at` is on the page.
They ask any node for the first block at or after it, and compare the hash and
the arithmetic. The old design asked them to trust that a slot number announced
months earlier was the right one; this asks them to look up a timestamp.

### Why the same seam serves both chains

The search is `first block whose timestamp >= T`, which is a binary search over
height. **The search itself is chain-agnostic and lives in one module**; each
adapter supplies only `currentHeight()` and `blockAt(height)`. Solana's skipped
slots become a `null` from `blockAt`, which the search steps over; EVM has no
holes and the same code runs unchanged.

That is the whole reason to prefer this over anything cleverer: Robinhood Chain
had the identical defect, measured, and this removes it from both without a
per-chain constant.

### Alternatives considered and rejected

**A conservative slot-rate constant** (assume the fastest plausible slot). Safe,
and it makes the wait proportional to how wrong the estimate is — on mainnet at
317 ms a one-hour margin becomes 2.6 hours, and a 30-day raffle's slot lands
months out. Still a claim about the world.

**Anchor on the block that closes the raffle.** Deterministic and immune to
drift, but the hash exists at exactly the moment the sale ends, with no cushion
for a late settlement. Strictly worse than the same idea plus a margin.

**A VRF or drand beacon.** The strongest randomness available and rejected on
the project's own terms: it is either an on-chain program of ours
(SECURITY.md I2) or an external oracle the brief rules out, and it adds a
liveness dependency that can stall a draw for reasons nobody here controls.

**Derive entropy from the ticket set itself** — e.g. the last ticket's
signature. Circular: whoever buys last chooses the entropy, which is worse than
the operator knowing it.

**Keep heights but re-measure per chain on a schedule.** Rejected as the shape of
the original bug: a measurement taken once is a slot-rate assumption like any
other, and this one had already been written down as measured for Robinhood while
being wrong for Solana.

### The rule is enforced three times, on purpose

The anchor search cannot return a block before `draw_at`, and `draw_at` is after
`ends_at`, so the attack is unreachable by construction. It is checked anyway, in
three places, and the reason is in the finding this replaces: **the old design
was also safe by construction, and the construction rested on a constant that
turned out to be wrong.**

1. `checkDrawAnchor` (`raffles/draw.ts`) — the draw route refuses a block that is
   not strictly after the close, on the block's OWN timestamp rather than on the
   arithmetic that selected it.
2. `raffles_anchor_block_after_close` (migration 006) — the database will not
   store such a draw, whatever wrote it: this route, a script, or a hand-written
   `UPDATE`.
3. `/r/[slug]/verify` re-runs the same rule from the published values, and tells
   the reader how to confirm the block's timestamp against the chain directly.

Migration 006 also adds `draw_block_time`, without which the verify page would
have to ask the reader to take "the block came after the close" on trust — which
is the one thing that page exists not to do.

### What this does NOT remove, stated rather than glossed

**The anchor is a chain-reported timestamp, not the real wall clock.** On Solana
`blockTime` is a stake-weighted median of validator clocks; on an Arbitrum Orbit
chain the sequencer sets it within consensus bounds. So the instant this design
commits to is the chain's opinion of the time, not time itself.

This is a real limitation and it is smaller than the one it replaces, which is
the honest way to put it. To move the anchor early enough to matter, a party
would have to push a block's timestamp back by minutes AND be the party ordering
blocks AND hold the seed — and on Solana that means a majority of stake
misreporting its clocks. The old defect needed none of that: it happened on its
own, to every long raffle, because a division used the wrong number.

It also bites the two chains unequally, which is why `/r/[slug]/verify` already
carries a narrower text for Robinhood (Q7). A single sequencer that both orders
blocks and stamps them is a stronger position than Solana's validator set, and
the page says so rather than reusing the Solana wording.

### What it costs

- Two migrations (005, 006) and a change to the adapter interface.
- The draw resolves a block by binary search — a handful of RPC reads instead of
  one, once per raffle, on a path an operator already waits on.
- `hashAtHeight` is replaced by `blockAt`, which is a smaller and more honest
  primitive: it answers what the chain says, and says when.
- Ten minutes of waiting after every close, paid by the honest case every time.
  That is the price of the margin and it is the right place to pay it.

**One defect found while building it, worth recording because the shape repeats.**
The first search ran from height 0. Every synthetic test passed, because a
synthetic chain answers for every height. A real node does not — it prunes old
blocks, which read as `null`, and `null` means "skipped slot, look upward". In
pruned history that reading is backwards: those heights are OLD. The search
walked down into the pruned region and reported no block on a chain that had
passed the anchor twenty minutes earlier. It now brackets back from the head, so
it never asks about a height a node would not serve. Found by running
`docs/devnet-rehearsal.md` against public devnet — the same way the defect this
whole decision replaces was found, and the second time in this project that
assuming a chain's behaviour cost more than measuring it.

### Trigger to revisit

A chain whose block timestamps are not monotonic, or not meaningful. Both
supported chains enforce monotonic timestamps at consensus; a future chain that
does not would need a different anchor and should not reuse this one silently.

## Q15 — `maxDurationDays` returns to 30 only when a test covers it

**Decided: the two-hour interim cap lifts when — and only when — the new
mechanism has a test proving a long raffle's entropy is still unavailable at
close.**

The interim rule was a bridge for a design that could not be safe at long
durations. Under Q14 duration is irrelevant to safety, because the anchor is
`ends_at + 10 minutes` whatever `ends_at` is. The test that earns the ceiling
back asserts exactly that: for a 30-day raffle, the resolved anchor is still
after the close.

**Earned, 2026-08-31.** `raffles/__tests__/draw-anchor.test.ts` covers it, and
covers the stronger claim the ceiling actually depends on: the margin is
*identical* at 15 minutes, 2 hours, 1 day, 7 days and 30 days. A test that only
checked "30 days works" would pass under a design whose margin merely shrank
slowly. Asserting the margin is a constant is what says the defect is gone rather
than smaller. The interim two-hour rule is removed from `docs/operations.md`.

## Q16 — Preview stays SSO-gated; rehearsals run locally

**Decided 2026-08-31: leave Vercel's deployment protection ON, and keep running
the devnet rehearsal against a local server rather than the preview hostname.**

The preview deployment is the only one that can create a raffle — production
deliberately has no `SOLANA_RPC_URL`, no wallets and no fees, so its listing
surface is closed and says so. Preview is behind `ssoProtection:
all_except_custom_domains`, and Protection Bypass for Automation is a Pro
feature that the `sandler` team's Hobby plan does not have, so no script can
reach it over HTTP.

**The two rejected options, and what each would have cost.** Turning SSO off
would make the preview URL public to anyone with the link — the devnet surfaces
and the admin sign-in form included — for a pre-domain project that is
deliberately unindexed. Putting the devnet configuration into Production would
have made the surface reachable and is forbidden outright: devnet keypairs are
loaded in Preview and never in Production, because a devnet address is a
perfectly valid mainnet address and the mistake is unrecoverable.

**What is given up, stated plainly rather than glossed.** Nothing is verified
through the preview hostname itself — routing, the platform's own headers, and
anything that only differs on Vercel's edge. Everything else is covered: the
local server runs the same commit's production build against the same Neon
preview branch, the same devnet RPC and the same devnet wallets, which is what
`docs/deploy.md` already describes as the sanctioned path.

### Trigger to revisit

A Pro plan, or a custom domain. Either one makes the preview reachable to a
script without exposing it to the public, and at that point the rehearsal should
run against the real URL and this decision should be reversed rather than
inherited.

## Q17 — Robinhood Chain goes first; the gate is a green testnet runbook

**The owner reversed the approved sequence on 2026-08-31.** It was Solana first,
one real raffle end to end, and only then Robinhood. It is now Robinhood first,
and the door that opens its surface is no longer a real Solana raffle — it is
`docs/testnet-rehearsal-robinhood.md` passing whole, with every negative
refusing.

**The reason, in the owner's words: that is where the volume is.** This is a
distribution judgement, not a technical one, and it is the owner's to make. The
loop in DESIGN.md §1 is only a loop if somebody is there to complete it — a
raffle that nobody sees does not bootstrap a collection, however correct its
draw. A chain with an audience beats a chain we have already built for.

### What this changes about the risk, stated honestly

The old sequence bought one specific thing: **a bug in the shared core would be
found once, on the chain with the mature tooling, rather than misattributed to
an adapter.** Solana has an explorer everybody reads, a CLI that can move an
asset in one line, and a devnet with faucets. Robinhood Chain has Blockscout and
`cast`. When a payment does not verify there, the question "is this our bug or
the chain's" is genuinely harder to answer, and we now ask it first.

**Three things get riskier, and each has a specific mitigation already built:**

1. **The shared core is exercised first by the less familiar adapter.** Mitigated
   by the core being genuinely shared and already tested against Solana end to
   end — `checkWindowAndPayer`, the escrow discipline, the payout evidence rules
   and the draw anchor are all chain-agnostic and all passed a full devnet
   rehearsal on 2026-08-31. What is new is the adapter, not the judgement.
2. **The anchor's honesty is weaker on an Orbit chain and this now matters
   first.** A single sequencer both orders blocks and stamps them, so "the hash
   is unknowable" is true of us and not provably true of the sequencer. This was
   always the case (Q7); the change is that it is now the FIRST thing a user
   meets rather than the second. The verification page therefore has to carry
   the narrower text before launch, not after — see item 2 of this batch.
3. **Fewer eyes on a first mistake is now a bigger loss, because a first
   impression on the chain with the volume is the one that counts.** Mitigated
   by the gate: the testnet runbook is the same fourteen checks as devnet, ten of
   them negatives, and a negative that does not refuse is a stop.

**What does NOT change.** Production keeps its money surfaces closed until the
owner loads the environment themselves. Nothing here opens a mainnet surface;
the gate opens a TESTNET rehearsal, and mainnet is a separate decision the owner
still holds.

### Trigger to revisit

A green testnet runbook that is followed by a Robinhood mainnet raffle which
does not sell. At that point the distribution premise was wrong, and the honest
response is to say so and go back to Solana rather than to keep building here.

## Q18 — The payer binding exists on EVM and not on Solana

**Decided: build it where the chain is opening, and say out loud that the other
chain does not have it.** This is a gap, not a principle, and writing it down is
what stops it being discovered later as a surprise.

**What the binding does.** Opening an order on Robinhood requires a
`personal_sign` proving the signer controls the address the order names
(`lib/wallet/evm-binding.ts`). Settlement already refused a transfer whose
`from` was not the order's payer; this closes the mirror image — opening an
order in a STRANGER'S name and waiting for a transfer they made for their own
reasons to land inside its window.

**Why Solana has no equivalent yet.** The same hole exists there, bounded by the
same 30-minute order window and the same 120-second skew. It is narrower in
practice for an unglamorous reason: Solana's blocks are ~317 ms apart against
Robinhood's ~101, and a Solana payer's transfer must also match the exact
amount, the exact recipient and the window. None of that makes it safe — it
makes it smaller.

**Why not build both now.** Solana's version is not the same code: Wallet
Standard exposes `solana:signMessage`, not `personal_sign`, and the message
format, the wallet feature detection and the verification are all different. It
is a unit of work, not a parameter, and this batch is opening the other chain.

**What it costs to leave it.** One extra prompt on Robinhood that Solana does
not show, which is a visible inconsistency between two panels. Accepted, because
the alternative is either building a second signing path in a batch that is
already opening a chain, or removing a real protection from the chain that is
about to take money first.

### Trigger to revisit

The first Solana raffle that sells to strangers rather than to us. Before that
the hole has no population to exploit it; after it, this should be levelled up
rather than levelled down.

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
