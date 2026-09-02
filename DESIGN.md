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

## 2. Colour — NORMATIVE

Built 2026-09-01, after the mechanism stopped moving (see §10, which set exactly
that condition). The three questions §2 previously left open were put to the
owner and answered — `docs/decisions.md` Q19 — and this section is those answers
made into numbers.

**The values below are duplicated in `src/lib/design-tokens.ts` and in
`src/app/globals.css`, and `src/lib/__tests__/design-tokens.test.ts` reads THIS
DOCUMENT and asserts all three agree.** A palette that lives only in CSS is one
nobody can argue with; one that lives only in prose is one nobody applies. A hex
changed in one place fails the suite.

### The register: a toy, and still zero casino

This product sells chance for money, and the fastest way to look like the thing
people are right to be suspicious of is to dress like it. So: **zero casino.**
No gold, no red urgency, no green success, no animation on a number, nothing
that borrows from gambling marketing.

What it dresses as instead is a **toy**: one loud colour, round corners, and
three doors you press. Chosen 2026-09-02 (`docs/decisions.md` Q22) over an
editorial register and an instrument register, and chosen for arrow one of §1.
A gallery tells a creator their work is about to be judged; a terminal tells them
it is not for them. This one says *press this*, and it is the only one of the
three that somebody with art and no wallet reads as an invitation.

**Loud and casino are not the same axis, and this is the direction where that
distinction costs something.** Magic Eden sells packs and "Lucky Buy" in magenta
behind a 3D mascot, and loud is one bad decision away from that. The distance is
held by the rules in this section and by §6 — not by taste, and not by anybody
remembering.

### The tokens

| Token | Light | Dark | What it is for |
|---|---|---|---|
| `ground` | `#FEFCF8` | `#0B0714` | the page |
| `panel` | `#F2EDFF` | `#161028` | a raised block: cards, the three doors |
| `ink` | `#120C22` | `#F2ECFF` | body text and headings |
| `quiet` | `#494060` | `#ABA1C6` | labels and secondary text |
| `rule` | `#DBD3EF` | `#2B2145` | hairlines between rows |
| `edge` | `#786D95` | `#6E6490` | the border of a control a person can act on |
| `accent` | `#431BBB` | `#B79DFF` | the brand and the action: it is what you press, and the clock |

**The accent has two jobs: the action and the clock.** `.pop-action` and
`.clock`. Not a heading, not body text, not a border, not a state, not an error.

This **reverses Q19's first answer**, which gave the accent one job and accepted
a black-on-white primary action as the price. The owner reopened it and answered
it again on 2026-09-02 — `docs/decisions.md` Q22 — rather than letting a
direction quietly override a recorded decision. What replaces it is still a rule
and still enforced: `design-tokens.test.ts` greps every source file and fails on
any other use of `--accent`.

**What did NOT reopen is Q19's second answer.** Zero casino stands unchanged.
Widening the accent is a decision about a brand colour; it is not permission for
a register, and §6 is where that line is actually held.

**The hue is a decision, not a preference.** Red and gold are the casino
register outright. Green reads as "go", and as money. Blue reads as a hyperlink,
and neither a countdown nor a button is one. **Magenta and pink are Magic Eden's**,
and being mistaken for them is this direction's whole risk. Violet is the nearest
loud hue that is none of those, and at these two darknesses it still clears 8:1 on
both surfaces in both modes — which a lighter, louder violet does not.

**Dark mode is a real mode, not an inversion.** `prefers-color-scheme` picks it;
both columns were measured separately, because a palette inverted arithmetically
lands wherever the arithmetic lands.

### Measured contrast

Every figure below is computed by `contrastRatio()` from the hexes above, and
the guardian test recomputes them from this table rather than trusting it.

| Mode | Token | on `ground` | on `panel` | Floor | WCAG |
|---|---|---|---|---|---|
| light | `ink` | 18.61 | 16.65 | 7:1 | AA AAA |
| light | `quiet` | 9.38 | 8.39 | 7:1 | AA AAA |
| light | `accent` | 9.70 | 8.68 | 8:1 | AA AAA |
| light | `edge` | 4.64 | 4.15 | 3:1 | AA |
| dark | `ink` | 17.27 | 16.00 | 7:1 | AA AAA |
| dark | `quiet` | 8.20 | 7.59 | 7:1 | AA AAA |
| dark | `accent` | 8.80 | 8.15 | 8:1 | AA AAA |
| dark | `edge` | 3.69 | 3.41 | 3:1 | AA |

**The floors are stricter than WCAG AA on purpose.** AA is 4.5:1 and is a floor
for *reading*; this product asks people to make money decisions from figures on
a screen. §7 sets 7:1 for body and 8:1 for a figure somebody is about to act on,
and the accent — which is always such a figure — clears 8:1 in both modes.

**`rule` is the one exemption and it is deliberate.** A hairline between two
rows is decoration: a reader who cannot see it loses nothing, because the row
below still starts with a name. `edge` is NOT exempt, because it is the boundary
of something a person clicks, which WCAG 1.4.11 puts at 3:1.

