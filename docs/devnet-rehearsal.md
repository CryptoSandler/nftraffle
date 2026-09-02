# Devnet rehearsal — a whole raffle, server-side, before any money

**Purpose:** run every gate that would cost real money if it were wrong, on
devnet, with no browser and no mainnet lamports.

**What this rehearses:** draft creation, escrow verification, the listing fee,
ticket orders, settlement, the commit–reveal draw against a real announced slot,
and payout verification. Plus the four negatives that matter more than the happy
path.

**What it cannot rehearse**, stated first so nobody discovers it halfway:

1. **The buy panel's cluster gate.** `paymentSafety` refuses to sign unless the
   cluster is mainnet. Batch C relaxes that outside production — see
   `docs/deploy.md` — but this runbook drives the API directly and never touches
   it.
2. **Adversarial pressure.** Nobody cheats for devnet SOL. Every check below can
   be exercised, but only by us, deliberately.

Everything is driven with `solana`, `mplx` and `curl`. **No browser is needed
for any step**, which is the point: the whole server-side gate is reachable
without Batch C existing.

**BUDGET ABOUT 45 MINUTES, and much of it is waiting.** The draw's entropy is
anchored ten minutes past the raffle's close (`DRAW_ANCHOR_DELAY_MS`), and the
shortest raffle a seller may create is 15 minutes. So the floor is 15 + 10 = 25
minutes before the draw can run at all, plus setup. Everything up to the draw
takes about ten minutes; then the clock does the work.

**This used to be 90 minutes.** The old design put the draw an hour past the
close because it needed a wide margin to absorb a slot-rate estimate that could
be wrong. The estimate is gone (`docs/decisions.md` Q14), and so is most of the
wait — the margin is now covering clock skew rather than arithmetic error.

Two things follow. Start the raffle FIRST and run the escrow and ticket
negatives while it runs — they use a second asset and do not touch it. And do
not shorten the margin to speed the rehearsal up: it is the property that makes
the announced slot unknowable when the commitment is published.

---

## 0. Prerequisites

```bash
solana --version          # 1.18.26 or later
npm i -g @metaplex-foundation/cli   # provides `mplx`, for the Core asset
mplx --version
```

### The RPC — public devnet is enough

**`https://api.devnet.solana.com` serves DAS.** An earlier draft of this runbook
said it did not and demanded a Helius key; running it proved otherwise:

```bash
curl -s -X POST https://api.devnet.solana.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getAssetsByOwner",
       "params":{"ownerAddress":"11111111111111111111111111111112","page":1,"limit":1}}'
```

That returns indexed assets. The control that makes it conclusive: an
unsupported method answers `-32601 Method not found`, while `getAsset` on a
nonexistent id answers `-32000 Database Error: RecordNotFound` — a DAS backend
replying, not a missing method.

A Helius devnet key still works and will be faster and less rate-limited. It is
not a prerequisite.

### Three keypairs

The rehearsal needs three identities, and keeping them separate is what makes
the negative tests meaningful.

```bash
mkdir -p ~/.config/solana/nftraffle-devnet && cd ~/.config/solana/nftraffle-devnet

solana-keygen new --no-bip39-passphrase -o seller.json
solana-keygen new --no-bip39-passphrase -o buyer.json
solana-keygen new --no-bip39-passphrase -o escrow.json
solana-keygen new --no-bip39-passphrase -o payment.json
solana-keygen new --no-bip39-passphrase -o impostor.json   # for the negatives

for k in seller buyer escrow impostor; do
  echo "$k = $(solana-keygen pubkey $k.json)"
done
```

`payment.json` never signs anything in this rehearsal — it only receives, which
is exactly its role in production. Generate it anyway so the address is real.

### Fund them

```bash
solana config set --url devnet
for k in seller buyer escrow impostor; do
  solana airdrop 2 "$(solana-keygen pubkey $k.json)"
  sleep 8
done
```

**Expect this to fail, and plan for it.** The public faucet is aggressively
rate-limited per IP and answers:

```
429 You've either reached your airdrop limit today or the airdrop faucet has run dry.
```

