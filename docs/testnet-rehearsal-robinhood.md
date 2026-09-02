# Robinhood Chain testnet rehearsal — a whole raffle, before any money

The mirror of [`devnet-rehearsal.md`](devnet-rehearsal.md), on the chain that is
now opening first (`docs/decisions.md` Q17). Same shape, same checks, same rule:

**A negative that does not refuse is a STOP.** The positives failing costs an
afternoon. A negative passing means the same code would accept it with real
money, on the chain with the audience.

**This runbook is the gate.** Q17 replaced "one real raffle on Solana" with
"this document passing whole" as the condition for opening the Robinhood
surface. Nothing here opens a mainnet surface — mainnet needs the owner to load
the environment, which is a separate decision they still hold.

---

## What is different from the Solana rehearsal, and why

Read this before assuming a step transfers over.

| | Solana devnet | Robinhood testnet |
|---|---|---|
| Prize | Metaplex Core asset, `mplx` moves it in one line | ERC-721, needs a deployed contract |
| Payment | `solana transfer` | `cast send` (value transfer) |
| Payer binding | none | **`personal_sign` required** — `lib/wallet/evm-binding.ts` |
| Metadata | DAS resolves it | `tokenURI()` then a bounded fetch |
| Network told apart by | endpoint shape (`cluster.ts`) | **asking the node** (`eth_chainId`) |
| Block time | ~317 ms measured | ~101 ms measured, re-measured 2026-08-31 |

The payer binding is the genuinely new surface and it gets four negatives of its
own (§4e–4h). It does not exist on Solana — `docs/decisions.md` Q18 says why,
and says it is a gap rather than a principle.

---

## 0. Prerequisites

**BUDGET ABOUT 45 MINUTES**, the same as devnet: the draw's entropy is anchored
ten minutes past the close and the shortest raffle is 15 minutes, so the floor
is 25 minutes plus setup.

### The RPC and the network

```bash
curl -s -X POST https://rpc.testnet.chain.robinhood.com \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
```

**Expect** `0xb626` — 46630, the testnet. Mainnet answers `0x1237` (4663). If it
answers anything else, stop: the server classifies from this call and refuses to
request a signature when the answer is neither.

### Foundry

```bash
cast --version
```

`cast` is this runbook's `solana` CLI. Everything below uses it or `curl`.
Installation is a machine prerequisite — see `docs/deploy.md`.

**Every `cast` invocation in this document was verified on 2026-09-01** against
Foundry 1.8.1 and the live testnet, without writing to any chain. `cast estimate`
was used to check the shape of the two `cast send` forms: it runs the same call
against a node and returns gas or the revert, so a wrong ABI signature or a bad
flag fails there rather than after a transaction is broadcast.

| Invocation | How it was verified | Result |
|---|---|---|
| `cast wallet new` | run | keypair produced |
| `cast wallet sign --private-key $K "<msg>"` | run, then the signature verified by our own `verifyPayerBinding` | **accepted, correct address recovered** |
| `cast call <c> "ownerOf(uint256)(address)" <id>` | run against testnet | returns the holder |
| `cast block <n>` | run against testnet | number, hash, timestamp |
| `cast send <to> --value <x>ether` | shape checked with `cast estimate` | gas returned; from an empty wallet, `insufficient funds for gas * price + value` |
| `cast send <c> "transferFrom(address,address,uint256)" …` | shape checked with `cast estimate` on four contracts | gas returned on all four |
| `--json` on `cast send` | flag present | the runner parses `transactionHash` from it |

**The signing line is the one that mattered.** `cast wallet sign` and our
`lib/wallet/evm-binding.ts` are two independent EIP-191 implementations, and
until this they had never been compared — the binding's tests anchored keccak and
the address derivation against published constants, but nothing outside this
repository had ever verified a whole signature. It does now. Both argument orders
work: options before the message, as this document writes it, and message first,
as `cast`'s own examples show.

### The prize must be TRANSFERABLE — check before anything else

```bash
cast estimate <contract> "transferFrom(address,address,uint256)" \
  $SELLER $ESCROW <tokenId> --from $SELLER --rpc-url $RPC
```

**Expect a gas number.** A revert here means the token cannot be moved at all.

This is not hypothetical: the first ERC-721 picked off this testnet's explorer,
`GMCards`, reverts with *"NFT transfer is disabled - GMCards are
non-transferable"*. It is soulbound, and a raffle for it could never pay out.

