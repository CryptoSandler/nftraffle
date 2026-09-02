# Benchmark — what the best NFT products do, and which half of it we can use

**Captured 2026-09-02, in a real browser, at 1440 and at 390.** This is cierre B.
**Nothing here is built.** It ends in a report and a recommendation, and C does not
start until the owner has answered it.

Every claim below traces to a capture in `docs/benchmark-shots/2026-09-02/` that
was opened and read, not merely taken. Where a site could not be captured, that is
said out loud rather than left as a gap.

---

## 1. The instrument, and its control

Chrome via the DevTools protocol, viewport set with `Emulation.setDeviceMetricsOverride`
(a window cannot go below 500px on macOS, so a "390px" window is a lie — the same
reason `scripts/screenshot.mts` exists), a desktop user agent, and a pass that
dismisses cookie banners and first-visit modals before the shot.

**The control:** `example.com` first, whose content is known. It came back with the
right text and the right width, so a later blank page is the site, not the rig. The
capture tool also reports the page's `document.title` and `innerText.length` beside
every shot — a blocked page and an empty page look identical as an image, and do not
look identical as *77 characters and the title "Deployment Paused"*.

That mattered three times. See §2.

**What the tool cannot do:** it does not connect a wallet. Every flow behind
"Connect Wallet" — Famous Fox's raffle tool, Magic Eden's checkout, Tensor's sweep
— was read from its logged-out state only. Anything below is about what a stranger
sees, which is the state that decides whether they stay.

---

## 2. The field on 2026-09-02, which is itself a finding

Three of the products named as references are not working today:

| site | what came back |
|---|---|
| `fxhash.xyz` | **HTTP 402**, Vercel's "Deployment Paused" |
| `foundation.app` | renders, and its title is **"Foundation is offline"** |
| `degods.com` | 200, then **"Application error: a client-side exception has occurred"** — `degods-error.jpg` |

DeGods is one of the three collections in the brief. Its own site is broken in a
clean browser while its Magic Eden page works fine, which is worth holding onto:
**the marketplace is the durable surface and the collection's own site is not.**

And Magic Eden no longer has a launchpad. `magiceden.io/launchpad` is a 404
(`me-launchpad-404.jpg`); the top-level nav is now **Packs · Wonder Pick · Lucky
Buy · Trade · Earn**. The product the brief calls "Magic Eden's launchpad" does not
exist any more.

---

## 3. Site by site

### Magic Eden — `me-home.jpg`, `me-collection.jpg`, `m-me.jpg`

**What it is now: a lottery with a marketplace attached.** The home page's main
module is *Top Pack Pulls / Lucky Buys*, a row of cards each showing a **payout
multiplier in a green badge** — `10.9X`, `4.6X`, `3.1X` — beside "Value 3.884 SOL".
The mobile home leads with a pack ad whose copy is **"SOL Packs: Sol Platinum.
Better Odds. Shiny Grails."**

*Better Odds* is the sentence `docs/decisions.md` Q19 exists to keep us away from.

The collection page is the genre's reference implementation: a header strip of
Floor Price (with a red `-9.09%`), Top Offer, 7d Vol, 7d Sales, Market Cap,
Listed/Supply, Owners; tabs for Items / Offers / Pools and Analytics / Activity; a
grid with three density settings, search, and a sort; an **Instant Sell tile
occupying the first cell of the grid**; and a sticky bottom action bar carrying
cart, Lucky Buy, Make Offer and Connect Wallet.

**What genuinely feels good, separate from the money:** the density toggle, the
sticky bottom action bar, and the fact that the first thing on the page is a strip
of facts rather than a paragraph.

### Tensor — `tensor-collection.jpg`, `m-tensor.jpg`

The instrument register, executed better than anyone. Monospace, all caps, a
header of BUY NOW / SELL NOW / LISTED-SUPPLY / VOLUME 24H / VOLUME ALL / SALES 24H
/ PRICE Δ 24H, a left rail of filters, and a **status bar that never scrolls away**
carrying Live, a Lite/Pro switch, 24h volume, the SOL price and TPS.

**It asks a first-time visitor to choose an app mode before showing the product** —
a modal offering LITE ("Pictures, Easy Defaults, For Collectooors") or PRO
("Charts, Knobs & Toggles, For Tradooors"). Honest, and it is also a wall in front
of the page.