Retrying, smaller amounts and longer sleeps do not help once the daily limit is
hit — verified. The alternatives, in order of how likely they are to work:

| Route | Works headless? | Measured behaviour |
|---|---|---|
| An existing funded devnet wallet | **yes** | `solana transfer` from one you already hold. The only reliably unattended route. |
| `https://faucet.solana.com` | no | Browser plus a GitHub login. A person has to do it. |
| A Helius devnet key | **no, and this surprised me** | `requestAirdrop` answers `-32403 Rate limit exceeded. The devnet faucet has a limit of 1 SOL per project per day.` — a **tighter** cap than the public faucet's per-IP one, and it applies to the whole Helius project, so an unrelated earlier request consumes it. Refused at 1.0, 0.5 and 0.1 SOL alike. |

**A Helius key does not remove the browser dependency.** It was recommended here
on the assumption that a paid provider's faucet would be more generous; measured,
it is stricter. Its value is DAS throughput and rate limits on ordinary reads,
not funding.

**The durable fix is a funded devnet wallet kept between rehearsals.** Fund one
once, by whatever route works that day, and top the five keypairs up from it with
`solana transfer`. Devnet SOL is not consumed by much — the whole rehearsal costs
well under 0.1 SOL in fees.

### Fund ONE wallet, then distribute by transfer

**The faucet seeds; `solana transfer` distributes.** Every faucet caps by count
as well as amount — the public one allows roughly two airdrops per 8 hours — so
asking it for four wallets fails halfway and leaves a confusing partial state.

Ask the faucet for **1 SOL each into `seller` and `buyer`**, then split from
there. The first transfer into an empty address needs
`--allow-unfunded-recipient`, which creates the account:

```bash
solana transfer --from seller.json "$ESCROW"   0.2 --allow-unfunded-recipient --fee-payer seller.json
solana transfer --from buyer.json  "$IMPOSTOR" 0.2 --allow-unfunded-recipient --fee-payer buyer.json
```

That leaves roughly 0.8 / 0.8 / 0.2 / 0.2, which is ample: the whole rehearsal
costs well under 0.1 SOL in fees. `payment` needs nothing — it only receives.

**Keep `seller` as the durable devnet wallet between rehearsals.** Top the others
up from it rather than returning to a faucet; that is the difference between a
rehearsal you can run today and one that waits 8 hours.

**This is the step that blocks an unattended run.** Everything after it is
scriptable; this one needs either a browser or a key.

### Mint a Core asset for the seller to raffle

Metaplex Core, because DAS indexes it and it is the cheapest thing to create
that `getAsset` will answer about.

```bash
npm i -g @metaplex-foundation/cli    # mplx 0.4.3 at time of writing

# The config KEY is `rpcUrl`, not `rpc` — `mplx config set --help` lists exactly
# rpcUrl|commitment|payer|keypair, and a wrong key fails unhelpfully.
mplx config set rpcUrl https://api.devnet.solana.com
mplx config set keypair ~/.config/solana/nftraffle-devnet/seller.json

mplx core collection create --name "Rehearsal" --uri "https://example.com/c.json"
# note the collection address

mplx core asset create \
  --name "Rehearsal Prize #1" \
  --uri "https://example.com/1.json" \
  --collection <COLLECTION_ADDRESS>
# note the ASSET address — this is PRIZE_ASSET below
```

> **`--rpc` and `--keypair` are global flags on every `mplx` command**, so the
> per-command form works too and is what to use when switching signer mid-flow
> (the deposit-and-withdraw negative below needs exactly that):
>
> ```bash
> mplx core asset transfer <ASSET> <OWNER> -k ./escrow.json -r https://api.devnet.solana.com
> ```

The `--uri` is never fetched by this project (metadata comes from DAS), so a
placeholder URL is fine here and only here.

### Environment