**The product is already safe from this** — a soulbound token cannot reach escrow,
so publishing fails and no ticket is ever sold — but the failure arrives after
the listing fee has been sent, and it reads as a deposit problem rather than as a
property of the token. One estimate beforehand saves that.

### Three wallets, new and exclusive to this project

```bash
cast wallet new    # x3 -> seller, buyer, impostor
```

**Never reuse the Solana devnet keys, and never reuse a wallet from another
project.** A devnet address is a perfectly valid mainnet address; so is a
testnet EVM address. Keep them somewhere the repository cannot reach.

The escrow and payment wallets are the owner's and are configured, not
generated here.

### Testnet ETH

```bash
# The faucet rate-limits per IP; expect to wait if it answers 429.
curl -s https://faucet.testnet.chain.robinhood.com
```

Fund the seller, then distribute with `cast send` — the same pattern the devnet
runbook settled on, and for the same reason: one faucet grant goes further than
three faucet attempts.

### An ERC-721 to raffle

The prize must be a real token the seller owns. Deploy a minimal ERC-721 on
testnet, or use one already deployed that the seller can be given a token from.
Note the `<contract>/<tokenId>` pair — that is exactly the string this product
stores in `raffles.prize_asset`.

**Its `tokenURI` matters to one check** (§1b). A token whose metadata is on
`http://`, on a private host, or behind a redirect is refused by design, and
that is a check rather than a bug.

### Environment

Mirror the preview environment, exactly as the devnet rehearsal does:

```
DATABASE_URL=…                                  # a disposable branch
ROBINHOOD_RPC_URL=https://rpc.testnet.chain.robinhood.com
PAYMENT_WALLET_ROBINHOOD=0x…
ESCROW_WALLET_ROBINHOOD=0x…
RAFFLE_LISTING_FEE_ROBINHOOD=0.001
HOUSE_FEE_BPS_ROBINHOOD=500
LAUNCH_FEE_ROBINHOOD=0.01
MINT_FEE_BPS_ROBINHOOD=300
RATE_LIMIT_SALT=…                               # generated now, not copied
ADMIN_TOKEN=…                                   # generated now, not copied
ALLOW_UNTRUSTED_CLIENT_IP=true                  # local only, never on Vercel
```

**Fill all of the `_ROBINHOOD` block or none.** A half-filled section is the one
dangerous state: an RPC endpoint with no escrow wallet is a deployment that
takes money for a prize it cannot custody. `surfaces.ts` refuses that, and
`.env.example` says so.

```bash
npm run db:migrate:test
cp .env.testnet .env.local && npm run build && npm start
```

> **`.env.local` beats a shell `export`.** Both `next dev` and `next start` read
> it, and an exported variable does NOT override the file. This has produced a
> server quietly talking to the wrong database more than once — see
> `docs/deploy.md`.

Shell variables used below:

```bash
API=http://localhost:3101
SELLER=0x…   BUYER=0x…   IMPOSTOR=0x…
PAYMENT=0x…  ESCROW=0x…
PRIZE=0x<contract>/<tokenId>
RPC=https://rpc.testnet.chain.robinhood.com
```

---

## 1. Create the draft

```bash
curl -s -X POST $API/api/raffles -H 'content-type: application/json' -d "{
  \"chain\": \"robinhood\",
  \"prizeAsset\": \"$PRIZE\",
  \"sellerWallet\": \"$SELLER\",
  \"ticketPrice\": \"0.001\",
  \"maxTickets\": 5,
  \"durationMinutes\": 16
}"
```

**Expect** `201` with `slug`, `chain: "robinhood"`, `seedHash`, `drawAt`,
`endsAt`.

**Check, in this order:**
- `drawAt` is **exactly ten minutes** after `endsAt`. Do the subtraction; it is
  the entire draw commitment.
- There is **no** `drawHeight` and no slot number. A predicted block number is
  the defect `findings-2026-08-31-draw-margin.md` describes, and it is gone.
- `seedHash` is 64 hex characters and **`seed` is absent**. The seed lives in
  `seed_secret` and is published only at the draw.
- `ticketPrice` is a **string**. Eighteen decimals do not survive a double.

### Negative 1a — the seller must hold the token

Repeat with `sellerWallet` set to `$IMPOSTOR`.