**Mobile is the best of everything captured.** The header compresses to one line of
figures, the grid becomes two columns, each card carries rarity, id and price, and
the primary action becomes a **fixed bottom BUY/SELL bar above a six-icon tab rail**.
Nothing was hidden in a hamburger.

### OpenSea — `opensea.jpg`

Now trades tokens as well as NFTs. A hero collection card with a
FLOOR PRICE / ITEMS / TOTAL VOLUME / LISTED strip laid over the art, a Trending
Tokens row with **sparklines and green/red percentages**, a right rail of
collections by floor, and a persistent bottom bar (Live · Aggregating · Networks ·
ETH price · Collector/Pro · Crypto/USD).

**The useful part is the hero:** the art is the panel, and the four facts sit *on*
it rather than beside it.

### Zora — `zora.jpg`, `m-zora.jpg`

**Not a marketplace: a feed.** One column of posts — avatar, handle, time, media —
and under each post a row of `▲ $271`, a comment count, a share icon and a green
**Buy**. The right rail is "Last traded" (sparklines, ▲▼ dollar amounts) and
"Suggested follows". On mobile it is a bottom tab bar of five icons whose middle
item is a large **+**.

Zora's answer to arrow one is that **creating is a post**, and the create button is
the centre of the navigation on mobile. That is the single most creator-first
decision in the whole set.

### Scatter — `scatter.jpg`, `m-scatter.jpg`

**"THE ARTIST-FIRST NFT LAUNCHPAD"**, and the closest thing captured to what this
product is trying to be. Worth studying in detail:

- The featured collection is a **full-bleed art panel** with the name, a one-line
  description, the price (`0.07 ETH`) and the chain — and nothing else.
- Under it, **the mint progress bar**: a thin rail with `+70` above it, `6%` at the
  left end and `70/1111` at the right. No animation, no percentage that counts up.
  This is the clearest execution of the pattern in the whole benchmark.
- The stat strip shows `FLOOR PRICE — ETH` and `TOP BID — ETH` with **em dashes**
  when a collection has no market yet. An honest empty state for exactly the case a
  new launch is in.
- Social proof as three counts: COLLECTIONS 2,709 · NEW COLLECTIONS 166 · WEEKLY
  MINTS 260,678 — and then a single primary button, **LAUNCH AN NFT COLLECTION**.
- On mobile the featured collections are a **peek carousel**: the neighbouring cards
  are visible at both edges, so the swipe is discoverable without a hint.

One incidental finding for the owner: its featured collection mints on
**Robinhood Chain**, which is the chain `docs/testnet-rehearsal-robinhood.md` covers.

### LaunchMyNFT — `launchmynft.jpg`

*"The home of NFT creation."* Nav is Collections / Create / Tools / Docs / FAQ /
Support. The collection tiles are **art with no card chrome at all** — the image is
the tile, with the name and a chain badge set over the bottom edge. Below, a "Hot
Collections" rail.

### Highlight — `highlight.jpg`

Pivoted to *"Create and sell digital artifacts with agents."* Monochrome, enormous
type, two plain text links as the only calls to action, and an animated terminal
showing the CLI. The quietest page in the set, and it works — but it is aimed at
somebody who already knows what a collection is.

### Famous Fox Federation — `foxes-home.jpg`

**The closest register to Popmint that exists in production, and the closest
functional peer** — it runs a raffle product on Solana. Orange and deep purple, fully
rounded pill buttons, all-caps display type, illustration in every tile. Its tools
are CITRUS, **FORTUNA**, **RAFFFLE** and MISSIONS.

Two things to take from it and one to refuse. Take: a loud palette can be applied to
a page about money without looking like a scam, and naming the tools rather than the
features makes a small product feel like a place. Refuse: **FORTUNA is a fortune
wheel**, and its tile art is a spinning wheel. That is the exact adjacency Popmint's
register has to stay clear of, from a product that did not.

`/raffles` and `/raffle` both serve the home page; the raffle tool is behind a
wallet, so its interior is not in this benchmark.

### Pudgy Penguins — `pudgy.jpg`

