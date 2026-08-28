# nftraffle — Design

**Status:** §1 and §8 are normative now. §2–§7 are a direction to explore, not a
built system — the interface today is deliberately neutral and functional.
**Date:** 2026-08-28

This document has two halves and they have different weights.

**§1 (the thesis) and §8 (copy) are rules.** They are cited in verdicts, they
decide what gets built, and disagreeing with them is a conversation rather than a
preference. They are true today.

**§2 through §7 are a direction.** No screen in this repository implements them
yet, and none should pretend to. When the aesthetic pass happens, it starts here
and every number in it gets measured before it is believed. Until then, the UI is
plain, legible, and makes no claims. See §10 for why that is a decision and not a
gap.

---

## 1. The thesis

**We are not competing with Magic Eden or Tensor on orderbook depth or curation.
We are pump.fun for NFTs, and the raffle is the selling mechanism.**

The loop, and every feature is judged against it:

    instant launch, no vetting  →  raffle the supply to bootstrap it  →  the
    secondary market for that collection is raffles here

Three arrows. A proposal is answered by naming which one it makes shorter or more
likely to complete.

**Arrow one — instant launch, no vetting.** A creator with art and a wallet has a
mint page in minutes. No application, no review, no waiting list, no allowlist to
assemble. Every field on the launch form is friction on this arrow and has to
earn its place. This is why §0.9 of the spec cuts guard groups: they are the
feature a creator wants *after* they have an audience, and a creator with an
audience is not who this is for yet.

**Arrow two — raffle the supply to bootstrap it.** A new collection's problem is
not price discovery, it is that nobody has heard of it. A raffle is a better
bootstrap than a mint because it converts a small number of interested people
into an event with a clock and an outcome, and because the seller gets paid by
people who did not win.

**Arrow three — the secondary market lives here.** Not an orderbook. Someone who
holds an asset lists it as a raffle; the collection page shows every raffle and
every past draw. Depth is not the product. The mechanism is.

### What this thesis forbids

Named explicitly, because each of these is obviously good and each of them is a
different product:

- Sorting and filtering by price, rarity, or volume.
- Floor prices, charts, and "trending".
- Curation, verification badges, featured slots.
- Watchlists, portfolios, notifications.
- Bidding, offers, escrowed listings at a fixed price.

Every one of them serves discovery among high volume. We do not have high volume,
and building the surface that manages it is playing Magic Eden's game with a
hundredth of their liquidity.

### What the thesis demands, and is easy to underinvest in

The raffle is only worth building if people believe the draw. So the public
verification page is **leg-one infrastructure, not a trust badge added later**:
it ships in v1, it explains the arithmetic in words a person can follow, and it
names the one thing the mechanism cannot defend against (§4 of the spec) rather
than implying it defends against everything.

---

## 2. Colour — direction

Not built. When it is:

The product's emotional register is a **clock running down in public**. That is
neither the casino register (gold, red, urgency, animation) nor the marketplace
register (white, grey, restraint). Casino copy on a product that sells chance is
the fastest way to look like the thing people are right to be suspicious of;
marketplace neutrality on a raffle product looks like a spreadsheet.

The direction to try: a near-neutral ground with **one** saturated accent that
means *the clock*, and nothing else. Time remaining, tickets remaining, the draw
moment. Never a button, never a link, never decoration — an accent that appears
on ordinary controls stops meaning anything, and this one has exactly one job.

Palette values are deliberately absent from this document until they are
measured. A hex written down before it is tested against its own background is a
number that will be quoted in good faith and be wrong.

## 3. Typography — direction

**Google Fonts only**, loaded through `next/font/google`, with no system stack
anywhere. A face that resolves differently per machine is a design that does not
exist.

Two families: one for words, one for numbers. This product is dense with figures
that must be compared down a column — ticket prices, lamport amounts, basis
points, ticket counts, slot numbers — and proportional digits make that a chore.
The numeric face is tabular and it is used for **every figure without exception**,
including inside sentences.

## 4. Form, 5. Layout, 6. Motion — direction

Deferred until §2 and §3 are settled and measured. Writing them now would be
writing three documents that have to agree with a palette that does not exist.

