# The launchpad, end to end on devnet — 2026-09-02

Launch a collection, mint from it twice, and try to mint without paying the
platform. Every claim below is a command's output.

**Environment:** the production build against `.env.rehearsal` — the Neon
**preview** branch and devnet, with the durable devnet keypairs. Run it with:

```bash
cp .env.rehearsal .env.local && npm run build && npm start
npm run rehearse:launch
```

---

## What the flow is

Two server calls and two wallet prompts, plus one check that costs nothing and
decides everything:

1. `POST /api/collections` — a signed message names the metadata; the server
   returns **one** transaction that pays the launch fee, creates the Core
   collection, and creates the candy machine with `solPayment`, `solFixedFee`,
   `startDate`, `mintLimit` and `botTax`.
2. `POST /api/collections/[slug]/publish` — verifies the fee on chain and
   **reads the deployed machine back** (spec §5.3 step 4). A machine whose
   `solFixedFee` is missing, redirected, or smaller than this collection was
   quoted at does not go live.
3. `POST /api/collections/[slug]/mint` — builds and simulates one mint.

## The run

| # | Check | Result |
|---|---|---|
| 1 | Launch, one transaction | **PASS** — `201`, confirmed |
| 1a | The launch fee, read off the chain | **PASS** — `+0.1 SOL` to the payment wallet |
| 1b | Publish, with the guard read back | **PASS** — `200`, `status: "live"` |
| 2 | First mint (creator) | **PASS** — `+0.0015 SOL` to the platform |
| 2a | Second mint, a different wallet | **PASS** — `-0.0555` from the minter, `+0.05` to the creator, `+0.0015` to the platform |
| 3 | **Negative:** mint with the fee sent elsewhere | **REFUSED** — nothing minted, platform paid nothing, wallet paid the bot tax |

```
== 2. second mint (3kagRPBQ…) ==
where the money went: {"3kagRPBQ…":-0.055554054,"F7FfSamt…":0.05,"6eyg2zya…":0.0015, …}

== 3. NEGATIVE: mint with the platform fee sent somewhere else ==
confirmed on chain: yes (botTax returns Ok)
items redeemed: 2 -> 2
reached the platform wallet: 0
balance changes: {"3kagRPBQ…":-0.00101,"9LtdgyHrRo9…":0.001}
```

**That last block is the whole claim of spec §0.1**: the fee is charged by the
program, not by our client, so a minter who assembles their own transaction
cannot keep it.

## What the run found

**1. A REFUSED MINT IS A SUCCESSFUL TRANSACTION.** `botTax` intercepts a failed
guard, takes its tax, and returns `Ok` — so the transaction confirms with
`err: null`. The first version of this rehearsal read the transaction status,
saw success, and printed *"STOP. The mint went through without paying this
platform."* The logs said otherwise:

```
AnchorError { error_name: "PublicKeyMismatch", error_code_number: 6002 … }
Candy Guard Botting is taxed at 1000000 lamports
```

Nothing had been minted and we had been paid nothing. The check now reads the
three things a real mint would have changed — the redeemed counter, the
platform's balance, and the program's log — instead of the transaction's status.
**A guard that works and a guard that does not look identical at the status
level**, which is exactly the kind of instrument this project's GATES file
exists to refuse.

**2. `TransferV1`-style trust does not transfer to the read-back.** The first
`readDeployedLaunch` right after creation returned `null`: an account created
seconds ago is not always visible to the next RPC call. "Not there yet" and "not
there" needed telling apart, so publish retries four times over six seconds
before refusing. Without that, a creator's launch would fail on the timing of
their own network.

**3. The rehearsal was answered by a different project's server.** A run against
port 3100 got `404`s from `pixelwar.fun`, which had taken the port after an
earlier call in the same session had been answered correctly by this project.
The script now asks `GET /launch` for a sentence only this application serves and
refuses to start otherwise. A rehearsal that does not check which server is
answering is a rehearsal of somebody else's application.

**4. Two versions of `@noble/hashes` cannot coexist here, and the fix was ours.**
`mpl-core` peer-depends on `@noble/hashes@^1`; this project was on `^2` for its
own signing code, and `@noble/curves@2` requires it. `--legacy-peer-deps` made
`npm install` succeed and then failed at runtime — `Package subpath './sha3' is
not defined` — because the metaplex client resolved our v2. Nested `overrides`
do not apply to unmet peers. The root cause was our own pin: `@solana/kit` needs
neither library, and `@solana/web3.js` carries its own. Moving this project to
`@noble/curves@1` and `@noble/hashes@1` removed the conflict entirely, and
`npm install` needs no flags. `evm-binding.ts` and the Robinhood rehearsal script
changed with it; the 55 wallet tests, including the one anchored on OpenSSL and
the one that shells out to `cast`, pass unchanged in what they assert.

