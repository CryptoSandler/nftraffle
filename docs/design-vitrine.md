> **DISCARDED — 2026-09-02.** The owner chose direction 3, POPMINT. This one was
> not taken.
>
> The branch `design/vitrine` (tip `43fc66e13e2998abb6886c8ec1a961a0192da4de`)
> was deleted after this file and its screenshots were brought here, so the
> argument survives the branch. `docs/design-shots/vitrine/` holds what it looked
> like at 390 and 1440.
>
> **Nothing below is normative.** It describes tokens, rules and a register this
> repository does not use — the chosen direction is `DESIGN.md`. It is kept
> because a benchmark that cannot say what it rejected is a benchmark that
> rebuilds it by accident.

# Direction 1 — VITRINE (editorial / gallery)

**A candidate, not a decision.** One of three built to be looked at side by side
(`docs/references-design.md` for what each borrows from). Nothing here is merged.

---

## The bet

**The work is the point, and the platform gets out of its way.**

This product's problem is not that people cannot find things — it has almost
nothing to find. It is that a stranger arriving has no reason to believe the
collections are worth anything or that the draw is honest. A gallery register
answers the first by treating the art as the whole page, and the second by being
plain enough that the verification page reads as the same voice rather than a
disclaimer.

**Who it is for:** a creator deciding where to put work they care about.

**What it gives up, stated:** it is the least crypto-looking of the three, so it
will read as slower and less "degen" to somebody who wants a mint that feels
like a slot pull. That audience is Magic Eden's, and `docs/decisions.md` Q19
already declined it.

## The three entries

`Launch`, `Mint` and `Raffle` are one component rendered three times — same
cell, same type, same hover. They cannot drift in weight because there is
nothing to drift: the numbering (`01 02 03`) is the loop's order, not a ranking.

## Tokens, measured

Generated and checked against the floors in `src/lib/design-tokens.ts`; every
figure below recomputes in `design-tokens.test.ts` and the build fails if a hex
moves without the table moving.

| token | light | dark | job |
|---|---|---|---|
| `ground` | `#F7F5EF` | `#0E0E0C` | the page: paper, not white |
| `panel` | `#EEEBE1` | `#181815` | a raised block |
| `ink` | `#141410` | `#EFEDE4` | body text and headings |
| `quiet` | `#4C4A42` | `#A9A79B` | labels and secondary text |
| `rule` | `#D5D1C4` | `#2C2B25` | hairlines |
| `edge` | `#77746A` | `#6D6A61` | the border of a control |
| `accent` | `#1B3F8F` | `#A8C3FF` | the one live thing on the page |

| | on ground | on panel | floor |
|---|---|---|---|
| light `ink` | 16.94 | 15.48 | 7:1 |
| light `quiet` | 8.14 | 7.44 | 7:1 |
| light `accent` | 8.94 | 8.17 | 8:1 |
| dark `accent` | 11.42 | 10.38 | 8:1 |

**The ground is paper.** `#F7F5EF` rather than white is the cheapest exit from
crypto's black-or-white default, and it is what Big Cartel uses to look
considered without spending anything (`references-design.md` §7).

## The accent's job

**It marks what is LIVE — a countdown, and a dot beside anything currently
open.** One step wider than `docs/decisions.md` Q19's clock-only rule, which the
owner suspended for this exploration; the widening is a single statement (*this
is happening now*) rather than a second job.

It still may not touch a button, a link, an error, a price or a heading. **The
primary action stays ink on paper**, which is the cost Q19 accepted and this
direction keeps. A test enforces the boundary rather than a note.

## Motion

**One fade and one tick.** An image fades in over 160ms as it arrives; the clock
counts. Nothing else moves, and `prefers-reduced-motion` removes the fade. A page
about permanent objects that animates is a page arguing with itself.

## Type

`Instrument Serif` for the headline and the wordmark only; Inter for every
sentence; IBM Plex Mono for every figure. A serif at hero size is a claim about
importance, and most of this page is not making one.

## Working name

The name is undecided (`DESIGN.md` §11) and the wordmark is deliberately **set
in type, not drawn**, so nothing has to be redrawn when it changes.

| candidate | `.fun` | why |
|---|---|---|
| **vitrine** | free (checked 2026-09-02) | the glass case a gallery puts one object in — the whole layout in a word |
| **recto** | free | the front of a printed leaf: editorial, and quietly about first impressions |
| **cadre** | free | frame, in French and in Spanish — and "a small group", which a launch is |

Checked over RDAP against `rdap.org`, with `pump.fun` as a registered control
and a nonsense name as a free one, so a wrong answer would have shown up as both
reading the same.
