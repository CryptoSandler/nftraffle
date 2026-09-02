# The listing form, end to end on devnet — 2026-09-01

What was run, what it proved, and the two things it did NOT cover. Every claim
below is a command's output, not a reading of the code.

**Environment:** the production build (`npm run build && npm start`) against
`.env.rehearsal` — the same Neon **preview** branch and the same devnet RPC the
Vercel preview uses. Wallets are the durable devnet rehearsal keypairs.

---

## What the flow is now

Three server calls, two wallet prompts:

1. `POST /api/raffles` with a `solana:signMessage` binding. Opens the draft.
2. `POST /api/raffles/[slug]/deposit` returns **one** transaction carrying the
   listing fee and the prize. Built and simulated server-side; a transaction
   that fails simulation is not returned at all.
3. `POST /api/raffles/[slug]/publish` with that signature for both legs.

## The run

| # | Check | Result |
|---|---|---|
| 1 | Draft with a signed binding | **PASS** — `201`, `slug`, `seedHash`, `drawAt` ten minutes after `endsAt` |
| 1a | **Negative:** binding signed by another wallet | **REFUSED** — `400 address_mismatch` |
| 1b | **Negative:** a burnt asset | **REFUSED** — `409 burnt` (against a really burnt devnet asset) |
| 2 | Deposit transaction returned | **PASS** — 436 base64 characters, one transaction |
| 3 | Signed with the seller keypair and sent | **PASS** — confirmed, `err: null` |
| 4 | Publish | **PASS** — `200`, `status: "open"` |
| 4a | **Negative:** deposit again once open | **REFUSED** — `409` |
| 5 | The public page as a stranger | **PASS** — `200`, renders as open |
| 6 | Same flow for an asset **inside a collection** | **PASS** — settled and published |

**Read off the chain afterwards, not from our own page:**

```
prize owner now: FbXES1esmvNemD7ia9VBxiwqqHc7aPjmAaiFZ9FTgRjT   (the escrow wallet)
F7FfSamtLjDwEx4cpHDV6EqtYjXf8HMDyiF98FbNogXE: -0.010005000 SOL   (seller: fee + network fee)
6eyg2zyaHX4FXGJLD1nsnmmjexH9vif2veyXt1MbNpYa: +0.010000000 SOL   (payment wallet: exactly the fee)
instructions: 2
```

**Two instructions, one transaction.** That is the atomicity claim, verified
rather than asserted: there is no chain state where the fee was paid and the
prize was not sent.

Raffles left open on the preview deployment (devnet, deliberate — they are also
material for the Phantom check): `g2awzyzc-mtjh7zxf`, `biv9rlxd-mtjhhuq1`,
`ft1j2z6l-mtjhix0e`.

## What the run found

**1. `TransferV1`'s account layout was guessed wrong in one slot, and the guess
was corrected against a real transaction rather than against a document.** The
first build passed the real System Program in slot 5. A transfer that `mplx`
itself had made on devnet — signature `pQJFwPCgEHaFP4ts…`, the rehearsal prize
going into escrow — carries the Core program id there instead. Core accepts
both; matching what the standard client emits is what keeps our transactions
readable by the same indexers everyone else's are. Pinned by a test.

The discriminator itself was right: `data` on that same real transfer is `24o`,
which is base58 for `[14, 0]` — variant 14, `Option::None`. The program's own log
line reads `Instruction: Transfer`.

**2. A burnt asset could be listed.** DAS keeps answering `ownership.owner` for a
burnt Metaplex Core asset, so the ownership check accepted one. The first
attempt at this whole run listed a burnt asset without noticing, and only failed
at step 2, where the transfer failed simulation with Core's `IncorrectAccount` —
by which point the draft had taken that asset's listing slot.

The failure that exposed it looked exactly like a bug in our own encoding, and
was diagnosed only by a control: **every asset the devnet seller held was
burnt** — the previous rehearsal burned them at the end. Minting a fresh one
made the same code pass on the first try.

Now refused at the draft, with `That asset has been burned, so it cannot be
raffled.`

**3. The preview database had not been migrated.** `listing_attempts` did not
exist there and the first request answered `500`. `npm run db:migrate:preview`
fixed it. Worth naming because the same gap would have reached the Vercel
preview deployment as a 500 on the form's first use.

## What this did NOT cover

**The wallet leg.** Every signature in this run was produced by a keypair file,
not by a browser wallet. Nothing here says what Phantom shows when it is handed
the message in step 1 or the transaction in step 2 — including whether the
message prompt is one people can read, which is the whole reason its text is a
sentence. That is the ten-minute check in `docs/wallet-warnings.md`, and this
batch does not close it.

**The connected state of the form.** The screenshot in
`docs/design-shots/listing-form/` is the pre-connect state, because a headless
browser has no wallet extension: it shows the fee table, the devnet notice and
the connect prompt, and not the four fields behind them.

**Light mode.** Only a dark rendering was captured. This machine's headless
Chrome ignored `--force-light-mode` and `--force-dark-mode` alike — the page
follows `prefers-color-scheme` and both flags produced a byte-identical file.
Shipping the same image twice under two names would have been worse than saying
so.