**No text is ever quieted with `opacity` or a `filter`.** Compositing turns a
measured contrast into an unmeasured one, and every number in this section would
stop meaning anything.

### The wordmark

**Set in type, never drawn** (§11). The name is `popmint`, decided 2026-09-02,
and the home page sets it in the display face rather than in an image — so a
rename edits a string and nothing has to be redrawn. No logo file exists, and
none should be made until the domain is bought.

## 3. Typography — NORMATIVE

**Google Fonts only**, loaded through `next/font/google`, with no system stack
anywhere. A face that resolves differently per machine is a design that does not
exist.

**Three families, and each has a job it does not share:**

| family | variable | job |
|---|---|---|
| `Inter` | `--font-sans` | sentences |
| `IBM Plex Mono` | `--font-mono` | every figure, without exception, including inside sentences |
| `Archivo Black` | `--font-display` | the wordmark, every heading, and the action — never a sentence, never a figure |

The mono is not decoration. This product is dense with figures that get compared
down a column — ticket prices, lamport amounts, basis points, ticket counts, slot
numbers — and proportional digits make that a chore.

**Archivo Black arrived with the direction, and it reaches type through exactly
two doors.** `.display`, which every heading and the wordmark carry, and
`.pop-action`, which is the button. One weight, and no third door: a display face
that starts appearing on labels, meta lines or a table header is a page shouting
at its own reader, and `design-form.test.ts` fails on a third rule using
`var(--font-display)`.

**It never carries a sentence and never carries a figure.** A sentence set in a
display face is slower to read, and a figure set in one is not tabular — §3's
whole reason for a mono is that figures get compared down a column.

§10 records why an expressive face was refused until the mechanism stopped moving;
it stopped on 2026-08-31, and this is the face chosen afterwards.

## 4. Form — NORMATIVE

Built 2026-09-01 over the merged palette. Three shapes and no others, so the
vocabulary is learned once.

| Class | What it is | Border | Background | Text |
|---|---|---|---|---|
| `.control` | anything you can act on | `edge` | `ground` | `ink` |
| `.control-primary` | the one action a screen is chiefly about | `ink` | `ink` | `ground` |
| `.control-link` | an action that must not compete: sign out, cancel | none | none | `ink`, underlined |

**It was written as two and the source had three.** `.control-link` is a real
pattern — a bordered button for "Sign out" gives it more weight than it deserves
— and a document that undercounts what the code needs is one people route around
rather than follow. It is still a `<button>`, so it still gets the focus ring
below; that is precisely why it is not an `<a>`, because a link that performs an
action is a lie to a screen reader.

Radius `4px`, padding `0.375rem 0.75rem`, on both. A control that needs a
different size gets a width utility, never a different padding — a screen with
three button heights on it reads as three different products.

**Every control borders with `edge`, never `rule`.** This was wrong on every
input and secondary button before this pass: they carried the hairline meant for
the gaps between rows, at 1.50:1, under the 3:1 WCAG 1.4.11 asks of a control's
boundary. `edge` exists for exactly this and was measured for it (§2).

**Disabled is token-based, never `opacity`.** A composited control has no
measured contrast, and §2's table stops describing it.

### Focus

**There was no focus styling at all before this pass** — the surfaces looked
considered and a person using a keyboard could not tell where they were. That is
not a polish item: accessibility basics are one of the four things this project
never simplifies away.

`:focus-visible`, never `:focus`, so a mouse click draws no ring — making it do
so is why people disable focus styles altogether. The ring is **2px of `ink`
with a 2px offset**, and the offset is load-bearing: without it the ring lands on
the control's own border and the two read as one thicker line.

**The ring is `ink` and not the accent**, and this is the most tempting exception
to §2's one-job rule there is. `ink` on `ground` is the highest-contrast pair in
the palette (17.90:1 light, 16.45:1 dark), which is what a focus ring should be
anyway.

## 5. Layout — NORMATIVE

**Two page widths, chosen by how the page is read.** `max-w-3xl` for scanning a
list; `max-w-2xl` for reading one thing. Nothing else.

**Three repeating patterns, and everything is one of them:**

1. **The listing row** — a 64px square image, then a title, a meta line, and the
   clock. Fixed image size across every listing surface, so rows align down the
   page whether or not the images loaded. It is what every surface past the home
   page uses for a list.
2. **The fact list** — a two-column grid, label in `quiet` and value in `ink`,
   with every value in the tabular face. It is what the raffle page, the verify
   page and the payout queue all use, because they are all the same thing: a
   list of things somebody may need to check.
3. **The card** — a square image with the panel's corner radius, then a title and
   one figure. **The home page only**, and that is the constraint rather than an
   accident: the home page is the single surface aimed at somebody who has not yet
   decided to read anything, and a card trades density for an image big enough to
   be the reason they stay. A card anywhere past the home page is a listing row
   that got bigger for no stated reason.

**One vertical rhythm.** Sections are separated by `mt-10`, blocks inside a
section by `mt-3`, and rows by their own padding. Three numbers, so a page that
needs a fourth is a page doing something it should not.

**Nothing is centred except the page itself.** Centred text in a column of
figures makes a column that cannot be scanned, and every screen here is
ultimately a column of figures.

