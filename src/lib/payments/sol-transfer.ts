import { BLOCKTIME_SKEW_SECONDS } from "./config";
import type { SolanaTransaction, TransactionFetcher } from "../chain/rpc";

/**
 * Verifying a NATIVE SOL transfer, which the USDC verifier cannot do.
 *
 * WHY THIS IS A SEPARATE FILE AND NOT A FLAG ON `verifyPayment`. That function
 * reads `preTokenBalances`/`postTokenBalances` exclusively and compares
 * against a hardcoded mint — it is a verifier of SPL token movements, and a
 * native SOL transfer produces none. Lamports move in `preBalances`/
 * `postBalances`, a different field with different semantics: those are
 * indexed by position in `accountKeys` rather than carrying an owner, and
 * they include the transaction fee, which token balances never do.
 *
 * Folding both into one function would mean one body with two disjoint
 * halves and a flag choosing between them, which is two functions wearing one
 * name. The discipline is shared and the arithmetic is not.
 *
 * THE PAYER IS DERIVED, NEVER CLAIMED. Whoever's lamports went down is the
 * payer, and that is read off the chain rather than taken from the request.
 * A caller who submits somebody else's signature therefore registers that
 * somebody, not themselves — which gains an attacker nothing and costs the
 * honest case nothing.
 */

export type SolTransferResult =
  | { ok: true; payer: string; lamports: bigint; blockTimeMs: number }
  | { ok: false; reason: SolTransferFailure; message: string };

export type SolTransferFailure =
  | "not_found"
  | "failed_on_chain"
  | "no_block_time"
  | "no_transfer"
  | "insufficient_amount"
  | "too_old"
  | "outside_window"
  | "wrong_payer"
  | "rpc_unavailable";

/**
 * How far back a transfer may be and still pay for something here.
 *
 * A default for the paths that are not tied to an order with its own window —
 * a listing fee, a launch fee — because otherwise any historical transfer to
 * the receiving wallet, made for any reason, could be presented as payment. A
 * day is generous for somebody who paid and closed the tab, and short enough
 * that the pool of reusable transfers stays small.
 *
 * The signature is claimed exactly once regardless of this (`consumed_signatures`
 * and the UNIQUE columns on `raffles` and `collections`), so this bounds WHICH
 * transfers are eligible, not how many times one counts.
 *
 * Ticket orders do not use it: they carry their own `created_at`/`expires_at`
 * window and pass it explicitly, which is tighter.
 */
export const UNBOUND_TRANSFER_MAX_AGE_HOURS = 24;

/**
 * The lamports `wallet` received in this transaction, and who paid them.
 *
 * `preBalances`/`postBalances` are positional: entry N is the balance of
 * `accountKeys[N]`. That is the whole reason this cannot reuse the token
 * path's `sumFor`, which matches on an `owner` field that native balances do
 * not have.
 *
 * THE FEE PAYER'S DELTA INCLUDES THE NETWORK FEE, so the payer's balance drops
 * by more than it sent. That is why the amount is read from the RECIPIENT's
 * increase rather than the sender's decrease: what matters is what arrived,
 * and only the recipient's side says that without arithmetic about fees.
 */
export function readSolTransfer(
  transaction: SolanaTransaction,
  recipient: string,
): { payer: string; lamports: bigint } | null {
  const keys = transaction?.transaction?.message?.accountKeys ?? [];
  const pre = transaction?.meta?.preBalances;
  const post = transaction?.meta?.postBalances;
  if (!pre || !post || pre.length !== post.length || keys.length !== pre.length) return null;

  let received = 0n;
  let payer: string | null = null;
  let largestDrop = 0n;

  for (let i = 0; i < keys.length; i++) {
    const pubkey = keys[i]?.pubkey;
    if (!pubkey) continue;
    const delta = BigInt(post[i] ?? 0) - BigInt(pre[i] ?? 0);

    if (pubkey === recipient && delta > 0n) received += delta;

    // The payer is the signer who lost the most. A transaction can move
    // lamports between several accounts; the one that paid for this is the
    // signer whose balance fell furthest, and requiring `signer` is what stops
    // an account that merely lost rent from being named.
    if (keys[i]?.signer && delta < 0n && -delta > largestDrop) {
      largestDrop = -delta;
      payer = pubkey;
    }
  }

  if (received <= 0n || !payer) return null;
  return { payer, lamports: received };
}

/**
 * Whether this signature paid `minLamports` to `recipient`, recently enough,
 * and — when the caller knows who should have paid — from the right wallet.
 *
 * The RPC answer is treated as untrusted throughout: a transaction that failed
 * on chain moved nothing however it looks, and a missing block time is a
 * refusal rather than an assumption — a transfer whose age cannot be
 * established cannot be checked against any window.
 *
 * WHO CALLS THIS: `payments/settle.ts` (a ticket order, with its own window),
 * `raffles/escrow.ts` (a listing fee), `launch/collections.ts` (a launch fee),
 * and `raffles/payout.ts` (the seller's proceeds leg of a manual payout).
 */
