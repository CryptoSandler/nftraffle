# The Solana draw margin assumes a slot time the chain does not have

**Found:** 2026-08-31, during the first end-to-end devnet rehearsal.
**Severity:** high — it defeats the commit–reveal for long raffles.
**Status:** NOT FIXED. Recorded here rather than patched at the end of a session.

## What the code assumes

`chain/solana/constants.ts`:

```
SOLANA_SLOT_MS = 400
SOLANA_DRAW_MARGIN_MS = 1 hour
announceHeight = currentSlot + ceil((endsAt - now + 1h) / 400)
```

and it says, in as many words:

> skipped slots make the chain's slot number advance MORE SLOWLY than the wall
> clock, so a slot announced this many milliseconds ahead arrives LATER than
> intended, never earlier. Later is safe.

**That claim is false.** It was written by analogy to Robinhood Chain, where the
same reasoning was applied in the opposite direction and measured. Solana's was
never measured.

## What the chain actually does

Measured 2026-08-31 over 40,000 slots on each cluster:

| Cluster | Measured | vs assumed 400ms |
|---|---|---|
| devnet (Helius) | **165.8 ms/slot** | 0.41× |
| mainnet-beta | **317.1 ms/slot** | 0.79× |

Solana's 400ms is a *target*; real slot times sit below it. The chain advances
**faster** than the wall clock the margin was computed from, so the announced
slot arrives **earlier** than intended — the unsafe direction.

## Why it matters

The announced slot must not exist while tickets are on sale. It arrives at
`(duration + 60min) × f` after creation, where `f` is measured/assumed. The
raffle closes at `duration`. Safe requires `(duration + 60) × f > duration`,
i.e.

    duration < 60f / (1 - f)

| Cluster | f | Safe up to |
|---|---|---|
| devnet | 0.41 | ~42 minutes |
| **mainnet** | **0.79** | **~229 minutes (3.8 hours)** |

`SELLER_LIMITS.maxDurationDays` is **30**. So on mainnet, **any raffle longer
than about four hours has its draw blockhash available before the sale ends.**

**The attack that opens.** The server holds the seed from creation. Once the
announced slot's hash exists, whoever holds the seed can compute the winning
ticket number — while tickets are still selling — and buy exactly that ticket.
That is precisely the outcome commit–reveal exists to prevent, and the public
verification page would still say "they agree", because the arithmetic is
honest. Only the ORDERING was broken.

Nothing was exploited: no mainnet raffle has ever run.

## Why the rehearsal caught it and the tests did not

Every unit test feeds `announceHeight` a slot number and asserts arithmetic. The
arithmetic was always right. What was wrong was a claim about the world —
how fast slots actually advance — and the only way to find that was to watch a
real chain for an hour. The rehearsal's draw step waited on a real announced
slot, and it arrived in 15 minutes instead of 60.

## The fix, and why it is not a smaller constant

Lowering `SOLANA_SLOT_MS` to a conservative fast value (say 120ms) restores
safety but makes the wait proportional to how wrong the estimate is: on mainnet
at 317ms a one-hour margin becomes ~2.6 hours, and a 30-day raffle's announced
slot would land months out. Slot-rate assumptions do not survive across clusters
or across time.

**Commit to a TIME, not a slot number.** Publish "the draw uses the first block
at or after `T`", where `T = ends_at + margin` as a wall-clock instant. At draw
time, resolve `T` to the first block whose `blockTime >= T`. This is:

- immune to slot-rate drift on any cluster, so the same code is correct on
  devnet, mainnet and any EVM chain;
- still unknowable at commitment time, because nobody can know a future block's
  hash;
- verifiable by a stranger — `T` is published, and "first block at or after `T`"
  is a check anyone can repeat.

It replaces `announceHeight` with `announceTime`, and `hashAtHeight` with a
`hashAtOrAfter(time)` lookup. `raffles.draw_slot` becomes `draw_at` plus the
resolved `draw_slot` recorded at draw time — which the schema already has room
for, since it stores `draw_blockhash` separately.

**Robinhood Chain needs the same change**, for the same reason. Its constants
were measured, but a measurement taken once is a slot-rate assumption like any
other.

## Until it is fixed

Cap `SELLER_LIMITS.maxDurationDays` well below the safe bound — **2 hours** on
mainnet leaves nearly a 2× margin against the measured rate. That is a one-line
change and it makes the current design safe for the raffles a first launch will
actually run.