**Expect** `409`, `That asset is not held by this wallet.` This reads
`ownerOf(tokenId)` by `eth_call`; a revert (burned or nonexistent token) and an
unreachable node both answer null and both refuse, deliberately.

### Negative 1b — the price ceiling is Robinhood's, not Solana's

```bash
# 0.6 ETH: over Robinhood's 0.5 ceiling, and astronomically over Solana's
# 10-SOL one expressed in the same integer.
… \"ticketPrice\": \"0.6\" …
```

**Expect** `409`/`400` with `price_too_high`. Until 2026-08-31 the two chains
shared one integer, which on this chain was a ceiling no raffle could reach —
i.e. none at all (`docs/decisions.md` Q13).

---

## 2. Pay the listing fee and deposit the prize

```bash
# Listing fee, from the seller, to the payment wallet.
cast send $PAYMENT --value 0.001ether --private-key $SELLER_KEY --rpc-url $RPC

# The prize, from the seller, into escrow.
cast send <contract> "transferFrom(address,address,uint256)" \
  $SELLER $ESCROW <tokenId> --private-key $SELLER_KEY --rpc-url $RPC
```

Note both transaction hashes.

---

## 3. Publish

```bash
curl -s -X POST $API/api/raffles/$SLUG/publish -H 'content-type: application/json' \
  -d "{\"listingFeeSignature\":\"$FEE_TX\",\"escrowSignature\":\"$DEPOSIT_TX\"}"
```

**Expect** `200` and `status: "open"`.

Then confirm the chain agrees, independently of our page:

```bash
cast call <contract> "ownerOf(uint256)(address)" <tokenId> --rpc-url $RPC
```

**Must return the escrow address.** Worth doing by hand once: it is what our
publish path asserts on your behalf.

### Negative 3a — deposit and withdraw

On a second draft with a second token: deposit it, move it back out of escrow,
then publish.

**Expect** `409`, `not_in_escrow`. If this publishes, stop — the ownership check
is not running and every raffle after it could be for an asset nobody holds.

### Negative 3b — a deposit that predates the draft

**Not "deposit, then create the draft"** — that cannot be run, because creating
a draft checks the seller holds the token, and once it is in escrow they do not.
The executable version quotes an OLD receipt while a NEWER deposit really is in
escrow, which is also the more realistic attack:

1. Deposit (receipt A), then move the token back to the seller.
2. More than 120 seconds later (the blocktime skew), create the draft and
   deposit again for real.
3. Publish quoting receipt A.

**Expect** `409`, `predates_draft`. Getting `not_in_escrow` instead means step 2
did not land and the check under test never ran — that is a re-run, not a pass.

### Negative 3c — the fee paid by somebody else

Pay the listing fee from `$IMPOSTOR`. **Expect** `wrong_payer`. The fee is
antibot as much as revenue, and a fee anyone can pay on anyone's behalf meters
nobody.

---

## 4. Buy a ticket

**This is where Robinhood diverges from Solana**: the order will not open
without a signature proving the buyer controls the address it names.

**`<the binding message>` was a placeholder, not a recipe, and this step was
therefore NOT executable as written** — the same defect as 3b, which described a
sequence the create route refuses. The message has to be byte-identical to the
one the server rebuilds, and "build it the same way `payerBindingMessage` does"
is a reading comprehension exercise with a 400 at the end of it.

`scripts/robinhood-rehearsal.mts` imports that exact function and signs with it,
so the message signed is the message verified. Use it rather than hand-rolling:

```bash
npm run rehearse:robinhood -- --check    # prove the ground first
npm run rehearse:robinhood               # runs this step and every other one
```

```bash
curl -s -X POST $API/api/raffles/$SLUG/orders -H 'content-type: application/json' \
  -d "{\"quantity\":2,\"payerPubkey\":\"$BUYER\",\"binding\":{
        \"signature\":\"0x…\",
        \"domain\":\"localhost:3101\",
        \"address\":\"$BUYER\",
        \"slug\":\"$SLUG\",
        \"chainId\":46630,
        \"nonce\":\"a1b2c3d4\",
        \"issuedAt\":\"<ISO 8601, within 5 minutes>\"}}"
```

**Expect** `201` with `orderId`, `payTo`, `amountNative` (in wei),
`amountDisplay`, `nativeSymbol` (`ETH`), `expiresAt`, and **`reference: null`** —
EVM has no payment-reference convention and needs none.