## What this did NOT cover

**The wallet leg, again.** Every signature here came from a keypair file. Nothing
says what Phantom shows when it is handed the launch transaction — which is
larger and stranger than a transfer: it creates two accounts and carries two
signatures the wallet did not make. `docs/wallet-warnings.md`'s ten-minute check
now has a second page to visit.

**The browser upload to Irys.** The form takes a metadata address rather than
uploading for you. Irys itself was verified on devnet rather than assumed — a
real upload from the creator's keypair, `9hoWXMvFPBYrLiwovEkHrL7d1854fPTHpdqguRQxYQTM`,
served through `gateway.irys.xyz` → `…devnet-1.datasprite-cdn.com`, which the
existing image allowlist already covers — but the in-browser, wallet-signed
version of that upload is not built. `checkLaunchChoices` refuses any metadata
address that is not on a host this site can render, so what the form accepts is
exactly what an Irys upload produces.

**Per-item art.** Every item shares one metadata URI, with an index stamped into
its name (`hiddenSettings`). Config lines would be one more transaction per ten
items — a hundred wallet prompts for a thousand-item launch — and arrow one of
the loop is "instant launch". Noted at the code as a ceiling, not hidden.


---

# The creator's upload to Irys — 2026-09-02

`npm run e2e:irys` drives `src/lib/launch/irys.ts` — **the module the browser
uses** — with a keypair in place of a wallet. The Irys client asks a wallet for
three things (a public key, a message signature, a way to send a transaction),
so `UploadWallet` is that shape and a keypair can play the part. What is
verified is the real path rather than a rehearsal of it.

```
image bytes: 321956
  Connecting to permanent storage…
  Uploading the art…
  Paying the storage network…
image:    https://gateway.irys.xyz/8Cxrmoo5oBK14f1peNuvyUJEsMmAvymEXNQhSVKDKwuv
metadata: https://gateway.irys.xyz/D9LsPpUHENbefF5QRqmk5PygoPhX434EWtgWgwEMPuvd
served: 200 | final host: …devnet-1.datasprite-cdn.com
metadata address passes the launch check: true
OK: uploaded, served, and renderable.
```

## What it found

**1. The Irys client does not fund itself, and small files hide it.** A
one-pixel PNG and a 40 KB image both uploaded on a wallet with nothing
deposited, so the first version of this module had no funding step and looked
finished. A real 322 KB collection image came back `402 error: Not enough
balance for transaction` — which is the size every actual launch would have hit,
at the last step, after the creator had filled in the whole form. The module now
quotes the price, reads the balance and deposits the difference plus a fifth,
**once for both uploads**.

**2. The proxy refused two methods the upload needs, and could not say which.**
`getBalance` and `getFeeForMessage` were not on `/api/rpc`'s whitelist, and the
refusal returned one sentence to the caller and **logged nothing**, so an
operator had a `400` with nothing to act on. The refusal now logs the method
name — to the server, never to the caller, because which methods are allowed is
reconnaissance. Both were then added, each with the reason at the line: they
read one address's lamports and price a message already in hand, and neither
turns the proxy into an indexer.

**3. `getTransaction` was NOT added, and that costs thirty seconds.** The client
confirms its funding transfer with it, waits, prints `didn't finalize after 30
seconds`, and proceeds — Irys credits the balance regardless. Opening
`getTransaction` to any browser would make the proxy a general transaction
lookup on a paid provider, for a progress bar. The deposit happens once per
launch, so the wait does too.

## What it did NOT cover

**The three prompts a creator actually sees.** `docs/wallet-warnings.md` now has
them as a three-line check, and the third one is the one worth an opinion:
**Irys data items are signed as opaque bytes**, so Phantom renders binary rather
than a sentence — unlike every other message this product asks anyone to sign.
Nothing is approved and nothing moves, and it still looks like the thing people
are warned about.

**The pasted-address path stays** until that check has been run: a creator can
skip the upload entirely by pasting a metadata address they already have, and
`checkLaunchChoices` refuses anything a browser could not render either way.