```bash
cd ~/proyectos/nftraffle
cp .env.example .env.devnet   # then edit:

DATABASE_URL=postgres://…/nftraffle          # local docker is fine
TEST_DATABASE_URL=postgres://…/nftraffle_test
RATE_LIMIT_SALT=$(openssl rand -hex 32)
ALLOW_UNTRUSTED_CLIENT_IP=true               # local only, never in production
ADMIN_TOKEN=$(openssl rand -hex 32)

SOLANA_RPC_URL=<YOUR_HELIUS_DEVNET_URL>
PAYMENT_WALLET_SOLANA=<payment pubkey>
ESCROW_WALLET_SOLANA=<escrow pubkey>

RAFFLE_LISTING_FEE_SOLANA=0.01
HOUSE_FEE_BPS_SOLANA=500
LAUNCH_FEE_SOLANA=0.1
MINT_FEE_BPS_SOLANA=300
```

```bash
npm run db:migrate:test      # each target is named; there is no default
cp .env.devnet .env.local && npm run dev
```

> **`.env.local` beats a shell `export`.** Both `next dev` and `next start` load
> it, and a variable exported in your shell does NOT override what is in the
> file. Setting `DATABASE_URL` in the shell and leaving a different one in
> `.env.local` gets you a server quietly talking to the other database — see
> `docs/deploy.md`.

> **THE `psql` LINES BELOW ASSUME A LOCAL POSTGRES.** They are written as
> `docker exec nftraffle-pg psql …` because that is the cheapest way to run this.
> If you point `DATABASE_URL` at a hosted branch instead — the Vercel preview
> mirror in `.env.rehearsal`, say — those lines will not reach it. Run the same
> SQL through any client that reads `DATABASE_URL`; what matters is that the
> database you inspect is the one the server is using, which is the mistake
> worth guarding against here.

**`ALLOW_UNTRUSTED_CLIENT_IP=true` is required locally** and must never be set
in production: without a trusted client address the rate limiter fails closed and
every request is refused.

Shell variables used throughout:

```bash
API=http://localhost:3000
SELLER=$(solana-keygen pubkey seller.json)
BUYER=$(solana-keygen pubkey buyer.json)
ESCROW=$(solana-keygen pubkey escrow.json)
PAYMENT=$(solana-keygen pubkey payment.json)
IMPOSTOR=$(solana-keygen pubkey impostor.json)
PRIZE_ASSET=<the Core asset address>
```

> **`curl` sends no `Origin` header, and that is deliberate on both sides.** The
> cross-site guard refuses a *present, foreign* Origin; a request with none —
> a server-to-server call, or this runbook — passes. That is the same rule a
> same-origin form post relies on.

---

## 1. Create the draft

**The seller signs first.** `POST /api/raffles` stopped taking a seller's wallet
on the caller's word (`docs/decisions.md` Q20); the browser form signs with the
wallet, and a shell signs with this:

```bash
BINDING=$(npx tsx scripts/sign-seller-binding.mts \
  --keypair seller.json --asset "$PRIZE_ASSET" --domain "${API#*//}")
```

`--domain` is the HOST, with no scheme — `${API#*//}` is that. The server rebuilds
the message from its own `Host` header, so a mismatch refuses with `wrong_domain`
rather than with anything about the wallet. The signature is good for five
minutes, so sign it immediately before the call.

```bash
curl -s -X POST $API/api/raffles -H 'content-type: application/json' -d "{
  \"chain\": \"solana\",
  \"prizeAsset\": \"$PRIZE_ASSET\",
  \"ticketPrice\": \"0.05\",
  \"maxTickets\": 5,
  \"durationMinutes\": 20,
  \"binding\": $BINDING
}" | tee /tmp/draft.json
```

**There is no `sellerWallet` field any more on Solana.** It is derived from the
signature. Sending one that disagrees with the signer is refused
(`seller_mismatch`); sending none is the normal case.

**Expect** `201` and a body with `slug`, `chain: "solana"`, `seedHash`,
`drawAt`, `endsAt`.

**Watch for:**
- `ticketPrice` is a **string**, not a number. Eighteen decimals do not survive a
  double, so the parser is a decimal-string parser on both chains.
- `seedHash` is 64 hex characters. The seed itself is **not** in the response and
  must not be — it is in `seed_secret` and is published only at the draw.
