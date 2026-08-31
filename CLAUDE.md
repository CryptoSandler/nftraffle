@AGENTS.md

# Talking to the user

Every message you send to the user starts with the line `[nftraffle]` on its own,
before anything else, so the user can tell which project is talking when several
Claude Code sessions run in parallel.

The working name is `nftraffle` and it is a placeholder. The domain is not bought
yet, so nothing in this repository should read as if the name were final: no
wordmark baked into an image, no name inside a database value, no name in a
migration. It lives in `package.json`, in copy, and in `SITE_URL`, and those are
the three places a rename has to touch. See DESIGN.md §11.

## Default posture: lazy senior

A skill only fires when the model judges it relevant, and this applies to every change, so
the short version lives here rather than in `~/.claude/skills/ponytail/`.

Before writing code, climb until a rung holds, and stop at the first one that does:

1. Does this need to exist at all? Speculative need: skip it, and say so in one line.
2. Does this repo already have it? Reusing what lives a few files over beats re-implementing it.
3. Does the standard library do it?
4. Does a native platform feature cover it? A DB constraint over app code, CSS over JS.
5. Does an already-installed dependency solve it? Never add one for what a few lines cover.
6. Can it be one line?

If no rung holds, write the minimum that works.

The level here is **lite**: build what was asked, and name the lazier alternative in one
line so the choice stays with the user. Nothing gets silently downscoped into something
smaller than what was requested.

Every deliberate shortcut carries a comment naming its ceiling and its upgrade path, so the
next reader knows it was a decision and not an oversight:

    // ponytail: linear scan, index it if the list outgrows a few hundred entries

Four things are never simplified away, at any level: input validation at trust boundaries,
security, error handling that prevents data loss, and accessibility basics. Laziness governs
how much code gets written. It never governs what that code is allowed to skip.

## The laziest rung this project keeps reaching for: the vendor's program already does it

Rung 4 — "does a native platform feature cover it" — is where most of this
codebase's real decisions get made, and the platform is not only Postgres and
the browser. It is also **Metaplex Core Candy Machine**, which is a deployed,
audited, immutable on-chain program this project uses and does not fork.

The worked example is the platform fee. The obvious build is "append a transfer
instruction to the mint transaction". That is application code enforcing money,
and application code that builds a transaction cannot enforce anything: the
candy machine is a public account, its mint instruction is public, and a minter
who assembles their own transaction simply omits our instruction and mints for
free. The `solFixedFee` guard does the same job inside the program, where the
mint fails without it. Same money, one config field, zero enforcement code.

So the question to ask before writing anything that touches the chain is not
"how do I build this", it is **"which guard already is this"** — and if the
answer is none, say so out loud rather than reaching for client-side
enforcement, because client-side enforcement of money is not a lazy version of
the feature, it is a broken version of it.

# Before building: one round with no code

**A change to the data model, or a product decision of any size, gets an
adversarial round before a line is written. Not a plan — an argument.** Three
things are asked for explicitly, and the round is not closed until all three
have answers:

1. **The strongest case AGAINST.** Not caveats, not risks-and-mitigations. The
   version of "this is the wrong thing to build" that would actually change the
   decision if it were true.
2. **The collision with the real code.** What survives, what gets thrown away,
   and — the one that pays for the round — *what does the repo already know that
   the discussion does not.*
3. **An honest recommendation, with standing permission to say the idea is
   wrong.** A round that can only produce "yes, and here is how" is a round that
   produced nothing.

The round costs a message. Not having it costs a batch.

# Every feature is judged against the loop

DESIGN.md §1 states the thesis and it is normative, not marketing: **launch
instantly with no vetting → raffle the supply to bootstrap it → the secondary
market for that collection is raffles here.**

A feature request is answered by naming which arrow of that loop it makes
shorter or more likely to complete. A feature that serves none of the three is
not "nice to have later", it is a feature belonging to a different product —
an orderbook, a curation team, a ranking surface — and the honest answer is to
say which product it belongs to.