```bash
cast send $PAYMENT --value 0.002ether --private-key $BUYER_KEY --rpc-url $RPC
curl -s -X POST $API/api/orders/$ORDER/confirm -H 'content-type: application/json' \
  -d "{\"signature\":\"$PAY_TX\"}"
```

**Expect** `200` and `{"ticketNumbers":[1,2]}`.

### Negative 4a — the wrong wallet pays

Open an order for `$BUYER`, pay it from `$IMPOSTOR`.

**Expect** `409`, `wrong_payer`. Then check the payment was **filed**, not
swallowed:

```sql
SELECT signature, sender_pubkey, received_native, reason FROM unmatched_payments;
```

Real money reached the wallet and there is a row for it. That is the difference
between a refusal and a loss.

### Negative 4b — a reused transaction hash

POST the same `$PAY_TX` against a second order. **Expect** `signature_reused`.
One transaction claims one thing, enforced by a primary key.

### Negative 4c — an expired window

```sql
UPDATE ticket_orders SET created_at = now() - interval '2 hours',
  expires_at = now() - interval '1 minute' WHERE id = '<order>';
```

**Expect** `expired`. Both timestamps move: the schema enforces
`expires_at > created_at`.

### Negative 4d — a transfer that predates the order

Send the ETH first, open the order second, then confirm. **Expect**
`outside_window`.

> **LEAVE MORE THAN 120 SECONDS**, measured against a clock rather than against
> how long the commands felt. The window allows `ROBINHOOD_BLOCKTIME_SKEW_SECONDS`
> (120) either side. A transfer 90 seconds early is INSIDE that allowance and
> settles correctly — that is the skew working, not the check failing. This has
> produced a false "the negative did not refuse" twice on the Solana runbook.

### Negative 4e — no binding at all

Post an order with `payerPubkey` and no `binding`.

**Expect** `400`, `This chain needs a signature proving you control that wallet.`
This is the whole reason the binding exists: without it, anyone can open an
order in a stranger's name and wait for a transfer of theirs to land in its
window.

### Negative 4f — a binding signed by a different wallet

Sign the message with `$IMPOSTOR_KEY` but claim `address: $BUYER`.

**Expect** `400`, `reason: "address_mismatch"`.

### Negative 4g — a binding for a different raffle

Sign a message naming another slug, then submit it against this one.

**Expect** `400`. The server REBUILDS the message from its own fields and
verifies against that, so a signature for one raffle cannot be read as another.

### Negative 4h — a binding for the wrong chain

Sign with `chainId: 4663` (mainnet) against a testnet deployment.

**Expect** `400`, `reason: "wrong_chain"`. A mainnet signature must not bind a
testnet order, or the reverse.

---

## 5. Close and draw

Wait for `endsAt`, then load the page once — this project has no cron, so
**reads drive transitions**:

```bash
curl -s -o /dev/null $API/r/$SLUG
```

**Expect** `closed` (or immediately on sell-out).

```bash
curl -s -c /tmp/admin.txt -X POST -d "token=$ADMIN_TOKEN" $API/api/admin/session
curl -s -b /tmp/admin.txt -o /dev/null -w "%{http_code}\n" \
  -X POST $API/api/admin/raffles/$RAFFLE_ID/draw
```

**Before `drawAt`, expect `409`** saying the anchored instant has not passed.
That is the mechanism, not a fault. **After it, expect `303`.**

Running the draw LATE changes nothing: the anchor resolves to the same block
whenever it runs, so waiting gives nobody a choice of outcome.

```bash
curl -s $API/r/$SLUG/verify | grep -o "they agree\|THEY DO NOT AGREE"
```

**Expect `they agree`.** The page recomputes from published inputs rather than
displaying the stored winner.

Then check the block yourself, which is the part that trusts nobody:

```bash
cast block <draw_height>   --rpc-url $RPC   # timestamp >= drawAt
cast block <draw_height-1> --rpc-url $RPC   # timestamp <  drawAt
```

The first makes the entropy unknowable during the sale; the second makes it the
only block we could have used.

### Negative 5b — the seed is hidden before the draw

**`$OTHER_SLUG` is the raffle from 3b**, which is still `draft` and therefore
still has an unrevealed seed. Naming it matters: the first version of this line
used a variable nothing had ever set, so the command silently checked
`/r//verify` and a `0` would have read as a failure of the seed rule rather than
of the recipe.

