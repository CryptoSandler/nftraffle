> **CHOSEN — 2026-09-02.** The owner picked this direction, and it is now
> normative in `DESIGN.md` — §2 (colour and register), §3 (type), §5 (layout),
> §6 (motion), §10 (the bet) and §11 (the name). `docs/decisions.md` Q22 records
> the decision and the reopening of Q19 it required.
>
> **Nothing below is normative**, including where it disagrees with `DESIGN.md`:
> this is the argument as it was put to the owner, kept unedited so the choice can
> be read against what it was choosing between (`docs/design-vitrine.md` and
> `docs/design-mintdesk.md`, both discarded the same day). Where this file and
> `DESIGN.md` differ, `DESIGN.md` is what the code is held to.

# Direction 3 — POPMINT (toy / pop)

**A candidate, not a decision.** One of three built to be looked at side by side.
Nothing here is merged.

---

## The bet

**Invite the person who has art and has never minted anything.**

Arrow one of the loop is "instant launch, no vetting", and it is aimed at a
creator, not a trader. A gallery says *your work will be judged*; a terminal says
*not for you*. This one says *press this*. It is the only one of the three that a
person with no wallet reads as an invitation.

**Who it is for:** someone deciding whether to try, in the ninety seconds before
they close the tab.

**What it takes.** Gumroad's two moves (`docs/references-design.md` §6): a
promise stated as a **number** — `0 → live in 3 minutes` — and **one loud colour
that is both the brand and the thing you press**. From Launch My NFT (§1), art
tiles with no card chrome around them.

**What it gives up, stated:** it is the easiest of the three to mistake for the
register this product has decided not to be. Magic Eden now sells "Lucky Buy"
and packs in magenta with a 3D mascot (§3), and loud is one bad decision away
from that. The distance is kept deliberately and it is the direction's whole
discipline — see below.

## Zero casino, in the direction where it costs something

`docs/decisions.md` Q19 is not suspended for this: **no confetti, no gold, no
red urgency, no green success, nothing that spins, nothing that celebrates a
result.** The entire motion budget is **two pixels of press**, on two classes,
at 90ms — and a press happens *before* an outcome, which is the line. `DESIGN.md`
§6 carries the rule and a test asserts both the duration and that exactly three
selectors move.

The colour is violet rather than magenta or pink on purpose: magenta is Magic
Eden's, and this direction's risk is being mistaken for them.

## The three doors

`Launch`, `Mint` and `Raffle` are one component rendered three times — same
panel, same size, same press. The large button in the hero goes to the same
place as the first door: a hierarchy of **emphasis**, not of importance, so
somebody who already knows what they want does not have to read a hero first.

## Tokens, measured

| token | light | dark | job |
|---|---|---|---|
| `ground` | `#FEFCF8` | `#0B0714` | the page |
| `panel` | `#F2EDFF` | `#161028` | a raised block: cards, the three doors |
| `ink` | `#120C22` | `#F2ECFF` | body text and headings |
| `quiet` | `#494060` | `#ABA1C6` | labels and secondary text |
| `rule` | `#DBD3EF` | `#2B2145` | hairlines |
| `edge` | `#786D95` | `#6E6490` | the border of a control |
| `accent` | `#431BBB` | `#B79DFF` | the brand and the action |

| | on ground | on panel | floor |
|---|---|---|---|
| light `accent` | 11.24 | 8.83 | 8:1 |
| dark `accent` | 9.98 | 8.44 | 8:1 |

The accent clears 8:1 in both modes **as text**, which matters here more than in
the other two: it is a filled button with the ground colour on it, so both
directions of that pair had to be measured rather than assumed.

## The accent's job — and the decision it reopens

**It is the brand and the thing you press**, plus the clock.

This is the direction that **reverses Q19**, which gave the accent one job and
accepted a black-on-white primary action as the price. If this one is chosen,
Q19 has to be reopened and answered again rather than quietly overridden. The
comment in `design-tokens.test.ts` says so at the place somebody would otherwise
just edit.

The replacement is still a rule and still enforced: the accent is `.pop-action`
and `.clock`. Not a heading, not body text, not a border, not a state.

## Type

`Archivo Black`, one weight, used at sizes where the letters stop being type and
become a shape — for the headline, the wordmark and the three doors only. Inter
for sentences, IBM Plex Mono for every figure.

## Working name

| candidate | `.fun` | why |
|---|---|---|
| **popmint** | free (checked 2026-09-02) | says what happens and how it feels, in two syllables |
| **sticker** | free | the thing a kid makes a hundred of and gives away — which is what a 1,000-item launch is |
| **poppy** | free | short, warm, and not a crypto word |

Checked over RDAP with `pump.fun` as a registered control and a nonsense name as
a free one. `bodega.fun`, `firstmint.fun`, `supply.fun` and `plinth.fun` came
back registered and were dropped; three queries (`atelier`, `hangar`, `mintbox`)
did not answer at all and were **not** treated as free.