**A Shopify store.** Free-shipping bar, Shop All / New Arrivals / Plushies /
Accessories / Comic Book, a cart. Not one NFT surface on the home page, and not one
number about a market.

The register, though, is precisely the one Popmint chose, executed with total
commitment: pastel ground, chunky outlined display type, generous radius, and a
primary button that is a **soft blue pill with a subtle pressed edge**.

### Azuki — `azuki.jpg`

Also a brand site: TCG / MANGA / SHOP / NEWS / COLLABORATIONS, a full-bleed
illustration, the wordmark in a small red chip, and an email capture panel over the
bottom-right corner. **No floor, no volume, no market data anywhere.**

### DeGods — `degods-error.jpg`

Broken (§2).

---

## 4. LIST A — patterns that work WITHOUT liquidity, and that we replicate

These earn their place by making one of `DESIGN.md` §1's three arrows shorter. Each
is named with where it would live in the Popmint register.

| # | pattern | seen at | why it survives with no liquidity | in our register |
|---|---|---|---|---|
| A1 | **Mint progress: a rail, a percent, a fraction** | Scatter | It reports supply, which we know exactly. It needs no buyers to be true — `0/1000` is as honest as `70/1111`. | A `rule`-coloured rail with an `accent` fill, the fraction in the mono face. **Never animated** (§6). |
| A2 | **Countdown as the loudest fact** | ours already; Magic Eden and Tensor bury it | A clock is the one number this product owns. It is true on day zero. | Already `.clock` in `accent`. Keep. |
| A3 | **Art is the panel, facts sit on or under it** | Scatter, OpenSea hero, LaunchMyNFT | Works with one collection as well as ten thousand. | §5 pattern 3, the card. Radius from `panel`, no card chrome around the image. |
| A4 | **Em dash for a fact that does not exist yet** | Scatter (`— ETH`) | The correct empty state for a product whose collections are all new. Says "no market" without saying "worthless". | A rule for §8: an absent figure is `—`, never `0`, never hidden. |
| A5 | **Sticky bottom action bar on mobile** | Tensor, Magic Eden | Pure ergonomics. Costs nothing, needs no data. | One `.pop-action` fixed to the bottom on the raffle and mint pages. |
| A6 | **Bottom tab rail, create in the middle** | Zora, Tensor | Puts arrow one (launch) at the thumb, not in a hamburger. | Three items, matching the three doors. |
| A7 | **Peek carousel on mobile** | Scatter | Makes the swipe discoverable with no hint text and no dots. | The home's running-raffles row at 390. |
| A8 | **Density toggle on a grid** | Magic Eden, Tensor | Respects a returning visitor without adding data. | Only if a collection page ever holds enough items to need it. Not before. |
| A9 | **Counts as social proof** | Scatter (`COLLECTIONS 2,709`) | Uses numbers we have — collections launched, raffles settled, draws verifiable. | Only figures we can derive. **A count we cannot compute is not written.** |
| A10 | **Naming the tools, not the features** | Famous Fox (CITRUS, RAFFFLE) | Makes a three-surface product feel like a place rather than a form. | The three doors already do this. Do not rename them to verbs-with-objects. |
| A11 | **Progressive disclosure of the honest bit** | ours already | The verify page is our version of Tensor's status bar: the thing that is always reachable. | `/verify` reachable from every raffle card, not only from the raffle page. |

## 5. LIST B — patterns that feel good ONLY because there is liquidity, and are discarded

Written down so they are not rebuilt by accident. Each one is genuinely good on the
site it came from, which is why this list has to exist.