This is a rule because the pull is constant and it always sounds reasonable.
Sorting, filtering, floor prices, trait rarity, watchlists and collection
verification are all obviously good, all obviously what a marketplace has, and
all of them are Magic Eden's game played with a hundredth of their liquidity.

# Every verdict cites the written norm

**A gate, a critique or a design verdict is made against the normative document
OPEN — DESIGN.md, this file, the spec, the migration — never against a memory of
what it says. A verdict that cannot quote the line has not earned the right to be
a verdict yet: read the document first.**

This cuts both ways, and the second way is the one people miss: **a citation can
be stale.** So the rule is not "the document wins" — it is *open the document,
and check it against the code it claims to govern.* Where they disagree, one of
them is a bug, and saying which is the verdict.

Memory reliably produces a plausible wrong number. Contrast ratios, fee basis
points, lamport constants and guard names are all things this project has
written down, and all things a confident answer gets subtly wrong. Every one of
them takes one grep.

# Decisions with a door

**When the owner is not convinced of a one-way decision — a promise in copy, a
prohibition, a guarantee, anything the product cannot walk back — do not decide
it for them.** Three moves, in order:

1. **Find the neutral wording**: text that neither promises nor forbids, and is
   honest in both futures.
2. **Build the mechanism that fits both.** The code should not need rewriting
   whichever way the policy lands.
3. **Record the policy as the owner's decision**, somewhere an operator
   reads — `docs/decisions.md`, not a commit message.

**The irreversible sentence gets written once, and only when it is asked for
explicitly.**

This project has more of these than the sibling projects did, because it sells
chance for money. Whether a raffle needs a minimum, whether any jurisdiction is
refused, whether a seller may cancel — every one of those is a promise the
moment it appears in copy, and none of them is a promise this repository is
allowed to make on the owner's behalf. The first six were put to the owner and
answered on 2026-08-31 — `docs/decisions.md` records each answer with what it
costs and what would make it worth revisiting. New ones go in that file's
"Still open" section.

# A verification that returns nothing needs a control

**Before believing a check that came back empty, grep for something you KNOW is
there. If that does not appear either, the instrument is broken, not the code.**

An all-zero result reads exactly like a clean bill of health, and it is the shape
a broken check takes most often — wrong path, wrong file, empty variable, a
server that answered 302 instead of 200. The control costs one line.

# Verify behaviour, not state

**A snapshot says a thing was true at the instant you looked. It does not say how
often, for how long, or under what conditions — and those are usually the
property that matters.**

When the claim is about a duration, an interval, or a count, the verification has
to span it. `pg_locks` once, a `curl` once, a log line once — each answers "at
this instant", and the bug you are hunting usually lives between two instants.

## A green run against a tree that no longer exists is not green

A test run reads the working tree as it goes. Edit a file after the run starts
and the result belongs to a tree that is part old and part new — and which part
it tested depends on the order vitest happened to load files in. It reports green
either way.

**So a run that was overtaken by edits is killed and restarted, not believed.**
The practical rule that follows: **finish a unit, then verify it, then start the
next one.**

# A status is never an input

**When a state machine derives a status from data, no endpoint and no form
accepts that status from a caller. They move the data; the machine decides the
status.**

A raffle is `open` because its `ends_at` has not passed and its supply has not
sold out; it is `drawn` because a seed was revealed against an announced slot's
blockhash. Neither is a column an admin form may set. `src/lib/raffles/lifecycle.ts`
owns every transition, and when a transition genuinely does not exist —
cancelling, reviving — **write the transition next to the others, with the same
guards.** Do not reach for a bare UPDATE in a route.

# A defended number keeps its reason in the same file

**A magic number that a test protects also carries, at the site of the decision,
the sentence explaining why it is that number. The test asserts the sentence is
still there.**

A test in another file can hold a number; it cannot stop somebody deleting the
comment that says why, and once the why is gone the number is arbitrary and the
next person "optimises" it. Then the test fails, and its failure is a mystery
rather than an argument.

**Match on collapsed whitespace with comment markers stripped.** These sentences
are hard-wrapped, and asserting the raw file means asserting where somebody's
editor broke the line — a test that fails on a reflow is a test people learn to
edit rather than read.