```bash
curl -s $API/r/$SLUG_3B/verify | grep -c "not revealed"   # expect 1
```

### Negative 5c — a draw anchored before the close is impossible

```sql
UPDATE raffles SET draw_block_time = ends_at - interval '1 minute' WHERE slug = '<slug>';
UPDATE raffles SET draw_at         = ends_at - interval '1 minute' WHERE slug = '<slug>';
```

**Expect both to FAIL**, naming `raffles_anchor_block_after_close` and
`raffles_anchor_after_close`. A success on either is a stop: it means the only
thing between a raffle and a knowable-early draw is application code.

---

## 6. Pay out

```bash
# Prize, out of escrow, to the winner.
cast send <contract> "transferFrom(address,address,uint256)" \
  $ESCROW <winner> <tokenId> --private-key $ESCROW_KEY --rpc-url $RPC
# Proceeds, to the seller: gross - house fee.
cast send $SELLER --value <net>ether --private-key $PAYMENT_KEY --rpc-url $RPC
```

Paste both hashes into `/admin`. **Expect `303`.**

A `409` means the chain does not agree with what is being claimed. **That
refusal is the feature** — the public page shows this mark to the person who did
*not* send the transfers.

### Negative 6a — the prize sent to the wrong wallet

Send the prize out of escrow to `$IMPOSTOR` instead of the winner, then try to
mark the raffle paid.

**Expect** `409`, `prize_wrong_recipient`.

**THEN PUT IT BACK, before anything else.** This negative moves a real token to a
wallet that is not the winner's, and the real payout below cannot be made until
it returns:

```bash
cast send <contract> "transferFrom(address,address,uint256)" \
  $IMPOSTOR $ESCROW <tokenId> --private-key $IMPOSTOR_KEY --rpc-url $RPC
```

The first version of this check said only "Expect `prize_wrong_recipient`" and
left the prize with the impostor. That is not a check, it is a trap — and it is
the same class of defect as 3b and 4d: a recipe that cannot be followed to the
end as written.

### Negative 6b — the seller underpaid

**Expect** `insufficient_amount`.

---

## 7. What "green" means

| # | Check | Expected |
|---|---|---|
| 1 | Draft created, `drawAt` = `endsAt`+10min, no slot, no seed | `201` |
| 1a | Seller does not hold the token | refused |
| 1b | Price above Robinhood's own ceiling | `price_too_high` |
| 2 | Publish with a real deposit | `200`, `open` |
| 3a | Deposit-and-withdraw | `not_in_escrow` |
| 3b | Deposit predating the draft | `predates_draft` |
| 3c | Fee from another wallet | `wrong_payer` |
| 4 | Ticket bought with a valid binding | `ticketNumbers` from 1 |
| 4a | Payment from another wallet | `wrong_payer` **and** a row in `unmatched_payments` |
| 4b | Reused transaction hash | `signature_reused` |
| 4c | Expired order | `expired` |
| 4d | Transfer predating the order | `outside_window` |
| 4e | No binding | `400`, binding required |
| 4f | Binding signed by another wallet | `address_mismatch` |
| 4g | Binding for another raffle | refused |
| 4h | Binding for the wrong chain | `wrong_chain` |
| 5 | Draw at the anchored instant | `/verify` says **they agree** |
| 5b | Seed hidden before the draw | **not revealed** |
| 5c | Draw anchored before the close | refused by both constraints |
| 6 | Payout with both legs | `303`, page shows both hashes |
| 6a | Prize to the wrong wallet | `prize_wrong_recipient` |
| 6b | Seller underpaid | `insufficient_amount` |

**Fourteen of these are negatives.** Every one of them must refuse.

## 7a. First run — 2026-08-31

**Status: NOT GREEN. Thirteen checks passed, thirteen are NOT RUN** — and the
thirteen are now runnable with one command the moment the wallets exist:

```bash
npm run rehearse:robinhood -- --check   # what is missing, and nothing written
npm run rehearse:robinhood              # the whole sequence, ~30 minutes
```

The runner refuses before touching any chain if a variable, `cast`, the RPC or
the server is missing, and it names each one. A positive check that fails stops
the run rather than reporting later checks that could not have meant anything.
Its waits are real — 130 seconds before 4d, and the full close-plus-anchor before
the draw — because both of those produced false passes when they were rushed.