One rule that survives regardless, because it is about honesty rather than taste:
**the countdown and the ticket counter are never animated in a way that implies
motion they do not have.** A number that eases toward its new value reads as live
when it is polled. Show the real cadence.

## 7. Invariants — direction

The sibling project measures every chrome colour against every surface it is
drawn on and asserts the ratios in a test suite, so a contrast regression fails
CI rather than shipping. That machinery is the part of its design system worth
copying and it is copied **when there is a palette to measure**, not before.

The floor when that happens: 7:1 for body text, 8:1 for any figure a person is
about to make a money decision on. No text and no control carrying text is
quieted with `opacity` or a `filter` — compositing turns a measured contrast into
an unmeasured one.

---

## 8. Copy — NORMATIVE

### 8.1 The product sells chance for money and the copy says so plainly

Four prohibitions. These are not tone preferences.

1. **Never promise legality.** No copy anywhere states, implies, or jokes that
   raffles here are legal in the reader's jurisdiction. Whether to add a terms
   page, an age affirmation or geo-blocking is the owner's open decision and is
   recorded in `docs/open-questions.md`. Until they decide, the honest position
   is silence, not reassurance.
2. **Never describe odds as anything but the mechanical ratio.** "You hold 4 of
   112 tickets sold." Not "great odds", not "your chances are looking good", not
   a percentage rounded in the buyer's favour.
3. **Never use "guaranteed".** Not about winning, not about payout, not about
   timing. Payouts in v1 are performed by a human and the page says so.
4. **Never call the platform fee a network fee.** Solana's own fee is a fraction
   of a cent. `MINT_FEE_BPS` and `HOUSE_FEE_BPS` are ours, and saying otherwise
   is a lie about who is being paid.

### 8.2 A fee is never quoted from a default

No number in any sentence in this application is a fee value that was hardcoded.
Every fee is read from configuration at render time and every screen that quotes
one reads the same function the money path reads. A deployment that has not set a
fee does not show a placeholder — it shows the surface as unavailable (§6 of the
spec).

The failure this prevents is specific: copy saying "2%" while the guard charges
something else. Two sources for one number is one source too many, and the one
people read is the one that is not enforced.

### 8.3 A wallet error is never shown as an explanation

`Transaction simulation failed: Error processing Instruction 1: custom program
error: 0x1` is what an underfunded payer gets from a preflight. The detail goes
to the console; the screen gets a sentence naming what to do.

### 8.4 The verification page explains, it does not assert

The page that shows how a winner was computed is written for somebody who does
not trust us. It shows the inputs, the arithmetic, and what they can check
independently — and it names what the mechanism cannot prove (spec §4). A page
that only says "provably fair" has proved nothing and used up the reader's
patience.

---

## 9. Accessibility

Not deferred, at any level. The floor: every control reachable and operable from
a keyboard with a visible focus ring; every figure that carries meaning also
carries it in text; no colour-only status; every timed surface readable by
someone who cannot see it change.

The one this product gets wrong most easily: **a countdown is not a status.** A
raffle that has closed says "closed" in words, in the document, not merely by a
timer reaching zero on a page that happens to be open.

---

## 10. Why the interface is plain right now

This is a decision, recorded so nobody reads it as unfinished work and
"improves" it.

The mechanism is not settled enough to dress. The draw's public page, the escrow
deposit flow and the payout queue are the surfaces that decide whether anyone
trusts the product, and all three are still moving. A visual system built over
moving surfaces gets rebuilt, and the rebuild is where measured contrast ratios
and a considered palette quietly become approximations.

So: neutral, legible, unstyled beyond what legibility needs, and honest about
being early. When §2 and §3 are settled and measured, the pass happens once, over
a mechanism that has stopped changing.

## 11. The name is a placeholder

`nftraffle` is a working name. The domain is not bought.

It lives in exactly three places: `package.json`, user-facing copy, and
`SITE_URL`. It is deliberately **not** in any database value, any migration, any
column name, any cookie name that would need a migration to change, or any
generated image. A rename is a find-and-replace over copy plus one environment
variable, and it stays that way.
