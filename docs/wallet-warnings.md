# Phantom's three warnings, and which of them is our fault

**A wallet warning is a message about US, shown to somebody who is about to pay
us.** They do not read it as a technical detail; they read it as "this site
might steal from me", and most of them are right to stop. So each of the three
gets diagnosed before anything is changed, because the fix for one makes the
others worse if applied to the wrong one.

**The rule this whole file exists to enforce: we never hand a wallet a
transaction that fails simulation.** Not because such a transaction is
dangerous — it costs the payer a fee and settles as a failure — but because
doing it routinely trains our own users to click through the red screen that
protects them.

---

## 1. "This app is new" / unrecognised domain

**What it is.** Phantom shows an unfamiliar-site notice for domains it has not
seen before. It is about the DOMAIN'S AGE AND TRAFFIC, and nothing about the
transaction.

**What to do: wait a week, then apply.** Phantom's own guidance is that new
domains stop being flagged once they have some history. Only after that week
does the review form at `docs.phantom.com` make sense — a submission for a
domain with no traffic is a submission with nothing to review.

**What NOT to do.** Do not change the transaction, and do not go looking for a
code fix. This warning is not about the code, and "fixing" it by changing the
payment path means changing something that works in response to something
unrelated.

**Applies to this project as soon as a domain is bought** — the name is still a
placeholder (`DESIGN.md` §11), so the clock has not started.

---

## 2. "This transaction may be malicious" / red interstitial

**THIS ONE IS USUALLY OURS.** It is what Phantom shows when its own simulation
of the transaction fails. It is not a reputation signal, and the resemblance to
one is exactly what makes it dangerous: an operator who reads it as a domain
problem goes off to fill in a review form while a real bug sits in the payment
path.

**Diagnose in this order, and do not skip to the second:**

1. **The transaction fails simulation.** Almost always. Most often the payer
   cannot cover the amount plus the fee; sometimes the blockhash has expired;
   sometimes an account is wrong. **This is what `preflightPayment` exists to
   catch before Phantom ever sees it.**
2. **Only then** consider domain reputation, and treat it as warning 1.

**How this product prevents it.** `POST /api/raffles/[slug]/orders` builds the
transaction server-side and, before returning it:

- reads the payer's balance and checks it covers **amount + fee**, with the fee
  from `getFeeForMessage` and a 5,000-lamport fallback;
- runs `simulateTransaction` with **`sigVerify: false`** — the transaction is
  unsigned at that point, which is the whole point of simulating before the
  wallet sees it — and `replaceRecentBlockhash: true`, so a slightly stale
  blockhash is not reported as a bad payment.

If either fails, **the response carries no `transaction` field**, so the panel
has nothing to sign and the wallet is never opened. The person is shown one
sentence: *"You need 0.03 more SOL for this — the ticket plus the network fee."*

**A preflight that cannot tell must refuse, not pass.** An unreadable
simulation response is `rpc_unavailable`, never a green light — a confident
green light is precisely what sends somebody into the red screen.

---

## 3. "This transaction is only valid on mainnet"

**The user is in testnet mode.** Phantom has a developer setting that points the
wallet at devnet or testnet; a transaction built for mainnet then looks invalid
to it.

**It is a setting on their side, and the fix is to say so** rather than to
change anything. Phantom → Settings → Developer Settings → turn testnet mode
off.

**The mirror image is ours and is worse**, so this product refuses it in code: a
deployment pointed at devnet showing a mainnet-looking page. `paymentSafety` in
`chain/solana/cluster.ts` blocks signing when the cluster is unknown, when the
wallet and our proxy disagree, and when a production deployment is not on
mainnet. A payer who cannot pay will ask; a payer who paid on the wrong chain
will not know to.

---

## The rehearsal, set up and ready to run

**Everything is prepared. Three steps, about ten minutes, devnet only — no
mainnet money at any point.**

This is the only outstanding item on `docs/first-raffle.md` that could still find
a BUG rather than needing a decision, which is why it is worth doing first.

**The whole thing in three lines**, for somebody who does not want to read the
four sections under it:

1. **Open** `http://localhost:3101/r/dmxxxgb4-mti7361j` after
   `cp .env.rehearsal .env.local && npm run build && npm start`. The page must
   say *"Devnet. This deployment settles on Solana devnet."* — if it does not,
   stop before connecting anything.
2. **Sign one ticket, 0.05 SOL**, from a Phantom in Testnet Mode → Solana Devnet.
   Before approving: one signature and it is yours, the amount is 0.05 SOL,
   Phantom says Devnet, and **there is no red "may be malicious" screen**.
3. **Switch to a Phantom account with no SOL and try again.** The page must
   refuse by itself — *"You need 0.050005 more SOL for this — the ticket plus the
   network fee."* — and **Phantom must never open**. Step 3 is the one that tests
   something; steps 1 and 2 only tell you the happy path still works.

### Step 0 — start the server (one command)

```bash
cd ~/proyectos/nftraffle
cp .env.rehearsal .env.local && npm run build && npm start
```

Then open **http://localhost:3101/r/dmxxxgb4-mti7361j** — *Concentric No. 3*,
0.05 SOL a ticket, 20 tickets, open until **2026-09-15**. A real devnet raffle
with a real prize in escrow, listed 2026-09-01 for this.

The page must say **"Devnet. This deployment settles on Solana devnet."** If it
does not, `.env.local` is not the rehearsal environment and the server is pointed
somewhere else — stop before connecting a wallet.

### Step 1 — put Phantom in testnet mode and fund it

Phantom → Settings → **Developer Settings** → **Testnet Mode** on → **Solana
Devnet**.