**Its four binding negatives were run on 2026-09-01 and pass**, with the control:
they need no gas, so they were the only part of the sequence that could be
verified before the wallets arrive.

**Original status below.**

**Nine checks passed, thirteen are NOT RUN.** The gate in
`docs/decisions.md` Q17 is this document passing WHOLE, so the Robinhood surface
is not through it.

**Why the rest could not run:** no funded testnet wallets. The faucet at
`faucet.testnet.chain.robinhood.com` answers `429` to this address, and every
remaining check needs either gas or an ERC-721 the seller owns. Nothing was
simulated and no result below is inferred — a check that did not run says so.

| # | Check | Result |
|---|---|---|
| 0a | `eth_chainId` through our own proxy | **PASS** — `0xb626` (46630, testnet) |
| 0b | Proxy refuses `eth_getLogs` | **PASS** — 400 |
| 0c | Proxy refuses a Solana method on the EVM chain | **PASS** — 400 |
| 0d | Proxy refuses an unknown chain segment | **PASS** — 404 |
| 0e | No upstream detail is relayed on failure | **PASS** — fixed generic error |
| 1 | Draft created, `drawAt` = `endsAt`+10min, no slot, no seed | **PASS** — against a real token |
| 1a | Seller does not hold the token | **PASS** — 409, and the real holder is accepted |
| 1b | Price above Robinhood's own ceiling | **PASS** — `price_too_high` at 0.6 ETH; 0.4 accepted |
| 4e | No binding | **PASS** — 400 |
| 4f | Binding signed by another wallet | **PASS** — `address_mismatch` |
| 4g | Binding for another raffle | **PASS** — `wrong_slug` |
| 4h | Binding for the wrong chain | **PASS** — `wrong_chain` |
| 5c | Draw anchored before the close | **PASS** — both constraints refuse |
| 2 | Publish with a real deposit | **NOT RUN** — needs gas |
| 3a | Deposit-and-withdraw | **NOT RUN** — needs gas |
| 3b | Deposit predating the draft | **NOT RUN** — needs gas |
| 3c | Fee from another wallet | **NOT RUN** — needs gas |
| 4 | Ticket bought with a valid binding | **NOT RUN** — needs an open raffle |
| 4a | Payment from another wallet | **NOT RUN** — needs gas |
| 4b | Reused transaction hash | **NOT RUN** — needs gas |
| 4c | Expired order | **NOT RUN** — needs an order |
| 4d | Transfer predating the order | **NOT RUN** — needs gas |
| 5 | Draw at the anchored instant | **NOT RUN** — needs a sold raffle |
| 5b | Seed hidden before the draw | **NOT RUN** — needs an open raffle |
| 6 | Payout with both legs | **NOT RUN** — needs gas |
| 6a | Prize to the wrong wallet | **NOT RUN** — needs gas |
| 6b | Seller underpaid | **NOT RUN** — needs gas |

**Controls were run alongside the refusals**, because a check that refuses
everything passes every negative. The real token's real holder WAS accepted
(1a), 0.4 ETH WAS accepted where 0.6 was refused (1b), and a valid binding DID
get past the binding check (4e–4h) — failing afterwards on `not_open`, which is
the correct next refusal for a draft.

### One product bug this run found

**`data:` token URIs were refused, so fully on-chain NFTs had no metadata at
all.** `tokenURI` on a real Robinhood testnet ERC-721 returns
`data:application/json;base64,…` several kilobytes long. The fetch layer applied
a 2,048-character cap — a bound written for a URL, i.e. for an ADDRESS — to what
is actually the DOCUMENT, and refused every one as `bad_uri`. No unit test saw
it, because every fixture was an https URL: that is what a URI looks like when
you are imagining one instead of reading one.

Fixed at the root: data URIs are decoded directly, bounded on their decoded
payload by the same limit a fetched document gets, and never sent to the
network. An inline `data:image/…` is dropped rather than truncated into a
corrupt URI. Both are on `main`.

## 8. Afterwards

```bash
rm .env.local && git checkout .env.local 2>/dev/null || true
```

Truncate the rehearsal tables. Keep the testnet keys for the next run; **they
are testnet keys and must never appear in any production configuration** — a
testnet EVM address is a perfectly valid mainnet address, which is what makes
the mistake unrecoverable rather than merely embarrassing.
