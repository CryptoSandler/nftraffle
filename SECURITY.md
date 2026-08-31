# Security invariants

Properties this project holds on purpose, why each one is worth its cost, and
what would break it.

These are **invariants, not guidelines**. A change that violates one is not a
trade-off to weigh in a pull request — it is a change to this document first,
made deliberately, with the owner's agreement. Every one of them is here because
it is cheaper to keep than to recover.

---

## I1 — The server holds no private key

Not for `PAYMENT_WALLET_*`, not for `ESCROW_WALLET_*`, not for anything, on any
chain. Every outbound transfer in this product is performed by a human from a
wallet this codebase cannot reach, and the codebase's only job is to *verify* it
afterwards.

**What it costs.** Payouts are manual, `/admin` is a work queue rather than a
button, and the product cannot scale past what a person can settle by hand.
Refunds are manual for the same reason, which is why `docs/decisions.md` Q2
refuses an enforced seller minimum.

**What it buys.** A full compromise of this server — the database, the
environment, the deploy — moves no money and steals no asset. An attacker gets
the ability to lie on a web page. That is the difference between an incident and
a catastrophe, and it is why the cost above is worth paying.

**What breaks it.** Any feature whose description contains "automatically
sends", "automatically refunds", or "sweeps". If one is genuinely needed, it is a
new threat model and a conversation, not a `SIGNER_SECRET` in `.env.example`.

**The one place this is easy to erode by accident:** the Solana Pay reference
keypair is generated per order. Its private half is never exported, never
serialised, and never touched again — there is deliberately no `exportKey` call
on it anywhere. A future change that stores it would put a key on the server
while looking like a caching optimisation.

## I2 — We deploy no on-chain program that custodies money

**On Solana this is already true and is the basis of the platform fee.** The
mint fee is charged by Metaplex Core Candy Machine's `solFixedFee` guard — an
audited, immutable, third-party program. We wrote no contract, so we own no
contract bug.

**On EVM this invariant is at risk, and it is the reason the EVM launchpad is
deferred.** Robinhood Chain has no candy machine equivalent. Building leg 1
there means *something* has to enforce the platform's share of a mint, and the
obvious answer — our own collection contract — would put money under code we
wrote, deployed immutably, where a bug is somebody else's loss and cannot be
patched.

**The invariant, stated so it can be checked:**

> If the EVM launchpad is ever built, it is built on a **third-party ERC-721
> factory that is already audited and already deployed**. This project does not
> write, deploy, or upgrade a contract that holds or routes fees.

**What follows from that, and it is a real product cost:** a third-party factory
will not charge our platform fee for us, because it does not know about us. So
on EVM the mint fee is either collected outside the mint (a separate transfer we
verify, with the honest admission that a minter can skip it — see
`docs/superpowers/specs/2026-08-31-multichain-analysis.md` §0.1 for why that is a
suggestion rather than a fee), charged as a launch fee instead, or not charged at
all. **Choosing between those is a product decision that must be made before any
EVM launchpad work starts**, because it decides whether the leg has a business
model.

**The gate.** The EVM launchpad does not begin until both hold:

1. At least one real raffle has run end to end on Robinhood Chain, and
2. There is demonstrated creator demand for launching there.

Neither is a formality. §4.2 of the multichain analysis argues Robinhood Chain
has no NFT audience yet; gate 2 exists to make that argument falsifiable by
evidence rather than settled by enthusiasm.

## I3 — Money verdicts are read off the chain, never claimed by a caller

Three faces, all live in the code today:

1. **The payer is derived**, from balance deltas or a receipt — never from a
   request body. A caller who submits somebody else's transaction credits that
   somebody.
2. **The escrow deposit is derived.** A raffle publishes because the chain says
   the exact asset arrived at the escrow wallet from the seller's wallet. Two
   questions are asked, not one: the transfer says a deposit *happened*,
   ownership says the asset is *still there*, and only both together close the
   deposit-and-withdraw.
3. **The payout is derived.** `/admin` marking a raffle `paid` requires the
   signatures, and the server verifies them on chain before accepting.

Face 3 is the one that is easy to skip, because the operator is us and we know we
sent it. That is exactly why it is written down: the page is read by the person
who did not send it.

## I4 — No uploaded bytes, no caller-supplied media URLs

Every image and name comes from on-chain sources. There is no upload endpoint and
no form field that accepts a URL. Launch art is uploaded by the creator, paid for
by the creator, and signed by the creator, to permanent storage we do not
operate.

**What it buys.** This project is not an image host for arbitrary art uploaded by
unvetted strangers — no storage cost, no moderation obligation, no takedown
surface. For a project with no legal entity behind it, that is not a minor
saving.

**Where it needs care on EVM.** ERC-721 metadata is `tokenURI()` → JSON somebody
else hosts → an image somebody else hosts. That JSON fetch is attacker-controlled
content and needs its own bounds: a size cap, a timeout, and no redirects into
private address ranges. The rendered image is already bounded by the `img-src`
allowlist in `next.config.ts`.

## I5 — A refusal tells a prober nothing

Every admin failure — no cookie, expired, revoked, malformed, wrong token, or
`ADMIN_TOKEN` unset — returns an identical status, body, and headers, and is held
to the same time floor. The latency used to answer a question the body refused
to: *does this deployment have an admin surface at all.*

Configuration faults go to the server log, never to the caller. The same rule
governs the closed-surface screens: the visitor is told the surface is not
available, and the missing variable's name is logged.

## I6 — The chain a signature is for is classified server-side and blocks when unknown

The browser talks only to `/api/rpc`, so it cannot see which cluster the proxy
points at. The classification happens on the server and only its *answer* — a
name, never the URL — is passed down. An endpoint that cannot be classified with
confidence answers `unknown`, and `unknown` blocks signing.

This matters more here than in the sibling project, because this product asks
creators to sign transactions that create **permanent on-chain state**. A
collection minted on the wrong network is not refundable and not undoable.

## I7 — The test suite cannot touch a database nobody marked disposable

Two independent guards, answering different questions. The suite refuses unless
the database carries a `disposable_database` stamp — written only by
`npm run db:migrate:test`, deliberately **not** by a migration, so production can
never carry it. And it refuses if `TEST_DATABASE_URL` equals `DATABASE_URL`.

The stamp is the absolute question; the comparison is the relative one, and it
has a hole the stamp closes: with `DATABASE_URL` unset, the comparison passes
against anything. Both stay.

**The one edit to refuse:** moving the stamp into `migrations/` because it looks
untidy outside. The guarantee is gone the moment production migrates.

---

## Reporting

This project has no published contact channel yet (`SUPPORT_CONTACT` is unset
until the domain exists — `docs/decisions.md` Q6). Until then there is no
security contact to publish here, and inventing one would be worse than the
absence.