```bash
solana airdrop 1 <your Phantom address> --url devnet
```

**If the faucet answers 429** it is rate-limiting this IP, which it does often.
The fallback works every time, from the durable devnet seller wallet:

```bash
solana transfer <your Phantom address> 0.2 \
  --keypair ~/.config/solana/nftraffle-devnet/seller.json \
  --url devnet --allow-unfunded-recipient
```

Confirm: `solana balance <your Phantom address> --url devnet`.

### Step 2 — buy one ticket, and WATCH THE PROMPT

Connect Phantom on that page and buy 1 ticket. When Phantom opens, check four
things **before** approving — this is the whole point of the exercise:

1. **One signature, yours.** A second signer means something is wrong. Nothing
   this server builds asks for one, and the Solana Pay reference is attached
   read-only precisely so it cannot.
2. **The amount is 0.05 SOL**, matching the page.
3. **No red "this transaction may be malicious" screen.** If one appears, the
   preflight did not do its job — that is a bug, and §2 above is how to diagnose
   it. Do not approve; report it.
4. **Phantom says Devnet**, agreeing with the page.

Approve, and the page shows your ticket number.

### Step 3 — the step people skip: try it with too little SOL

**This is the one that actually tests the preflight**, and it is why this
document exists.

In Phantom, switch to a **second account with no devnet SOL** (account picker →
Add account). Reconnect on the raffle page and try to buy a ticket.

**Expected: the page refuses on its own and Phantom never opens.** The sentence
is exact:

> You need 0.050005 more SOL for this — the ticket plus the network fee.

**If Phantom opens at all, the preflight is not running — that is the bug this
step exists to find.** A wallet showing a warning is not the failure; us handing
it a transaction that cannot succeed is.

*Both branches were verified through the route on 2026-09-01 against this exact
raffle (the table below), but neither has been seen with a wallet actually open.
That is the part only a person with Phantom can do.*

## The creator's upload, in three lines

**The second thing only a person with a wallet can check**, and the newer one:
`/launch` now uploads the art to Irys from the browser, signed and paid for by
the creator. Devnet only, about five minutes.

1. **Open** `http://localhost:3101/launch` with `.env.rehearsal` loaded, connect
   Phantom in Testnet Mode → Solana Devnet, and choose an image **over 100 KB** —
   under that Irys takes the upload without a deposit and the interesting prompt
   never appears.
2. **Watch the deposit prompt.** It is an ordinary SOL transfer of a few
   thousand lamports to Irys, and it must look like one: one signature, a
   visible amount, Phantom saying Devnet, **no red "may be malicious" screen**.
   If a red screen appears, the preflight rule has been broken by a path that
   does not go through our own builder — report it rather than approving.
3. **Then watch the two message prompts, because they are the ugly ones.** Irys
   signs each upload as a data item, and what Phantom renders is **opaque
   bytes, not a sentence** — unlike every other message this product asks for
   (`lib/wallet/solana-binding.ts` builds those to be read). Nothing is being
   approved and no funds move, but a person who has been warned about wallet
   drainers is right to hesitate at it. **What to decide after seeing it:**
   whether that prompt is acceptable as the price of the creator keeping custody
   of their own art, or whether the upload belongs somewhere else.

*Verified without a wallet on 2026-09-02 — `npm run e2e:irys` drives the same
module with a keypair standing in for Phantom, uploads a real 322 KB image to
devnet through this deployment's own RPC proxy, and reads it back from the
gateway. What that cannot show is the three prompts above.*

## Before any change to the money path: rehearse with a real wallet

**A green suite does not tell you what a wallet does.** Every test in this
repository drives our own code; none of them opens Phantom, and Phantom's
simulation is the thing under discussion.

So, before merging anything that touches how a payment transaction is built,
quoted, or handed to a wallet:

1. **Run the devnet rehearsal** (`docs/devnet-rehearsal.md`) end to end. It
   catches the server-side half.
2. **Then buy one ticket through the browser panel, with a real wallet**, on a
   devnet deployment. Watch what the wallet shows:
   - the signing prompt lists **one signature**, the payer's;
   - the amount matches the quote on the page;
   - there is **no red interstitial**;
   - the network named in the prompt is the network the page says it is on.
3. **Then deliberately break it once**: try the same purchase from a wallet with
   too little SOL. You should be stopped by our sentence, on our page, **before
   Phantom opens at all**. If Phantom opens, the preflight is not running and
   that is the bug — not the wallet's warning.

Step 3 is the one people skip, and it is the only one that tests the thing this
document is about.

### Verified on devnet, 2026-08-31

The three branches, run against the real chain through the real route:

| Payer | Order | Result |
|---|---|---|
| 0.20095 SOL | 1 ticket (0.05) | `201` with a `transaction` and `feeLamports: 5000` |
| never funded | 1 ticket (0.05) | `409` — *"You need 0.050005 more SOL…"*, **no** `transaction` |
| 0.20095 SOL | 5 tickets (0.25) | `409` — *"You need 0.049055 more SOL…"*, **no** `transaction` |

The middle row is the one that matters: the refusal names the shortfall to the
lamport, and the response carries no transaction, so the panel has nothing to
open a wallet with.

**Still NOT verified: what Phantom itself shows.** No wallet was opened in this
run — it was `curl` against the route. Step 2 and step 3 above remain outstanding
and are the owner's to run, because they need a browser and a real wallet.

**Record what you saw in the batch's close.** "The suite is green" is not
evidence about a wallet; "I bought a ticket with Phantom on devnet and saw one
signature and no warning" is.
