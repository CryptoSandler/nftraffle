import {
  checkWindowAndPayer,
  type NativeTransferResult,
} from "../../payments/native-transfer";
import { SOLANA_BLOCKTIME_SKEW_SECONDS } from "./constants";
import type { SolanaTransaction, TransactionFetcher } from "./rpc";

/**
 * Verifying a native SOL transfer.
 *
 * Lamports move in `preBalances`/`postBalances`, which are POSITIONAL — indexed
 * by place in `accountKeys` rather than carrying an owner — and which include
 * the transaction fee. That is the arithmetic this file exists for, and it is
 * the half that does not generalise: the EVM adapter reads a receipt's `value`
 * and needs none of it.
 *
 * What IS shared lives in `payments/native-transfer.ts`: the result vocabulary,
 * and the window and payer checks. Those are product rules rather than chain
 * facts, so there is one copy and both adapters call it.
 *
 * THE PAYER IS DERIVED, NEVER CLAIMED. Whoever's lamports went down is the
 * payer, read off the chain rather than taken from the request. A caller who
 * submits somebody else's signature therefore credits that somebody — which
 * gains an attacker nothing and costs the honest case nothing.
 *
 * WHO CALLS THIS: `chain/solana/index.ts`, which is the only thing that
 * constructs the Solana adapter. Nothing else imports it.
 */

/**
 * The lamports `recipient` received in this transaction, and who paid them.
 *
 * THE FEE PAYER'S DELTA INCLUDES THE NETWORK FEE, so the payer's balance drops
 * by more than it sent. That is why the amount is read from the RECIPIENT's
 * increase rather than the sender's decrease: what matters is what arrived, and
 * only the recipient's side says that without arithmetic about fees.
 */
export function readSolTransfer(
  transaction: SolanaTransaction,
  recipient: string,
): { payer: string; amount: bigint } | null {
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
  return { payer, amount: received };
}

/**
 * Whether this signature paid `minAmount` to `recipient`, recently enough, and
 * — when the caller knows who should have paid — from the right wallet.
 *
 * The RPC answer is treated as untrusted throughout: a transaction that failed
 * on chain moved nothing however it looks, and a missing block time is a refusal
 * rather than an assumption, because a transfer whose age cannot be established
 * cannot be checked against any window.
 */
export async function verifySolTransfer(input: {
  signature: string;
  recipient: string;
  minAmount: bigint;
  fetchTransaction: TransactionFetcher;
  nowMs?: number;
  expectedPayer?: string | null;
  window?: { fromMs: number; toMs: number };
}): Promise<NativeTransferResult> {
  let transaction: SolanaTransaction;
  try {
    transaction = await input.fetchTransaction(input.signature);
  } catch (error) {
    // THE NAME, NEVER THE OBJECT. A rejected `fetch` carries the URL it was
    // given — and on any paid provider that URL has an api-key in its query
    // string, so logging the error would put the key into the deployment's
    // logs. This path wants the signal, so it takes the one field that cannot
    // carry a secret.
    console.error(
      `verifySolTransfer: fetch failed (${error instanceof Error ? error.name : "unknown"})`,
    );
    return {
      ok: false,
      reason: "rpc_unavailable",
      message: "Could not read that transaction just now. Try again in a moment.",
    };
  }

  if (!transaction) {
    return { ok: false, reason: "not_found", message: "That transaction is not on chain yet." };
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

  const transfer = readSolTransfer(transaction, input.recipient);
  if (!transfer) {
    return {
      ok: false,
      reason: "no_transfer",
      message: "That transaction did not send SOL to the expected wallet.",
    };
  }

  const blockTimeMs = transaction.blockTime * 1000;

  /**
   * The window and payer checks run BEFORE the amount check, and the order is
   * deliberate. It leaks nothing — the transaction and its amount are already
   * public to anyone holding the signature — and it matters because the
   * failures are not equally fixable: an underpayment can be topped up from the
   * same wallet, but a wrong-wallet payment cannot be fixed by sending more
   * from that same wrong wallet. Telling somebody "you underpaid" when the real
   * problem is whose wallet it came from sends them into a second rejection.
   */
  const gate = checkWindowAndPayer({
    payer: transfer.payer,
    blockTimeMs,
    nowMs: input.nowMs ?? Date.now(),
    skewSeconds: SOLANA_BLOCKTIME_SKEW_SECONDS,
    expectedPayer: input.expectedPayer,
    window: input.window,
  });
  if (!gate.ok) return gate;

  if (transfer.amount < input.minAmount) {
    return {
      ok: false,
      reason: "insufficient_amount",
      message: "That transfer was smaller than the amount due.",
    };
  }

  return { ok: true, payer: transfer.payer, amount: transfer.amount, blockTimeMs };
}
