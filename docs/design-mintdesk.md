> **DISCARDED — 2026-09-02.** The owner chose direction 3, POPMINT. This one was
> not taken.
>
> The branch `design/mintdesk` (tip `2b395beb282a213d8798d61edbcd5da7f1ec42b3`)
> was deleted after this file and its screenshots were brought here, so the
> argument survives the branch. `docs/design-shots/mintdesk/` holds what it looked
> like at 390 and 1440.
>
> **Nothing below is normative.** It describes tokens, rules and a register this
> repository does not use — the chosen direction is `DESIGN.md`. It is kept
> because the list of patterns it refused (floor price, 24h volume, market cap,
> change) is the same list `DESIGN.md` §1 forbids, and that refusal is worth
> keeping in the reader's hands.

# Direction 2 — MINTDESK (launchpad console)

**A candidate, not a decision.** One of three built to be looked at side by side.
Nothing here is merged.

---

## The bet

**Look like an instrument, because the product is one.**

This is the register the genre already speaks — Tensor is the best-executed
instance of it and Magic Eden runs the same status bar under a very different
product (`docs/references-design.md` §2, §3). A crypto-native arrives already
able to read it, and the density is honest about what this product is: a small
number of live things with exact numbers attached.

**Who it is for:** somebody who already has a wallet and wants the numbers
without a paragraph in front of them.

**What it takes and what it refuses.** It takes the monospace voice, the tabular
figures, the row-per-thing table, and the status bar that never scrolls away. It
refuses **floor price, 24h volume, market cap and change** — the columns those
products are built on, and the exact list `DESIGN.md` §1 forbids playing with a
hundredth of their liquidity. What sits where they would be is what this product
actually knows: the ticket price, how many are left, and how long there is.

**What it gives up, stated:** it is the least welcoming of the three to somebody
who has never minted anything. A creator with art and no wallet reads a terminal
as "not for me", and arrow one of the loop is aimed at exactly that person.

## The three entries

`launch`, `mint` and `raffle` are one component rendered three times — a numbered
key, a verb, a consequence. A terminal presents what it can do as a list of
commands, so the three are that list, and they cannot drift in weight because
there is nothing to drift.

## Tokens, measured

| token | light | dark | job |
|---|---|---|---|
| `ground` | `#F4F6F7` | `#07090A` | the terminal |
| `panel` | `#E8ECEE` | `#111517` | a raised block: rows, the status bar |
| `ink` | `#0C1113` | `#DFE6E8` | body text and headings |
| `quiet` | `#464F51` | `#97A2A5` | labels and secondary text |
| `rule` | `#C9D2D5` | `#232A2C` | hairlines |
| `edge` | `#737C7F` | `#646D70` | the border of a control |
| `accent` | `#004B4F` | `#4FD8E4` | a value that is moving |

| | on ground | on panel | floor |
|---|---|---|---|
| light `accent` | 9.14 | 8.33 | 8:1 |
| dark `accent` | 12.03 | 10.85 | 8:1 |

Recomputed by `design-tokens.test.ts` on every run; a hex that moves without the
table moving fails the build.

## The accent's job

**A value that is MOVING.** A countdown; a supply counting down; the two live
readings in the status bar. Not a price, which is fixed — that distinction is
the whole rule, and it is what keeps the accent meaning something on a page made
almost entirely of numbers.

Q19's clock-only rule is suspended for the exploration by the owner. This is one
step wider and still one statement: *this number is not settled*. A test enforces
it.

## Motion

**None, except the clock.** No hover lift, no row animation — a row highlights
by changing its ground, which is a state rather than a movement. A terminal that
bounces is a terminal nobody trusts.

## Type

IBM Plex Mono for everything, including the navigation and the prose. That is
the direction's whole typographic argument: the mono is the voice, not the
numerals.

## Working name

| candidate | `.fun` | why |
|---|---|---|
| **mintdesk** | free (checked 2026-09-02) | a desk is where an instrument sits; it says launchpad without saying launchpad |
| **readout** | free | what the status bar is, and what the verify page is |
| **dispatch** | free | something goes out, on a schedule, to somebody |

Checked over RDAP with `pump.fun` as a registered control and a nonsense name as
a free one, so a broken check would have shown both reading the same.