- `drawAt` is exactly ten minutes after `endsAt`, and it is a **time**, not a
  slot. Check the arithmetic yourself — it is the entire commitment. There is no
  slot number in this response any more, and that absence is the fix: the old
  `drawHeight` was predicted from an assumed slot rate, and the prediction landed
  early by however much the rate was wrong (`docs/findings-2026-08-31-draw-margin.md`).

```bash
SLUG=$(python3 -c "import json;print(json.load(open('/tmp/draft.json'))['slug'])")
```

**Negative — the seller must hold the asset.** Sign the binding with the
impostor's keypair instead, for the same asset, and post it:

```bash
BINDING_IMPOSTOR=$(npx tsx scripts/sign-seller-binding.mts \
  --keypair impostor.json --asset "$PRIZE_ASSET" --domain "${API#*//}")
```

**Expect** `409` and `That asset is not held by this wallet.` The signature is
VALID here — the impostor really does control the wallet they signed with — and
the refusal comes from the chain being asked who holds the asset. Those are two
different checks and this negative only exercises the second.

**Negative — the signature has to be the seller's.** Take the honest `$BINDING`
from above and replace `fields.address` with `$IMPOSTOR`, leaving the signature
alone:

```bash
BINDING_FORGED=$(python3 -c "
import json,os
b=json.loads(os.environ['BINDING']); b['fields']['address']=os.environ['IMPOSTOR']
print(json.dumps(b))")
```

**Expect** `400` and `address_mismatch`. **If this publishes a draft, stop** —
the seller is being taken on the caller's word again, and anybody can take the
listing slot of any asset on the chain (`docs/decisions.md` Q20).

---

## 2. Pay the listing fee and deposit the prize

```bash
# Listing fee, from the seller, to the payment wallet.
solana transfer --from seller.json "$PAYMENT" 0.01 \
  --allow-unfunded-recipient --fee-payer seller.json --output json \
  | tee /tmp/fee.json
FEE_SIG=$(python3 -c "import json;print(json.load(open('/tmp/fee.json'))['signature'])")

# The prize, from the seller, into escrow.
mplx core asset transfer "$PRIZE_ASSET" "$ESCROW"
# note the signature it prints
ESCROW_SIG=<that signature>
```

Wait for confirmation before publishing — `confirmed` commitment, a second or
two:

```bash
solana confirm -v "$FEE_SIG"
```

## 3. Publish

```bash
curl -s -X POST $API/api/raffles/$SLUG/publish -H 'content-type: application/json' -d "{
  \"escrowSignature\": \"$ESCROW_SIG\",
  \"listingFeeSignature\": \"$FEE_SIG\"
}"
```

**Expect** `200` and `{"slug":"…","status":"open"}`.

**What just got checked, and it is the most important step in this runbook:** the
exact asset, moved from the seller's wallet, into *this deployment's* escrow
wallet, after the draft was created — **and** that escrow still holds it now.
Two questions, not one.

### Negative 3a — deposit and withdraw

**The attack the second question exists for.** A transfer really happened and the
asset is gone.

```bash
# On a SECOND draft with a SECOND asset:
mplx core asset transfer "$PRIZE_ASSET_2" "$ESCROW"
ESCROW_SIG_2=<signature>

# Withdraw it again before publishing.
mplx core asset transfer "$PRIZE_ASSET_2" "$SELLER" -k ./escrow.json

curl -s -X POST $API/api/raffles/$SLUG_2/publish -H 'content-type: application/json' \
  -d "{\"escrowSignature\":\"$ESCROW_SIG_2\",\"listingFeeSignature\":\"$FEE_SIG_2\"}"
```

**Expect** `409` and `reason: "not_in_escrow"`. If this publishes, stop: the
ownership check is not running, and every raffle after it could be for an asset
nobody holds.

### Negative 3b — a deposit that predates the draft

**Not "deposit, then create the draft" — that sequence cannot be run**, and the
reason is another control working: `POST /api/raffles` checks the seller holds
the asset, so once it is in escrow no draft naming it can be created at all. The
executable version quotes an OLD deposit receipt while a NEWER deposit really is
sitting in escrow, which is also the more realistic attack — a seller reusing a
receipt from a previous raffle rather than one from nowhere:

```bash
# 1. Deposit the asset (receipt A), then take it back out.
mplx core asset transfer $ASSET $ESCROW         # note the signature -> RECEIPT_A
mplx config set keypair escrow.json
mplx core asset transfer $ASSET $SELLER
mplx config set keypair seller.json

# 2. More than 120 seconds later (the blocktime skew), create the draft and
#    deposit again for real, so the asset IS in escrow.
curl -s -X POST $API/api/raffles ...            # -> SLUG_3B
mplx core asset transfer $ASSET $ESCROW

# 3. Publish quoting RECEIPT_A rather than the deposit just made.
curl -s -X POST $API/api/raffles/$SLUG_3B/publish -H 'content-type: application/json' \
  -d "{\"listingFeeSignature\":\"$FEE\",\"escrowSignature\":\"$RECEIPT_A\"}"
```

**Expect** `409`, `reason: "predates_draft"`. Getting `not_in_escrow` instead
means step 2's re-deposit did not land, and the check under test never ran —
that is a re-run, not a pass. Without this check, one historical deposit could
publish raffle after raffle.

### Negative 3c — the fee paid by somebody else

Pay the listing fee from `impostor.json`. **Expect** `reason: "wrong_payer"`.
The fee is antibot as much as revenue, and a fee anyone can pay on anyone's
behalf meters nobody.

---

## 4. Buy a ticket

```bash
curl -s -X POST $API/api/raffles/$SLUG/orders -H 'content-type: application/json' \
  -d "{\"quantity\":2,\"payerPubkey\":\"$BUYER\"}" | tee /tmp/order.json
```

**Expect** `201` with `orderId`, `payTo` (= `$PAYMENT`), `amountNative`
(`100000000` = 2 × 0.05 SOL in lamports), `amountDisplay` (`0.10`),
`nativeSymbol` (`SOL`), `reference` (a base58 pubkey), `expiresAt`.

**Watch:** `reference` is present because this is Solana. On Robinhood Chain it
would be `null`, and the column is nullable for that reason.

```bash
ORDER=$(python3 -c "import json;print(json.load(open('/tmp/order.json'))['orderId'])")

solana transfer --from buyer.json "$PAYMENT" 0.10 \
  --allow-unfunded-recipient --fee-payer buyer.json --output json | tee /tmp/pay.json
PAY_SIG=$(python3 -c "import json;print(json.load(open('/tmp/pay.json'))['signature'])")
solana confirm -v "$PAY_SIG"

curl -s -X POST $API/api/orders/$ORDER/confirm -H 'content-type: application/json' \
  -d "{\"signature\":\"$PAY_SIG\"}"
```

**Expect** `200` and `{"ticketNumbers":[1,2]}`.

> **The reference is not attached by this runbook.** `solana transfer` cannot add
> an extra read-only account, so the payment carries no reference key — and
> settlement does not need one. The reference exists so a *reconcile* pass can
> find a payment whose payer never returned; matching here is by signature,
> amount, destination, window and payer. Batch C's browser flow does attach it.

### Negative 4a — the wrong wallet pays

Open an order for `$BUYER`, then pay it from `impostor.json`.

**Expect** `409`, `reason: "wrong_payer"`. Then check the payment was **filed**,
not swallowed:

```bash
docker exec nftraffle-pg psql -U nftraffle -d nftraffle \
  -c "SELECT signature, sender_pubkey, received_native, reason FROM unmatched_payments;"
```

Real money reached the wallet and there is a row for it. That is the difference
between a refusal and a loss.

### Negative 4b — a reused signature

POST the same `$PAY_SIG` against a second order.

**Expect** `409`, `reason: "signature_reused"`. One signature claims one thing,
enforced by a primary key rather than by a check somebody remembers.

### Negative 4c — an expired window

Open an order and wait past `expiresAt` (30 minutes), or age it directly:

```bash
docker exec nftraffle-pg psql -U nftraffle -d nftraffle -c \
  "UPDATE ticket_orders SET created_at = now() - interval '2 hours',
     expires_at = now() - interval '1 minute' WHERE id = '$ORDER';"
```

**Expect** `409`, `reason: "expired"`. Both timestamps move: the schema enforces
`expires_at > created_at`, so pulling the expiry back alone is refused by
Postgres — which is the constraint doing its job.

### Negative 4d — a transfer that predates the order

Send the SOL first, open the order second, then confirm. **Expect**
`reason: "outside_window"`. Without it, any unspent historical transfer to the
payment wallet is claimable by whoever quotes it first.

> **LEAVE MORE THAN 120 SECONDS BETWEEN THE TRANSFER AND THE ORDER**, measured
> against the wall clock rather than against how long the commands felt. The
> window check allows `SOLANA_BLOCKTIME_SKEW_SECONDS` (120) either side, because
> our clock and the cluster's are not the same clock. A transfer 90 seconds early
> is INSIDE that allowance and settles correctly — that is the skew working, not
> the check failing.
>
> This has now produced a false "the negative did not refuse" twice, in two
> separate rehearsals, both times because the elapsed gap was shorter than it
> looked. Run `date -u` immediately before the transfer and immediately before
> the order, and read the difference. The cheapest way to get the gap is to make
> the transfer early, run the other checks, and come back to it — it does not
> have to be consecutive.

---

## 5. Close and draw

Wait for `endsAt`, then load the raffle page once — this project has no cron, so
**reads drive transitions**:

```bash
curl -s -o /dev/null -w "%{http_code}\n" $API/r/$SLUG
docker exec nftraffle-pg psql -U nftraffle -d nftraffle \
  -c "SELECT slug, status FROM raffles WHERE slug = '$SLUG';"
```

**Expect** `closed`.

The draw is admin-gated:

```bash
curl -s -c /tmp/admin.txt -X POST -d "token=$ADMIN_TOKEN" $API/api/admin/session
RAFFLE_ID=$(docker exec nftraffle-pg psql -U nftraffle -d nftraffle -tAc \
  "SELECT id FROM raffles WHERE slug = '$SLUG'")

curl -s -b /tmp/admin.txt -o /dev/null -w "%{http_code}\n" \
  -X POST $API/api/admin/raffles/$RAFFLE_ID/draw
```

**Expect** `303` to `/admin`.

**If you get `409` "The instant this raffle's draw is anchored to has not passed
yet"**, that is correct behaviour, not a bug: the anchor is ten minutes past the
close by design. Wait it out. **The draw never reaches for an earlier block** —
which instant was published is part of the commitment, and the block that instant
resolves to is the chain's answer, not ours.

Note what does NOT happen here any more: a skipped slot used to produce this same
409 permanently, because the design named one slot and that slot had no block.
"The first block at or after T" is well defined whether or not any particular
slot produced one, so the search steps over the hole.

Then check the public page:

```bash
curl -s $API/r/$SLUG/verify | grep -o "they agree\|THEY DO NOT AGREE"
```

**Expect** `they agree`. The page **recomputes** the winner from the published
inputs rather than displaying the stored one — if those ever disagreed, it would
say so.

### Negative 5c — a draw whose block predates the close is impossible

**THE CHECK THIS WHOLE MECHANISM EXISTS FOR**
(`docs/findings-2026-08-31-draw-margin.md`, `docs/decisions.md` Q14). Under the
old design the draw's block routinely existed while tickets were still on sale,
which let anyone who read its hash compute the winning ticket and then buy
exactly that ticket.

The application refuses it (`checkDrawAnchor`) and the search cannot produce it.
Both are code. This checks the layer underneath, which is the one a bug cannot
route around:

```bash
# 1. The database will not store a draw anchored to a block from during the sale.
docker exec nftraffle-pg psql -U nftraffle -d nftraffle -c \
  "UPDATE raffles SET draw_block_time = ends_at - interval '1 minute' WHERE slug = '$SLUG';"

# 2. And an anchor cannot be placed before the close in the first place.
docker exec nftraffle-pg psql -U nftraffle -d nftraffle -c \
  "UPDATE raffles SET draw_at = ends_at - interval '1 minute' WHERE slug = '$SLUG';"
```