| # | pattern | seen at | why it does not survive here |
|---|---|---|---|
| B1 | **Floor price** | Magic Eden, OpenSea, Tensor, Scatter | A floor is the lowest of many live asks. With one seller it is that seller's price wearing a word that implies a market. `DESIGN.md` §1 forbids it by name. |
| B2 | **24h / 7d volume, total volume** | all four marketplaces | Reads as `0` or as a number so small it argues against the product. A metric that only ever embarrasses a new collection is not a metric, it is a churn lever. |
| B3 | **Market cap** | Magic Eden | Floor × supply. Wrong twice over when the floor is one ask. |
| B4 | **Price change %, green and red** | Magic Eden `-9.09%`, OpenSea, Tensor `PRICE Δ` | Needs a price series we do not have — and green/success and red/urgency are refused outright by Q19 regardless. |
| B5 | **Sparklines** | OpenSea, Zora | Same missing series, plus a line that is mostly flat noise at low volume reads as a dying asset. |
| B6 | **Top offer / bids / collection bid / pools** | Magic Eden, Tensor | An orderbook. `DESIGN.md` §1: this is Magic Eden's game played with a hundredth of their liquidity. |
| B7 | **Instant Sell in the first grid cell** | Magic Eden, Tensor | Needs a bid pool to sell into. There is none, and a button that cannot work is worse than no button. |
| B8 | **Trait rarity, rarity rank badges** | Tensor (`♥7649`), Magic Eden | Rarity ranks are a secondary-market pricing tool. On a collection with no secondary market they are decoration that implies one. |
| B9 | **Trending / Hot / Top rankings** | OpenSea, Magic Eden, LaunchMyNFT | A ranking over a handful of items ranks noise, and it is a curation surface — a different product (`DESIGN.md` §1). |
| B10 | **Multipliers, packs, odds copy** | Magic Eden (`10.9X`, "Better Odds") | The casino register, in the clearest form the field currently offers. Q19 answer 2, unchanged by Q22. |
| B11 | **A fortune wheel** | Famous Fox (FORTUNA) | Same, from the product whose register is otherwise closest to ours. This is the adjacency the direction has to hold distance from. |
| B12 | **Post-as-coin, price on every item** | Zora | Turns every creation into a traded asset. It is a coherent product and it is not this one. |
| B13 | **App mode chosen before the product** | Tensor (LITE/PRO) | Requires the visitor to know which of two traders they are. Arrow one is aimed at somebody who is neither. |
| B14 | **Watchlists, favourites** | Tensor, OpenSea | Serves a returning trader tracking many things. Serves nobody with three live raffles. |

---

## 6. The sketch — what this implies for Popmint, described and not built

Compare against `docs/design-shots/popmint/home-1440.png` and `home-390.png`, which
are the direction as it stands today.

**Home.** Keeps the hero `0 → live in 3 minutes` and the three doors. Adds: the
running-raffles row becomes a peek carousel at 390 (A7); each raffle card gains the
progress rail (A1) under the countdown; each collection card gains the same rail for
its mint. Adds a bottom tab rail at 390 with three items (A6).

**Collection page.** Art is the panel (A3). Facts under it are: ticket or mint
price, `minted / supply` with the rail, the countdown if there is one, and the
creator's wallet. Absent facts are em dashes (A4). **No stat strip.** The reference
here is Scatter's featured panel and Azuki's restraint — not Magic Eden's header.

**Raffle page.** Same card, plus the sticky bottom action bar at 390 (A5), plus
"check this draw" reachable from the card and not only from the page (A11).

**What is deliberately NOT added:** everything in list B. In particular the
collection page gets no floor, no volume, no rarity and no offers, which is the part
of "at the level of Magic Eden" that this benchmark declines.

---

## 7. The report, and what the owner has to answer

**The recommendation is that "a collection page at the level of Magic Eden" is
answered by list A and refused by list B**, and the refusal is the recommendation,
not a caveat on it. Magic Eden's collection page is excellent *at being the front
end of an orderbook*. Rebuilt over one seller and no bids, the same layout is a page
of blanks and zeroes, and every blank argues that the collection is dead. Scatter,
Azuki and Pudgy are the better references precisely because none of them shows a
market on the surface a stranger lands on.

Three things need the owner's answer before C starts:

1. **Is list B accepted as written?** It is the load-bearing half. If any of B1–B9
   is wanted anyway, that is a change to `DESIGN.md` §1 and needs a Q23, not an
   implementation ticket.
2. **The bottom tab rail (A6) is a navigation change**, not a styling one. It makes
   *launch* a permanent thumb-reachable target on mobile. Worth it, and it is the
   one item in list A that changes the shape of the product rather than a page.
3. **A9, counts as social proof, needs a number we can stand behind.** "Collections
   launched here" is honest at 7. If it is not honest at 7, the module waits.

**Still open, and not blocking:** Scatter mints on Robinhood Chain, the chain this
repository already has a testnet runbook for.
