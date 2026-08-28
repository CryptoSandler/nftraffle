# Open questions — the owner's decisions

Decisions this repository is deliberately not making. Each one is a **one-way
door**: the moment it appears in copy or in a constraint, the product has made a
promise it cannot quietly walk back (CLAUDE.md, "Decisions with a door").

For each: what is undecided, what has been built so that either answer still
fits, and what changes when it is answered.

---

## Q1 — Is any jurisdiction refused?

**Undecided.** Geo-blocking, a terms-of-service page, an age affirmation, a
jurisdiction notice. This product sells chance for money, which in many places is
a lottery with rules attached, and that is legal posture rather than engineering.

**What is built so both answers fit.** Nothing in the application says anything
about legality — DESIGN.md §8.1 makes that a rule rather than an omission. There
is no terms page to contradict, no "available worldwide", no jokes about it. The
request path already resolves a trustworthy client address for rate limiting
(`clientIp`), so a geo decision has an identity to hang off without a new
mechanism.

**What changes on each answer.** *Refuse somewhere:* a block list and a refusal
screen, plus the question of what happens to tickets already sold to a wallet
from there. *Refuse nowhere:* nothing to build, but the silence becomes a
deliberate silence rather than an unexamined one, and that should be recorded
here as decided.

**Why not decided by default.** A default here is a published legal position
written by whoever happened to phrase a sentence.

---

## Q2 — May a seller set an enforced minimum?

**Undecided.** Today there is no minimum: the draw runs on whatever sold, exactly
as briefed. The seller's create screen shows what they receive at one ticket and
at a sell-out, net of `HOUSE_FEE_BPS` (spec §0.6), so the floor is visible at the
moment the decision is made.

**What is built so both answers fit.** The floor is shown but not enforced.
`raffles.status` already carries `cancelled` with a reason, and refunds are
manual, so the mechanical path for "this raffle did not clear its bar" exists —
it is just driven by an operator rather than by a rule.

**What changes if the answer is yes.** An enforced minimum means an *automatic*
refund path, and automatic refunds mean the server moves money — which it cannot
do, because it holds no private key (CLAUDE.md). So "yes" is not a field on a
form; it is either a large manual queue at a scale humans cannot serve, or the
first feature that needs a signing server. That is a threat-model change and a
conversation, not an implementation detail.

**Recommendation applied in the meantime:** show the floor, do not enforce it.

---

## Q3 — Can a seller cancel their own raffle?

**Undecided.** Today only an operator can cancel, from `/admin`, with a reason
the public page shows.

**What is built so both answers fit.** `cancelWithReason` is a transition in
`lifecycle.ts` alongside the others, with the same guards, rather than a bare
UPDATE in an admin route. Giving a seller access to it later is an authorisation
change, not a new mechanism.

**What changes if the answer is yes.** Every ticket already sold has to be
refunded, manually, by a human — so seller-initiated cancellation is a promise
about *our* labour, made by someone who is not us. If it is ever offered it needs
a window ("only before the first ticket sells"), which is cheap, or it needs Q2's
signing server, which is not.

**Recommendation applied in the meantime:** operator only, and no copy anywhere
implies a seller can withdraw.

---

## Q4 — What happens to an unrevealed seed?

**Partly decided, and the remainder is the owner's.**

**Decided and built:** the public verification page names "committed but never
revealed" as an explicit, loud state (spec §0.4). It is not an empty section and
not a spinner.

**Undecided:** whether there is a *stated commitment* about it — "if a seed is
not revealed within N hours, every ticket is refunded". That sentence is a
promise about our labour and our money, and it is exactly the kind of sentence
this repository is not allowed to write on the owner's behalf.

**Why it matters more than it looks.** The commit–reveal scheme makes bias
impossible and refusal obvious. What converts "obvious" into "safe" for a buyer
is knowing what happens next, and right now the honest answer is "an operator
sorts it out". Saying that plainly is available; promising a timetable is not.

---

## Q5 — Does a collection page show raffles for assets we did not launch?

**Decided provisionally, flagged because it shapes leg 3.**

Today: `raffles.collection_id` is set when a raffle's prize belongs to a
collection launched here, and NULL otherwise. A collection page shows only
raffles whose prize is from that collection. A secondary raffle of an outside
asset appears on the home page and its own page, but has no collection page to
live on.

**The open part.** Whether outside collections get pages too — populated purely
from DAS, with no launch of ours behind them. That would make leg 3 a directory
of all of Solana rather than of what launched here, which is a different product
and arguably a better one. It is not built, because it changes what "the market
lives here" means.

---

## Q6 — Who is `SUPPORT_CONTACT`?

**Undecided, and it blocks a real path.** When money arrives and cannot be
applied — a payment outside its window, a deposit matching no draft — the person
who paid is told to contact somebody. With `SUPPORT_CONTACT` unset the copy
degrades to "this has been recorded", which is true but leaves them with nowhere
to go.

For a no-doxx project this is a real tension: a contact channel is an identity
surface. The available answers are a throwaway address, a Telegram handle, or a
deliberate none. All three are the owner's.
