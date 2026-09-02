# Design references, with provenance

**Every entry below was opened and looked at on 2026-09-02**, at 1440px, from
this machine. Screenshots are in the working directory rather than the
repository — what is kept here is what was seen and what it is worth.

The question each one is asked is the same: **what would make this product look
like it cost money to build, without making it look like the thing people are
right to be suspicious of.**

---

## Crypto

### 1. Launch My NFT — https://launchmynft.io/

**What it is.** A self-serve launchpad, which is the nearest thing to arrow one
of our loop that exists.

**What it does.** Near-black ground. One saturated mint-green accent, used on
the wordmark, on section headings, and on the active carousel dot — and nowhere
else. Collections are **edge-to-edge art tiles in an asymmetric grid**, the name
set over the image at the bottom-left with a small chain glyph beside it. No card
chrome at all: no border, no padding, no metadata row. Nav is plain horizontal
text; Connect Wallet is an outlined pill at the top right.

**Steal:** art tiles with the title burned into the image and no card around
them; the asymmetric grid, which makes eight items look curated rather than
paginated; one accent that only ever marks headings and state.

**Do not steal:** the carousel (it hides half the collections behind an
interaction nobody performs), the cookie modal sitting on top of the headline,
and "Hot Collections" — hype language for a page that cannot support it.

### 2. Tensor — https://www.tensor.trade/

**What it is.** The trader's terminal, and the best-executed instance of the
register direction two is named after.

**What it does.** Monospace everywhere, including the nav. A dense table with
40px thumbnails and eleven numeric columns. Green and red on the numbers only,
by direction rather than for decoration. A **status bar pinned to the bottom of
the viewport** — 24h volume, SOL price, TPS — that never scrolls away.
Keyboard-first (`⌘K`), a Lite/Pro toggle, a cards/table switch.

**Steal:** the persistent bottom instrument bar; monospace as the whole voice
rather than a numeric accent; tiny thumbnails so a list stays scannable; the
cards/table toggle as an honest admission that two people want two densities.

**Do not steal:** floor, market cap, 24h Δ and volume — that is precisely the
game `DESIGN.md` §1 forbids playing with a hundredth of the liquidity — and the
rewards/gamification tab.

### 3. Magic Eden — https://magiceden.io/launchpad and https://magiceden.io/

**The finding is the 404.** `/launchpad` no longer exists; the top-level nav is
now **Packs · Wonder Pick (beta) · Lucky Buy · Trade**. The largest Solana
marketplace has moved from launching collections to **selling chance**, and
dressed it in magenta with a 3D mascot.

**Steal:** the bottom status bar again (SOL price, TPS) — two products converging
on it is a signal.

**Do not steal:** everything else, and deliberately. This is the nearest thing
to a competitor for what we sell, and it is the register `docs/decisions.md` Q19
answered with *zero casino*. Their "Lucky Buy" and our raffle are the same
mechanism; looking like them is how a person decides we are the same thing.

### 4. Zora — https://zora.co/

**What it is.** No longer a marketplace: a **social feed**. Light ground, one
column, large square art, author avatar and handle above, relative timestamp,
then a compact row: price as a green figure, a comment count, a share icon, and
one green **Buy** pill.

**Steal:** the discipline of the action row — a price, one button, nothing else;
the creator's name attached to the work rather than to a profile page; a light
neutral ground so the art supplies all the colour.

**Do not steal:** the feed itself. Follows, comments and suggested accounts are a
different product, and `DESIGN.md` §1 forbids the watchlist family.

### 5. Foundation — https://foundation.app/

**Dead, and the notice is the reference.** Dated April 27, 2026: *"Foundation is
offline… we have made the decision not to resume operations."* The most
editorial, gallery-register NFT platform there was.

**What the page does**, which is the lesson: black ground with a faint square
grid, one enormous grotesque headline, body text at a generous measure in plain
sentences, a date in small letterspaced caps above the headline, and a footer of
two words. It is the most expensive-looking page in this document and it is a
shutdown notice.

**Steal:** the register — grid, huge headline, long measure, no ornament — for
direction one.

**Do not steal:** the business. A gallery that curates cannot run on "no
vetting", which is the tension direction one has to resolve rather than inherit.

---

## Outside crypto — platforms that sell "create and sell"

### 6. Gumroad — https://gumroad.com/

**Headline: "Go from 0 to $1".** A promise stated as a NUMBER, not an adjective.
Black ground, one hot pink doing every job — the CTA, the wordmark, and an
oversized coin motif scattered across the hero. Friendly geometric sans, very
large. Sub-line: *"Anyone can earn their first dollar online."*

**Steal:** the numeric promise as the headline (ours is a duration: minutes from
art to mint page); one loud colour that is simultaneously the brand and the
action; a signature object repeated at scale instead of stock photography.

**Do not steal:** "It's that easy" — a promise about an outcome we do not
control — and illustration as personality, when we have creators' real art.

### 7. Big Cartel — https://www.bigcartel.com/

**What it does.** A cream ground rather than white or black. A heavy condensed
display face in caps at hero size — *"HUSTLE WITHOUT THE HASSLE"* — against a
serif body. Exactly one bright accent (cyan) used only on the two buttons.
Rounded photography. Below: *"READY, SET, SELL — 4 simple steps, and you'll be
selling in no time."*

**Steal:** the cream ground, which is the cheapest way to look considered and
the fastest exit from crypto's black-or-white default; naming the cost in the
sub-line (*"plans starting at $0"*) instead of hiding it; the numbered steps
that make the flow legible before anyone signs anything.

**Do not steal:** stock photography of people, and the hustle register.

### 8. Bandcamp — https://bandcamp.com/

**The single most stealable idea in this document.** A section called *just
sold*: a live strip of REAL purchases, each showing the cover art, the actual
amount paid, the buyer's country, and *"32 seconds ago"*. Above it, the headline
is a running total of money paid to artists.

**Steal:** proof of life made of real activity rather than of rankings. A
launchpad with no liquidity cannot show a floor price and should not want to —
but it can show that somebody minted something four minutes ago, which is the
same reassurance without the leaderboard the thesis forbids.

**Do not steal:** the seven-item product nav (vinyl, cassettes, t-shirts) and
the editorial section, both of which belong to a catalogue we do not have.

### 9. Kickstarter — https://www.kickstarter.com/

Captured for the "launch something" register and **not used**: the page that
loaded was a consent wall. Recorded so the absence is not mistaken for an
oversight.

---

## What the three directions take from this

- **Editorial/gallery** takes Foundation's register, Zora's action row, and Big
  Cartel's cream ground.
- **Console** takes Tensor's instrument bar and monospace voice, with its market
  columns deliberately absent.
- **Toy/pop** takes Gumroad's numeric promise and single loud colour, with Launch
  My NFT's art tiles.
- **All three** take Bandcamp's just-sold strip, because all three need to look
  alive before they can look expensive.
- **None** takes Magic Eden's, which is the direction the market is moving and
  the one thing this product has decided not to be.
