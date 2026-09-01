# The first real raffle — pre-flight

One step at a time, with what to look at and what it should say. Real money, one
chance to get it right in public.

**Do not start this until the devnet rehearsal
([`docs/devnet-rehearsal.md`](devnet-rehearsal.md)) has passed with every
negative refusing.** The positives failing there costs an afternoon; a negative
passing there means the same code accepts it here.

**Ground rule for the whole list: if a step's check does not say what it should,
stop.** Nothing below is urgent enough to push past a surprise, and the raffle
has not been announced yet.

---

## A. Before anything is announced

### A1 — Escrow is funded and reachable

```bash
solana balance <ESCROW_WALLET_SOLANA> --url mainnet-beta
```

**Expect ≥ 0.05 SOL.** Escrow pays the fee on every payout transfer, and an
arriving NFT may need rent. An unfunded escrow discovers this at payout time,
which is the worst moment.

**Confirm you can sign with it.** Not "the address is right" — actually load the
key in a wallet and look at it. The escrow key is the only thing in this system
that can move somebody else's property, and this codebase deliberately cannot
reach it.

### A2 — The two wallets are different, new, and not another project's

```bash
echo $PAYMENT_WALLET_SOLANA
echo $ESCROW_WALLET_SOLANA
```

Different from each other, and neither is bidoor's or pixelwar's. Keeping fees
and custodied assets in one wallet makes "what do we actually owe people"
unanswerable at the moment somebody asks.

> If `PAYMENT_WALLET_SOLANA` **is** shared with bidoor or pixelwar, read the
> "Shared payment wallet" note in `docs/operations.md` before selling a single
> ticket. It is not a blocker for this raffle; it is a blocker for reconciling it
> afterwards.

### A3 — Production is configured and the surfaces are open

Load these on the production URL:

| Page | Expect |
|---|---|
| `/` | renders, wordmark present |
| `/raffle/new` | the **form**, not "not open yet" |
| `/launch` | fee figures, not "—" |
| `/admin` | sign-in form |

If `/raffle/new` says "not open yet", a variable is missing. The specific one is
in the Vercel runtime log — the page will not tell you, deliberately.

### A4 — The RPC is mainnet, and the app agrees

```bash
curl -s -X POST https://<prod>/api/rpc -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestBlockhash","params":[]}'
```

**Expect** a `result` with a blockhash. A `503` means `SOLANA_RPC_URL` is unset;
a `400` means the method is not whitelisted; anything echoing a provider URL is a
bug worth stopping for.

**Then confirm it is mainnet.** A deployment pointed at devnet will happily show
"open" while nothing it settles is real. The cluster is classified from the
endpoint's host and path — never its query string, where the key lives — and an
unclassifiable URL blocks signing rather than guessing.

### A5 — The noindex is still on

```bash
curl -sI https://<prod>/ | grep -i x-robots-tag
curl -sI -X POST https://<prod>/api/rpc | grep -i x-robots-tag
```

Both must answer `noindex, nofollow, noarchive`. The first raffle is not the
moment to be indexed.

### A6 — Every image host is followed to where it actually serves

**`img-src` is judged against the REDIRECT TARGET, not the URL in the markup.**
So an allowlist entry that only redirects is decorative: the browser follows the
`302`, lands on a host that is not listed, and blocks the image — which renders
as our "no image" placeholder and looks exactly like a missing asset.

This is not hypothetical. It happened on devnet on 2026-09-01 with a correctly
uploaded image, and it survived a green test suite, because no test here can know
a third party's HTTP behaviour.

**Run this against the MAINNET gateways before opening production**, with a real
content id for each host:

```bash
curl -sL -o /dev/null -m 30 -w "%{http_code}  %{url_effective}\n" "<a real URL on that host>"
```

**Read the final host, not the status.** A `404` is fine — it still reveals
whether the host redirected, and to where. What matters is whether the host in
`url_effective` is on `IMAGE_HOSTS` in `src/lib/image-hosts.ts`.

**Measured 2026-09-01**, and the allowlist is the result:

| Host probed | Final host | Consequence for the list |
|---|---|---|
| `arweave.net` | `<hash>.arweave.net` | `https://*.arweave.net` is REQUIRED, not decoration |
| `gateway.irys.xyz` | `<hash>.mainnet-1.datasprite-cdn.com` | `https://*.datasprite-cdn.com` is REQUIRED |
| `ipfs.io` | `ipfs.io` | direct |
| `nftstorage.link` | `ipfs.io` | `https://ipfs.io` is REQUIRED for this gateway too |
| `cloudflare-ipfs.com` | does not resolve | **removed from the list** |
| `shdw-drive.genesysgo.net` | same host | direct |

**Irys was the one line that started out inconclusive, and it is now settled.**
The first attempt used an Arweave id, which `gateway.irys.xyz` answers `404` to
without redirecting — so it proved nothing, and said so rather than reading the
absence of a redirect as evidence there is none. Re-run 2026-09-01 with three
real mainnet Irys ids, obtained from the network itself rather than guessed:

```bash
# Ask Irys for real mainnet transaction ids, then follow one.
curl -s -X POST https://uploader.irys.xyz/graphql -H 'content-type: application/json' \
  -d '{"query":"{ transactions(limit: 3) { edges { node { id } } } }"}'
curl -sL -o /dev/null -r 0-0 -w "%{num_redirects} -> %{url_effective}\n" \
  "https://gateway.irys.xyz/<id>"
```

All three redirected once, to `<content-hash>.mainnet-1.datasprite-cdn.com`.
**Same domain as devnet, different subdomain prefix** (`mainnet-1` against
`devnet-1`), so the wildcard `https://*.datasprite-cdn.com` covers both — which
was already the entry, and is now a measurement rather than an extrapolation
from devnet.