**Expect both to FAIL**, naming `raffles_anchor_block_after_close` and
`raffles_anchor_after_close`. A success on either is a stop — it means the
constraint is missing from this database, and the only thing standing between a
raffle and a knowable-early draw is application code.

Confirm the seed was not published early:

```bash
# Before the draw, on an open raffle:
curl -s $API/r/$OTHER_SLUG/verify | grep -c "not revealed"   # expect 1
```

---

## 6. Pay out

```bash
docker exec nftraffle-pg psql -U nftraffle -d nftraffle -c \
  "SELECT winner_wallet, winning_ticket FROM raffles WHERE slug = '$SLUG';"
```

Compute the split: gross = tickets × price; house = gross × bps / 10000, rounded
**down**; seller net = gross − house.

```bash
# Prize, out of escrow, to the winner.
mplx core asset transfer "$PRIZE_ASSET" "<WINNER>" -k ./escrow.json
PRIZE_SIG=<signature>

# Proceeds, to the seller.
solana transfer --from escrow.json "$SELLER" <SELLER_NET> \
  --allow-unfunded-recipient --fee-payer escrow.json --output json
PROCEEDS_SIG=<signature>

curl -s -b /tmp/admin.txt -o /dev/null -w "%{http_code}\n" \
  -X POST $API/api/admin/raffles/$RAFFLE_ID/paid \
  -F "prizeSignature=$PRIZE_SIG" -F "proceedsSignature=$PROCEEDS_SIG"
```

**Expect** `303`. The mark is `multipart/form-data`, not JSON — it is posted by a
plain HTML form on `/admin`.

**What just got checked:** the exact prize mint moved *out of escrow* to *the
winner*, and the seller's net reached *the seller*. An operator's word is not
evidence — the public page shows this mark to the person who did not send it.

### Negative 6a — the prize sent to the wrong wallet

Send it to `$IMPOSTOR` and mark paid. **Expect** `409`,
`reason: "prize_wrong_recipient"`. This is the failure the whole module exists
for: a page telling the real winner they were paid.

### Negative 6b — the seller underpaid

Send less than the net. **Expect** `reason: "insufficient_amount"`.

---

## 7. What "green" means

The rehearsal passes when all of these hold:

| # | Check | Expected |
|---|---|---|
| 1 | Draft created, seed **not** in the response | `201`, `seedHash` only |
| 2 | Publish with a real deposit | `200`, `open` |
| 3a | Deposit-and-withdraw | `not_in_escrow` |
| 3b | Deposit predating the draft | `predates_draft` |
| 3c | Fee from another wallet | `wrong_payer` |
| 4 | Ticket bought | `ticketNumbers` allocated from 1 |
| 4a | Payment from another wallet | `wrong_payer` **and** a row in `unmatched_payments` |
| 4b | Reused signature | `signature_reused`, no second ticket |
| 4c | Expired order | `expired` |
| 4d | Transfer predating the order | `outside_window` |
| 5 | Draw against the anchored instant | `/verify` says **they agree** |
| 5b | Seed hidden before the draw | `/verify` says **not revealed** |
| 5c | A draw anchored before the close | **refused** by `raffles_anchor_block_after_close` and `raffles_anchor_after_close` |
| 6 | Payout with both legs | `303`, page shows both signatures |
| 6a | Prize to the wrong wallet | `prize_wrong_recipient` |
| 6b | Seller underpaid | `insufficient_amount` |

**Any negative that does NOT refuse is a stop.** The positives failing costs a
rehearsal; a negative passing means the same code would accept it with real
money.

## 8. Afterwards

```bash
rm .env.local && git checkout .env.local 2>/dev/null || true
docker exec nftraffle-pg psql -U nftraffle -d nftraffle -c \
  "TRUNCATE raffles, ticket_orders, tickets, consumed_signatures, unmatched_payments CASCADE;"
```

Keep the devnet keypairs — the next rehearsal reuses them. **They are devnet
keys and must never appear in any production configuration.**
