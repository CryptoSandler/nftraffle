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

---

## 0. Prerequisites

```bash
solana --version          # 1.18.26 or later
npm i -g @metaplex-foundation/cli   # provides `mplx`, for the Core asset
mplx --version
```

You need a **Helius devnet key with DAS**. The public devnet endpoint does not
serve `getAsset`, and this project has no RPC default, so without it every step
below refuses rather than guesses.

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
  solana airdrop 2 "$(solana-keygen pubkey $k.json)" || \
    echo "airdrop rate-limited — try https://faucet.solana.com"
done
```

Devnet airdrops are rate-limited. If they fail, the web faucet works.

### Mint a Core asset for the seller to raffle

Metaplex Core, because DAS indexes it and it is the cheapest thing to create
that `getAsset` will answer about.

```bash
mplx config set rpc <YOUR_HELIUS_DEVNET_URL>
mplx config set keypair ~/.config/solana/nftraffle-devnet/seller.json

mplx core collection create --name "Rehearsal" --uri "https://example.com/c.json"
# note the collection address

mplx core asset create \
  --name "Rehearsal Prize #1" \
  --uri "https://example.com/1.json" \
  --collection <COLLECTION_ADDRESS>
# note the ASSET address — this is PRIZE_ASSET below
```

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
npm run db:up
cp .env.devnet .env.local && npm run dev
```

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

```bash
curl -s -X POST $API/api/raffles -H 'content-type: application/json' -d "{
  \"chain\": \"solana\",
  \"prizeAsset\": \"$PRIZE_ASSET\",
  \"sellerWallet\": \"$SELLER\",
  \"ticketPrice\": \"0.05\",
  \"maxTickets\": 5,
  \"durationMinutes\": 20
}" | tee /tmp/draft.json
```

**Expect** `201` and a body with `slug`, `chain: "solana"`, `seedHash`,
`drawHeight`, `endsAt`.

**Watch for:**
- `ticketPrice` is a **string**, not a number. Eighteen decimals do not survive a
  double, so the parser is a decimal-string parser on both chains.
- `seedHash` is 64 hex characters. The seed itself is **not** in the response and
  must not be — it is in `seed_secret` and is published only at the draw.
- `drawHeight` is roughly `currentSlot + 9000 × (duration + 1h in hours)`. It is
  a slot that does not exist yet.

```bash
SLUG=$(python3 -c "import json;print(json.load(open('/tmp/draft.json'))['slug'])")
```

**Negative — the seller must hold the asset.** With `sellerWallet` set to
`$IMPOSTOR`, expect `409` and `That asset is not held by this wallet.`

---

## 2. Pay the listing fee and deposit the prize

```bash
# Listing fee, from the seller, to the payment wallet.
solana transfer --from seller.json "$PAYMENT" 0.01 \
  --allow-unfunded-recipient --fee-payer seller.json --output json \
  | tee /tmp/fee.json
FEE_SIG=$(python3 -c "import json;print(json.load(open('/tmp/fee.json'))['signature'])")

# The prize, from the seller, into escrow.
mplx core asset transfer --asset "$PRIZE_ASSET" --recipient "$ESCROW"
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
mplx core asset transfer --asset "$PRIZE_ASSET_2" --recipient "$ESCROW"
ESCROW_SIG_2=<signature>

# Withdraw it again before publishing.
mplx config set keypair ./escrow.json
mplx core asset transfer --asset "$PRIZE_ASSET_2" --recipient "$SELLER"
mplx config set keypair ./seller.json

curl -s -X POST $API/api/raffles/$SLUG_2/publish -H 'content-type: application/json' \
  -d "{\"escrowSignature\":\"$ESCROW_SIG_2\",\"listingFeeSignature\":\"$FEE_SIG_2\"}"
```

**Expect** `409` and `reason: "not_in_escrow"`. If this publishes, stop: the
ownership check is not running, and every raffle after it could be for an asset
nobody holds.

### Negative 3b — a deposit that predates the draft

Deposit first, create the draft second, then publish. **Expect**
`reason: "predates_draft"`. Without this, one historical deposit could publish
raffle after raffle.

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

**If you get `409` "The announced block has not arrived yet"**, that is correct
behaviour, not a bug: the announced slot is an hour past the close by design. On
devnet you can wait, or create the next rehearsal raffle with a short duration so
the announced slot lands sooner. **The draw never substitutes a different slot** —
which slot was announced is part of what was published.

Then check the public page:

```bash
curl -s $API/r/$SLUG/verify | grep -o "they agree\|THEY DO NOT AGREE"
```

**Expect** `they agree`. The page **recomputes** the winner from the published
inputs rather than displaying the stored one — if those ever disagreed, it would
say so.

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
mplx config set keypair ./escrow.json
mplx core asset transfer --asset "$PRIZE_ASSET" --recipient "<WINNER>"
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
| 5 | Draw against the announced slot | `/verify` says **they agree** |
| 5b | Seed hidden before the draw | `/verify` says **not revealed** |
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