**Use `-r 0-0`.** Without it, following the redirect downloads the whole object,
and a large one times out and reports `000` — which looks exactly like an
unreachable host. A range request asks for one byte and still reveals the chain.

**This table goes stale.** Gateways change where they serve from, and one of them
disappeared entirely between being added to this list and being measured. Re-run
before production, not once.

---

## B. Listing it

### B1 — Pick a prize you can afford to lose

**There is no minimum** (decisions.md Q2). The draw runs on whatever sold, so a
raffle that sells one ticket transfers the prize for one ticket's price. That is
the mechanism working, not a failure of it.

For the first one, pick something whose one-ticket outcome you would accept
without argument. The screen shows you that number before you commit — read it.

### B2 — Create the draft

Through `/raffle/new`. **Check the response carries** `seedHash` and `drawHeight`,
and that `seedHash` is 64 hex characters.

**The seed itself must not appear anywhere** — not in the response, not in a log,
not on the page. Confirm:

```bash
curl -s https://<prod>/r/<slug>/verify | grep -c "not revealed"   # expect 1
```

If the seed is visible before the draw, stop. Publishing it early lets anyone who
reads it compute the winning number once the announced block arrives.

### B3 — Deposit and publish

Send the listing fee and the NFT **from the wallet the draft names**. Then
publish.

**Expect** `status: "open"`. Then verify the chain agrees, independently of our
page:

```bash
# Ask Solana who holds the prize now. Must be the escrow wallet.
curl -s -X POST $SOLANA_RPC_URL -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getAsset","params":{"id":"<PRIZE_MINT>"}}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['result']['ownership']['owner'])"
```

**This is the check worth doing by hand the first time.** Our publish path
already asks it, and reading it yourself once is how you learn what the page is
asserting on your behalf.

### B4 — Read the public page as a stranger

Open `/r/<slug>` in a private window. Check:

- The prize mint matches what you deposited.
- The ticket price matches what you set.
- `/r/<slug>/verify` shows the commitment and announced height, and says the seed
  is **not revealed**.
- Nothing on either page promises anything not in `docs/decisions.md`: no odds
  phrasing, no "guaranteed", no claim about legality, and the platform fee is
  never called a network fee.

---

## C. While it runs

### C1 — The first ticket is the one to watch

After the first purchase confirms:

```sql
SELECT number, wallet FROM tickets WHERE raffle_id = '<id>' ORDER BY number;
SELECT status, paid_at FROM ticket_orders WHERE raffle_id = '<id>';
SELECT * FROM unmatched_payments;
```

**Expect** contiguous numbers from 1, the order `paid`, and `unmatched_payments`
**empty**. A row there means real money arrived and could not be applied — work
it before selling more.

### C2 — Check the balance matches the tickets

```bash
solana balance <PAYMENT_WALLET_SOLANA> --url mainnet-beta
```

Should have risen by exactly `tickets sold × price`. If it has not, something
settled that should not have, or something arrived that we did not credit.

---

## D. Closing and drawing

### D1 — Let a read close it

This project has no cron: **reads drive transitions.** Load `/r/<slug>` after
`endsAt` and confirm the status reads `closed`.

### D2 — Draw

`/admin` → "Reveal and draw".

**A `409` saying the announced block has not arrived is correct, not a bug.** The
announced slot sits an hour past the close by design, and the draw never
substitutes a different one — which slot was announced is part of what was
published. Wait.

### D3 — Verify the draw as a stranger would

```bash
curl -s https://<prod>/r/<slug>/verify | grep -o "they agree\|THEY DO NOT AGREE"
```

**Expect `they agree`.** The page recomputes the winner from the published
inputs rather than showing the stored one, so this is a real check and not a
restatement.

Then do it yourself, once, by hand — this is the whole promise of the product:

```bash
# material = sha256(seedHash + seed + blockhash + raffleId), as UTF-8 text
python3 -c "
import hashlib
m = hashlib.sha256(('<seedHash>' + '<seed>' + '<blockhash>' + '<raffleId>').encode()).hexdigest()
print('winning ticket:', int(m, 16) % <ticketCount> + 1)"
```

It must equal the winning ticket on the page. **If it does not, do not pay
anybody** — publish nothing further and work out which side is wrong.

---

## E. Paying out

### E1 — Compute the split and check it against the screen

`/admin` shows gross, platform fee and the seller's net. Recompute:

- gross = tickets sold × ticket price
- house = gross × bps ÷ 10000, rounded **down**
- seller net = gross − house

They must match. The remainder always goes to the seller, never the house.

### E2 — Send the prize, then the proceeds

Prize out of escrow to the **winner's wallet as the page shows it**. Then the
seller's net to the seller.

Send the prize first. It is the leg that cannot be undone, so it is the one to
do while you are most careful.

### E3 — Mark paid, and let the server refuse you if you got it wrong

Paste both signatures into `/admin`.

**Expect `303` back to `/admin`.** A `409` means the chain does not agree with
what you are claiming — wrong recipient, wrong mint, not out of escrow, or the
seller underpaid. **That refusal is the feature.** The public page shows this
mark to the person who did *not* send the transfers, and it is the only thing
they have.

Do not work around a refusal. Find out why.

### E4 — The page tells the story

`/r/<slug>` should show `paid` with both transaction signatures. Open them in an
explorer. Anyone can.

---

## F. Afterwards

- `unmatched_payments` and `orphan_deposits` empty, or every row worked.
- Escrow holds nothing that is not backing a live raffle.
- Write down anything that surprised you. The second raffle is the one where the
  process gets fixed; the first is where it gets discovered.

**Then, and only then**, the Robinhood surface becomes eligible to open — with
the three prerequisites in `docs/operations.md` still outstanding.
