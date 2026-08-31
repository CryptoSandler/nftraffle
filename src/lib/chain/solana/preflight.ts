/**
 * Deciding, on the server, whether a payment can succeed — BEFORE a wallet is
 * ever opened.
 *
 * **Why this exists is a wallet-behaviour problem, not a correctness one.** The
 * payment path was already safe without it: a transaction that fails costs the
 * payer nothing but a fee, and settlement verifies the chain afterwards. What it
 * was not was *quiet*. Phantom simulates every transaction it is handed, and a
 * transaction that cannot succeed produces a red interstitial reading roughly
 * "this transaction may be malicious" — which is a domain-reputation warning in
 * the user's mind and a failed simulation in fact. A site that hands wallets
 * transactions that fail simulation is teaching its own users to click through
 * exactly the warning that is supposed to protect them.
 *
 * So the rule (`docs/wallet-warnings.md`): **we do the simulation Phantom would
 * do, first, and if it fails we do not open the wallet at all.** The person gets
 * one sentence saying what is wrong, in a currency they recognise.
 *
 * **`sigVerify: false` is required, not a shortcut.** The transaction has not
 * been signed yet — that is the entire point of simulating before the wallet
 * sees it — so signature verification would fail on every call and tell us
 * nothing about whether the instructions succeed.
 *
 * **The decision is pure and the reads are not.** `checkAffordable` and
 * `readSimulation` take plain values so every branch is testable without a
 * network; `preflightPayment` is the thin part that fetches. Two of these
 * branches are the difference between "you need more SOL" and "something is
 * wrong with this transaction", and a person should never be shown the second
 * when the first is true.
 *
 * WHO CALLS THIS: `POST /api/raffles/[slug]/orders`, before it returns a
 * transaction to the browser.
 */

import { LAMPORTS_PER_SOL } from "./constants";
import { primaryEndpoint, rpcCall } from "./rpc";

/**
 * What a signature costs, in lamports, when we could not ask the chain.
 *
 * Solana's base fee is 5,000 lamports per signature and has been for years, and
 * this transaction carries exactly one signature. It is a FALLBACK: the real
 * figure is read with `getFeeForMessage` and this is used only when that call
 * fails, so a fee change would degrade this check rather than break it.
 *
 * Deliberately not tuned for priority fees. This product's transactions carry
 * none — a plain transfer with no compute-budget instruction — so the base fee
 * is the whole cost.
 */
export const FALLBACK_SIGNATURE_FEE_LAMPORTS = 5_000n;

export type PreflightRefusal =
  /** The payer cannot cover the amount plus the fee. The common case, by far. */
  | "insufficient_funds"
  /** The chain simulated the transaction and it failed for some other reason. */
  | "simulation_failed"
  /** We could not reach a node, so we do not know. */
  | "rpc_unavailable";

export type PreflightResult =
  | { ok: true; feeLamports: bigint }
  | { ok: false; reason: PreflightRefusal; message: string };