## 6. Motion — NORMATIVE

**Almost none, and the exceptions are named.**

The only transitions in this product are `120ms ease-out` on `background-color`,
`border-color` and `color`, and — **this direction's one addition** — `90ms
ease-out` on `transform`, limited to two classes: `.pop-action` and `.door`, and
limited to **two pixels**. Below about 100ms a transition is not perceived as
motion; above about 200ms it is perceived as waiting.

**Why a transform is allowed here and nowhere else.** This direction's argument
is that a page can be loud and still not be a table you play at. A control that
gives two pixels under the pointer is the cheapest way to feel like an object
rather than a document, and two pixels is not enough distance to celebrate
anything. The line it must not cross is fixed by `docs/decisions.md` Q19: no
confetti, no spin, no bounce, no scale on a win, nothing that moves after a
result. The motion is a PRESS, and a press happens before the outcome.

**Nothing animates a number.** Not the countdown, not the ticket counter, not a
balance. A figure that eases toward its new value reads as live when it is polled
once a second, and that is a lie about the cadence — the rule §2's register rests
on. The countdown re-renders once a second and changes instantly, because that is
what it actually does.

**No skeletons, no shimmer, no spinners on data that is already there.** A
placeholder that pulses implies something is arriving. The image placeholder says
`no image` and stops, because for that asset nothing is arriving.

**`prefers-reduced-motion: reduce` is honoured globally**, and it is not a
preference weighed against ours: somebody who asked for less motion has usually
asked because motion makes them ill.

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
   raffles here are legal in the reader's jurisdiction. The owner has decided
   against geo-blocking in code; the jurisdiction notice lives in terms they
   write (`docs/decisions.md` Q1). The silence in the product is therefore a
   decided silence, not an unexamined one — and it stays silence. Nothing in
   this application acquires a sentence about legality because a terms page
   exists elsewhere.
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

## 10. Why the interface was plain, and what changed

**Closed 2026-09-01, and dressed 2026-09-02.** The condition this section set has
been met, so §2 is built and normative — and §3–§6 followed it. What follows is
the original reasoning, kept because it is the argument for why the palette
arrived when it did rather than earlier.

The mechanism is not settled enough to dress. The draw's public page, the escrow
deposit flow and the payout queue are the surfaces that decide whether anyone
trusts the product, and all three are still moving. A visual system built over
moving surfaces gets rebuilt, and the rebuild is where measured contrast ratios
and a considered palette quietly become approximations.

So: neutral, legible, unstyled beyond what legibility needs, and honest about
being early. When §2 and §3 are settled and measured, the pass happens once, over
a mechanism that has stopped changing.

**What actually happened.** The draw's anchor was redesigned on 2026-08-31 and
the mechanism stopped moving; legibility came first (names, images, a clock) and
the palette followed once there was real content to measure a palette against.
Every ratio in §2 was computed rather than chosen, and a guardian test reads this
document to keep the three copies honest.

**And then it was dressed, once.** Three complete directions were built on
2026-09-02 — an editorial one, an instrument one, and a toy — as running pages
rather than mockups, because a mockup of this product hides the only thing worth
judging: what a page looks like with real raffles, real images and a real clock on
it. The owner chose the toy. `docs/decisions.md` Q22 records the choice;
`docs/design-vitrine.md` and `docs/design-mintdesk.md` keep the two that lost,
marked discarded with the date, because a rejected argument that gets thrown away
is one the next person rebuilds from scratch.

**The bet this direction makes.** Arrow one of §1 is aimed at a creator, not a
trader. A gallery register tells that person their work is about to be judged; an
instrument register tells them it is not for them. This one says *press this*, and
it is the only one of the three that somebody with art and no wallet reads as an
invitation. **What it gives up is stated and not hedged:** it is the easiest of the
three to mistake for the register this product has decided not to be, and §2 and §6
are where that distance is held — by rules with tests behind them, not by taste.

## 11. The name — decided, and the rename deliberately half-done

**The name is `popmint` and the domain is `popmint.fun`.** Decided by the owner
2026-09-02 (`docs/decisions.md` Q22). **The domain is not bought yet**, and until
it is the rename stops halfway. This section is the record of where it stopped, so
the half-state is read as a decision rather than as an oversight.

It lives in exactly three places, and they are in three different states:

| place | today | changes when |
|---|---|---|
| user-facing copy | `popmint` | done — the wordmark and the hero are set |
| `package.json` `name` | `nftraffle` | the domain is bought |
| `SITE_URL` | the `nftraffle` deployment | the domain is bought |

**Why copy moved first and the other two did not.** Copy is what the owner is
looking at while deciding, and it costs nothing to be wrong. `SITE_URL` is what a
deployment tells the world it is: pointed at a domain nobody owns, it produces
dead links in exactly the surfaces where a dead link reads as the product being
fake — a raffle's public page, a verification link, an operator's payout record.
`package.json` follows `SITE_URL` so the two never disagree about which deployment
this is.

It remains deliberately **not** in any database value, any migration, any column
name, any cookie name that would need a migration to change, or any generated
image. What is left of the rename is one string and one environment variable, and
it stays that way.
