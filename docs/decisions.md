# Decisions

The six questions this repository deliberately refused to answer on the owner's
behalf, and the owner's answers. **Decided 2026-08-31.**

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

## Still open

Nothing from the original six. New questions go here as they arise, in the same
shape: what is undecided, what is built so either answer still fits, and what
changes on each answer.