/** Renders lamports as SOL for a sentence a person reads. Never for arithmetic. */
export function solText(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const fraction = (lamports % LAMPORTS_PER_SOL).toString().padStart(9, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`;
}

/**
 * Whether the payer can cover the transfer and its fee.
 *
 * **Checked before the simulation, and reported differently.** A simulation
 * failure caused by an empty wallet is indistinguishable, in its error, from a
 * simulation failure caused by anything else — and "this transaction may fail"
 * is a useless thing to tell somebody whose actual problem is that they need
 * another 0.03 SOL. The shortfall is named in SOL because that is the unit on
 * the screen they are looking at.
 */
export function checkAffordable(input: {
  balanceLamports: bigint;
  amountLamports: bigint;
  feeLamports: bigint;
}): { ok: true } | { ok: false; reason: "insufficient_funds"; message: string } {
  const needed = input.amountLamports + input.feeLamports;
  if (input.balanceLamports >= needed) return { ok: true };
  return {
    ok: false,
    reason: "insufficient_funds",
    message: `You need ${solText(needed - input.balanceLamports)} more SOL for this — the ticket plus the network fee.`,
  };
}

/**
 * Reads a `simulateTransaction` response into a verdict.
 *
 * **A missing or unrecognised body is `rpc_unavailable`, never a pass.** A
 * preflight that treats "I could not tell" as "fine" is worse than no preflight:
 * it produces exactly the confident green light that sends somebody into the red
 * Phantom screen this exists to prevent.
 */
export function readSimulation(
  value: unknown,
): { ok: true } | { ok: false; reason: PreflightRefusal; message: string } {
  const result = (value as { value?: { err?: unknown } } | null)?.value;
  if (typeof result !== "object" || result === null) {
    return {
      ok: false,
      reason: "rpc_unavailable",
      message: "This payment could not be checked just now. Try again in a moment.",
    };
  }
  if (result.err === null || result.err === undefined) return { ok: true };
  return {
    ok: false,
    reason: "simulation_failed",
    message:
      "The network says this payment would not go through. Nothing has been charged, and no " +
      "wallet has been opened.",
  };
}

/**
 * The fee for a compiled message, from the chain, with a fallback.
 *
 * `getFeeForMessage` takes the MESSAGE, not the wire transaction — the
 * difference is the signature array, and passing the wrong one returns null
 * rather than an error, which is the kind of failure that looks like a working
 * check.
 */
export async function feeForMessage(base64Message: string): Promise<bigint> {
  try {
    const response = await rpcCall(primaryEndpoint(), "getFeeForMessage", [
      base64Message,
      { commitment: "confirmed" },
    ]);
    const value = (response as { value?: unknown } | null)?.value;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return BigInt(value);
  } catch {
    // Falls through to the constant. A fee we could not read is not a reason to
    // refuse a payment; it is a reason to use the figure that has been true for
    // years and let the simulation catch anything else.
  }
  return FALLBACK_SIGNATURE_FEE_LAMPORTS;
}

/**
 * The whole preflight: balance, then fee, then simulation.
 *
 * Ordered cheapest-first and most-informative-first at once, which is a
 * coincidence worth keeping: the balance check is one call and produces the
 * sentence people actually need, so a broke payer never waits on a simulation to
 * be told something the first call already knew.
 */
export async function preflightPayment(input: {
  payer: string;
  amountLamports: bigint;
  /** The compiled, UNSIGNED transaction, base64. */
  base64Transaction: string;
  /** The compiled message alone, base64, for `getFeeForMessage`. */
  base64Message: string;
}): Promise<PreflightResult> {
  let balance: bigint;
  try {
    const response = await rpcCall(primaryEndpoint(), "getBalance", [
      input.payer,
      { commitment: "confirmed" },
    ]);
    const value = (response as { value?: unknown } | null)?.value;
    if (typeof value !== "number") throw new Error("no balance");
    balance = BigInt(value);
  } catch {
    return {
      ok: false,
      reason: "rpc_unavailable",
      message: "This payment could not be checked just now. Try again in a moment.",
    };
  }

  const feeLamports = await feeForMessage(input.base64Message);

  const affordable = checkAffordable({
    balanceLamports: balance,
    amountLamports: input.amountLamports,
    feeLamports,
  });
  if (!affordable.ok) return affordable;

  let simulation: unknown;
  try {
    simulation = await rpcCall(primaryEndpoint(), "simulateTransaction", [
      input.base64Transaction,
      {
        // NOT signed yet — that is the point of simulating before the wallet
        // sees it. With sigVerify on, every call would fail on the empty
        // signature and tell us nothing about the instructions.
        sigVerify: false,
        // The blockhash we built with may already be a few slots old; replacing
        // it stops a stale-blockhash failure being reported as a bad payment.
        replaceRecentBlockhash: true,
        commitment: "confirmed",
        encoding: "base64",
      },
    ]);
  } catch {
    return {
      ok: false,
      reason: "rpc_unavailable",
      message: "This payment could not be checked just now. Try again in a moment.",
    };
  }

  const verdict = readSimulation(simulation);
  return verdict.ok ? { ok: true, feeLamports } : verdict;
}
