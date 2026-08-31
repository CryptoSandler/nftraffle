# Visual state — a report, not a redesign

Asked for on 2026-08-31: does `DESIGN.md` exist as it does in the sibling
projects, what do the main surfaces actually look like, and which parts are at
the level versus placeholder. **No design work was done in this batch** — this
is the survey that a design batch would start from.

Screenshots in [`design-shots/`](design-shots/), captured from a local server
running the production build against the preview environment, 1280px wide.

---

## 1. Does DESIGN.md exist?

**Yes, and it is deliberately a third of the size of the sibling's.** `pixelwar`
has 630 lines; this has 217. The difference is not neglect and the document says
so in §10: colour (§2), typography (§3), form/layout/motion (§4–6) and the
contrast invariants (§7) are all written as **direction, explicitly not built**,
because "a visual system built over moving surfaces gets rebuilt, and the
rebuild is where measured contrast ratios and a considered palette quietly
become approximations."

What IS normative here is §8, **copy** — and that part is genuinely enforced.

So the honest summary is: this project has a design *brief* and a copy
*standard*, and no design *system*. That was the right call while the draw
mechanism was still moving. The mechanism stopped moving on 2026-08-31, when the
anchor redesign landed, so the condition §10 named has now been met.

---

## 2. What is at the level

**The copy.** This is the strongest thing about the product and it is not close.
Every §8 rule is visibly followed on screen: no odds language, no "guaranteed",
the platform fee is called a platform fee and never a network fee, and every
closed surface says *"Nothing has been charged"* rather than showing an error.
`/raffle/new` says "The listing flow is not built yet" instead of pretending.
That is a product that reads as honest, which for something selling chance for
money is the whole game.

**The verification page.** The densest and best surface in the product. It
publishes the commitment, the anchor instant, the close, the block used and that
block's timestamp; it recomputes all three checks rather than displaying stored
values; and it tells the reader how to confirm the block against the chain
themselves. It also states what it does NOT prove, with a narrower text on
Robinhood than on Solana. Nothing about it is decorated and it does not need to
be.

**The figure treatment.** `.figure` is a tabular mono face applied to every
number without exception, including inside sentences — §3's one rule that was
implemented ahead of the rest. Comparing prices down the raffle list works.

**Typography loading.** Inter and IBM Plex Mono through `next/font/google`, no
system stack anywhere, as §3 requires. This is done, not deferred.

**The payout row.** Both transaction signatures rendered in full on the public
page, for the person who did *not* send them. Correct and understated.

---

## 3. What is placeholder

**There is no palette.** The product is Tailwind's default neutral ramp:
`neutral-900` text, `neutral-500` labels, `neutral-300` borders, white ground.
`DESIGN.md` §2 asks for a near-neutral ground plus **one** saturated accent
meaning *the clock, and nothing else*. That accent does not exist. Nothing on
any screen is coloured.

**There is no clock, on a product whose stated register is "a clock running down
in public".** The raffle page renders `Closes 2026-08-31T21:55:05.841Z` — a raw
ISO 8601 string, milliseconds included. It is precise, machine-readable, and the
opposite of the emotional register the design brief names. This is the single
widest gap between what `DESIGN.md` says the product is and what it looks like.

**Raffles are titled by slug.** The home page lists `bx42aeje-mthrgkq9` and
`bgrtgjmq-mthrqbrh` as headings. Those are machine tokens on screen — the exact
thing this project's own rules object to elsewhere — and they are the first
thing a visitor reads. The data to do better now exists on both chains
(`assetMetadata` returns a name; the Robinhood side started working this
session), and it is not being used on any listing surface.

**No images anywhere.** The prize is rendered as a mint address. `assetMetadata`
returns an image URL and nothing consumes it. For a product whose inventory is
*pictures*, this is the most conspicuous absence, and on the raffle page it
leaves a 44-character base58 string where the thing being sold should be.

**No wordmark.** "nftraffle" is set in the body sans at `text-2xl`. Correct for
now — §11 forbids baking a placeholder name into an image — but it means the
home page has no identity at all.

**The home page has no shape.** A heading, two links, a list, a second list. No
hierarchy between "a raffle closing in nine minutes" and "a raffle that finished
last week"; both are one row with the same weight.

**Empty states are bare.** "No collections yet." with nothing around it.

**Contrast is unmeasured.** §7 asks for 7:1 body and 8:1 on any figure someone
is about to make a money decision on, asserted in a test suite so a regression
fails CI. None of that machinery exists here, because there is no palette to
measure. Tailwind's `neutral-500` on white is roughly 4.8:1 — under §7's floor,
and it is used for every field label including the ones next to prices.

---

## 4. The one thing I would fix first

Not the palette. **Give a raffle a name and a picture.**

Every other gap on this list is cosmetic in the literal sense — it changes how
the product feels. That one changes whether the product is legible at all: a
visitor cannot tell what is being raffled without copying a base58 string into
an explorer. The plumbing already exists on both chains; nothing needs designing
to use it, and doing it first means the palette pass later has real content to
be designed around instead of placeholder rows.

Second would be the countdown, for the same reason: it is the product's own
stated register and it is currently an ISO timestamp.

**Neither is in this batch**, per the instruction to report and not redesign.

---

## 5. What a design batch would need decided first

These are the questions that block a palette pass, and they are the owner's:

1. **The accent colour's one job.** §2 says it means the clock and nothing else.
   That rules out using it for buttons, links or the "buy" call to action —
   which is unusual, and worth confirming before a system is built on it.
2. **How much the product should look like a casino.** §2 rejects both the
   casino register and marketplace neutrality. The space between them is wide.
3. **Whether the name is settled**, because a wordmark is the first thing a
   palette pass wants to make and §11 forbids it while the domain is unbought.