export async function verifySolTransfer(input: {
  signature: string;
  recipient: string;
  minLamports: bigint;
  fetchTransaction: TransactionFetcher;
  nowMs?: number;
  /**
   * The wallet this payment was expected from, when the caller has one.
   *
   * **Gated on presence, not on truthiness.** `if (input.expectedPayer)` reads
   * tidier and is wrong: it treats an empty string the same as "no binding
   * requested" and skips the check entirely — not "no match found" but "no
   * check performed", which is a false `ok: true` on exactly the thing this
   * exists to catch. A present but blank value flows into the comparison, can
   * never equal a real address, and fails closed.
   *
   * Without it a payment is a bearer instrument: anyone watching the chain can
   * take a stranger's transfer and claim it as their own order, and the person
   * who actually paid gets nothing.
   */
  expectedPayer?: string | null;
  /**
   * An explicit window, as epoch milliseconds, for callers that have one.
   *
   * A ticket order carries `created_at`/`expires_at` and is tighter than the
   * blanket `UNBOUND_TRANSFER_MAX_AGE_HOURS`; a listing or launch fee has no
   * order behind it and falls back to the blanket age. Passing the window is
   * what stops a transfer that predates the order from paying for it.
   */
  window?: { fromMs: number; toMs: number };
}): Promise<SolTransferResult> {
  let transaction: SolanaTransaction;
  try {
    transaction = await input.fetchTransaction(input.signature);
  } catch (error) {
    // THE NAME, NEVER THE OBJECT. A rejected `fetch` carries the URL it was
    // given — and on any paid provider that URL has an api-key in its query
    // string, so logging the error would put the key into the deployment's
    // logs. `solana.ts` avoids this by not logging at all; this path wants
    // the signal, so it takes the one field that cannot carry a secret.
    console.error(`verifySolTransfer: fetch failed (${error instanceof Error ? error.name : "unknown"})`);
    return {
      ok: false,
      reason: "rpc_unavailable",
      message: "Could not read that transaction just now. Try again in a moment.",
    };
  }

  if (!transaction) {
    return {
      ok: false,
      reason: "not_found",
      message: "That transaction is not on chain yet.",
    };
  }

  // A failed transaction can still be fetched and still name a recipient. It
  // moved nothing.
  if (transaction.meta?.err) {
    return { ok: false, reason: "failed_on_chain", message: "That transaction failed on Solana." };
  }

  if (typeof transaction.blockTime !== "number") {
    return {
      ok: false,
      reason: "no_block_time",
      message: "That transaction has no timestamp on chain yet. Try again in a moment.",
    };
  }

  const blockTimeMs = transaction.blockTime * 1000;
  const now = input.nowMs ?? Date.now();
  const skewMs = BLOCKTIME_SKEW_SECONDS * 1000;

  // Skew allowance in both directions: our clock and the cluster's are not the
  // same clock, and a transfer that lands one second either side of a boundary
  // is not the fraud this check is looking for.
  if (input.window) {
    if (blockTimeMs < input.window.fromMs - skewMs || blockTimeMs > input.window.toMs + skewMs) {
      return {
        ok: false,
        reason: "outside_window",
        message:
          "That transaction was not made during this order. Pay after starting it — a transfer " +
          "from before the order existed cannot be used to claim it.",
      };
    }
  } else {
    const ageMs = now - blockTimeMs;
    if (ageMs > UNBOUND_TRANSFER_MAX_AGE_HOURS * 3_600_000 || ageMs < -skewMs) {
      return {
        ok: false,
        reason: "too_old",
        message: "That transfer is too old to be used here. Send a new one.",
      };
    }
  }

  const transfer = readSolTransfer(transaction, input.recipient);
  if (!transfer) {
    return {
      ok: false,
      reason: "no_transfer",
      message: "That transaction did not send SOL to the expected wallet.",
    };
  }

  /**
   * Checked AHEAD of the amount on purpose. It leaks nothing — the transaction
   * and its amount are already public to anyone holding the signature — and it
   * matters because the two failures are not equally fixable. An underpayment
   * can be topped up from the same wallet; a wrong-wallet payment cannot be
   * fixed by sending more from that same wrong wallet. Telling somebody "you
   * underpaid" when the real problem is whose wallet it came from sends them
   * straight into a second rejection.
   */
  if (input.expectedPayer !== undefined && input.expectedPayer !== null) {
    if (transfer.payer !== input.expectedPayer.trim()) {
      return {
        ok: false,
        reason: "wrong_payer",
        message: "That transaction was not paid from the wallet this was started with.",
      };
    }
  }

  if (transfer.lamports < input.minLamports) {
    return {
      ok: false,
      reason: "insufficient_amount",
      message: "That transfer was smaller than the amount due.",
    };
  }

  return { ok: true, payer: transfer.payer, lamports: transfer.lamports, blockTimeMs };
}