# Money verdicts are read off the chain, never claimed by a caller

This is the rule the whole project's honesty rests on, and it has three faces.

1. **A payer is derived, never claimed.** Whoever's lamports went down is the
   payer, read from `preBalances`/`postBalances`. A caller who submits somebody
   else's signature therefore credits that somebody, which gains an attacker
   nothing.
2. **An escrow deposit is derived, never claimed.** A raffle publishes because
   the chain says the exact mint arrived at `ESCROW_WALLET` from the seller's
   wallet — not because a form said so.
3. **A payout is derived, never claimed.** `/admin` marking a raffle `paid`
   requires a signature, and the server verifies that signature on-chain before
   it accepts the mark. An operator's unverified word is not evidence, and the
   public raffle page must never display a settlement that nothing checked.

Face 3 is the one that is easy to skip, because the operator is us and we know
we sent it. That is exactly why it is written down: the page is read by the
person who did not send it.

# Every new module names its caller

**A brief that creates a function, a job, or a route says who invokes it. If the
answer is "a later task", that task is named. If the answer is "nothing yet", the
brief says so out loud.**

The sibling project shipped `expireStaleOrders` and `recoverUnclaimedOrders` —
both finished, tested, and independently reviewed, one through three fix rounds —
with no caller anywhere in the application. One task built the expirer, another
the recoverer, a third the routes, and no brief owned the wiring, so nobody was
wrong and the feature did not exist.

Two habits follow:

1. **A unit test of a function cannot catch this, and did not.** The test that
   catches it asserts the *wiring*: drive the caller, not the callee, and assert
   the effect. Falsify it by deleting the call.
2. **"Who calls this?" is a review question**, asked of every new module, and
   answered with a file and a line rather than an intention.

# Commit identity

**Every author line must read
`CryptoSandler <294572464+CryptoSandler@users.noreply.github.com>`.** The
`noreply` address is the point: a personal email in the log is a leak that
survives in public history, and rewriting it after a push means rewriting
published commits.

Commits carry **no trailers** — no `Co-Authored-By`, no `Generated with`.

## The identity must be LOCAL to the repository

    git config --local user.name
    git config --local user.email

`--local` is the whole point: without it the command prints whatever the
resolution chain produced. A value in `.git/config` is read by every process that
touches the directory, subagents included, unconditionally. An `includeIf` is a
*condition*, and a child process that does not resolve it the way the parent did
falls back to the global default — which is the personal address. The include
stays as a net; it is not the source.

**Verified here:** both are set in `.git/config`.

## Check each subagent's range the moment it delivers

    git log --format='%an <%ae>' <base>..<head>

Not at the close. By then the commits are made and possibly pushed, and the cheap
fix — `git commit --amend --reset-author` — is gone.

There is no pre-push hook here; `.git/hooks` is not versioned, so a hook installed
on one machine protects one machine. `/cierre`'s author check is the only gate,
which is what is true today.

# Test databases

**A branch that adds a migration runs against its OWN database.** Two unmerged
branches sharing one test database means the one that migrates decides the schema
for the one that does not, and the second branch fails on a column its code
predates — a defect report for a defect that does not exist.

**Merge order follows from this and is not optional.** The branch without
migrations merges first; the one with them rebases on top and re-runs.

## The test database proves it is disposable

**The suite refuses to run against a database that does not carry the
`disposable_database` stamp.** The stamp is written only by
`npm run db:migrate:test`, and deliberately **not** by a migration — a migration
runs everywhere, production included, which is exactly backwards. It marks an
ENVIRONMENT, not a schema.

**Why a second guard.** `vitest.setup.ts` asks whether `TEST_DATABASE_URL`
differs from `DATABASE_URL`, and that is a relative question with a hole in it:
with `DATABASE_URL` unset the comparison passes and the suite truncates whatever
`TEST_DATABASE_URL` happens to point at. A relative check cannot answer an
absolute question.

**Both guards stay, because they answer different questions:** the stamp catches
"wrong database", the comparison catches "same database twice".

**If somebody moves the stamp into `migrations/`** because it looks untidy
outside, the guarantee is gone the moment production migrates: every database
carries it and the guard passes everywhere. That is the one edit to refuse.

## Concurrent runs against the shared database

`fileParallelism: false` stops files inside ONE run from racing. It does nothing
about two runs — two sessions, two terminals, two repos — and those truncate each
other's fixtures mid-assertion. A Postgres advisory lock, held for the length of
a run, makes the second run wait instead of interleave.

Three things about that lock are load-bearing:

- **THE LOCK LIVES IN `vitest.global-setup.ts`, NEVER IN `setupFiles`.**
  `setupFiles` runs once per test FILE. A lock taken there is taken and released
  once per file, sitting FREE in every gap between files — precisely where a
  second run slips in. It passes a naive check: look at `pg_locks` mid-run and
  the lock is genuinely held, because you happened to look during a file rather
  than between two.
- **It is taken on a DIRECT connection, not the pooled one.** Neon's pooled
  endpoint is PgBouncer in transaction mode, which hands one server connection to
  a different client between transactions — a session-level lock taken through it
  is released at a moment nobody controls. `directUrl()` strips `-pooler` for
  exactly this.
- **It waits with a ceiling, and says which situation it is.** A run that hung
  and a run that is genuinely still going need different responses from whoever
  is reading the terminal.

**Never `pkill -f vitest`.** It matches every repo on the machine. Kill by PID.

# Migrations

**Never change the SQL of a migration that has already been applied. Add the next
number.**

`scripts/migrate.mts` records applied versions and skips them, so editing an
applied file fixes the file and nothing else. Every database that already ran the
old version keeps the old schema, silently, and the file now lies about what
those databases contain. It looks fine locally because the local database is the
one you just repaired by hand.

**`--` comments are the exception, and only because they cannot diverge.** No
database stores one. `COMMENT ON` is NOT a comment for this purpose — its text
lives in the catalog, so changing it is changing the schema and takes the next
number like any other DDL.

**A migration comment describes the schema, not the policy some module applies to
it** — the schema is frozen by definition and the policy is not.

# Showing the network before a signature

**Classify to a cluster name. Never pass the upstream URL. If you cannot classify
with confidence, say "unknown" and block the signature.**

The browser only ever talks to `/api/rpc`, so it cannot see which cluster the
proxy is pointed at. A deployment whose `SOLANA_RPC_URL` points at devnet will
show mainnet on an ordinary origin, and nothing client-side can tell.

1. **The cluster is classified server-side and passed down as a name.** Not the
   URL, not the host, not a fragment of either. `/api/rpc` exists so that nothing
   of the upstream reaches the browser — no URL, no key, no raw provider body, on
   any status code. Passing the endpoint down to label a screen undoes that from
   the other direction.
2. **Refusing to sign is the safe failure.** A disclosure that can be silently
   wrong is worse than no disclosure, because it is trusted. A payer who cannot
   pay will ask. A payer who paid on the wrong chain will not know to.

Here that rule is load-bearing twice over, because this project asks a creator to
sign a transaction that **creates permanent on-chain state** — a collection, a
candy machine — not only one that moves money. A collection minted on devnet
because the proxy was pointed there is not refundable and not undoable.

# Nothing in this repository holds a private key

Not for `ESCROW_WALLET`, not for `PAYMENT_WALLET`, not for anything. Every
outbound transfer in this product is performed by a human from a wallet this
codebase cannot reach, and the codebase's job is to *verify* it afterwards.

Two consequences that look like limitations and are the design:

- Payouts are manual, and `/admin` is a work queue rather than a button that
  moves money.
- The Solana Pay reference keypair generated per order has its private half
  discarded at the moment of creation — generated, public half read out, never
  exported. There is deliberately no `exportKey` call on it anywhere.

If a future feature needs the server to sign, that is a new threat model and a
new conversation, not an implementation detail. Say so out loud rather than
adding a `SIGNER_SECRET` to `.env.example`.
