import { RPC_BACKOFF_MAX_MS, RPC_BACKOFF_MS, RPC_COMMITMENT, RPC_MAX_ATTEMPTS, solanaRpcUrls } from "../payments/config";

/**
 * Talking to Solana from the server, and the shape of what comes back.
 *
 * Adapted from the sibling project's `payments/solana.ts`, with its USDC
 * verifier removed: there is no SPL token anywhere in this product, so the
 * token-balance half of that module had no reason to travel. What did travel is
 * the transaction shape, the retry-across-endpoints fetcher, and the discipline
 * that produced both.
 *
 * WHO CALLS THIS: `payments/sol-transfer.ts` (ticket payments, listing fees,
 * launch fees, and the SOL leg of a payout), `chain/das.ts` (asset ownership and
 * metadata), and `raffles/draw.ts` (the announced slot's blockhash).
 */

/** Enough of the parsed transaction to name who signed and paid the fee. */
type TransactionMessage = {
  accountKeys?: { pubkey?: string; signer?: boolean }[];
};

export type SolanaTransaction = {
  slot?: number;
  /** Unix seconds. Absent on very old transactions and on some light nodes. */
  blockTime?: number | null;
  transaction?: { message?: TransactionMessage };
  meta?: {
    err?: unknown;
    /**
     * Native lamport balances, POSITIONAL: entry N belongs to
     * `accountKeys[N]`. Unlike SPL token balances they carry no owner, and the
     * fee payer's entry includes the network fee. That difference is the whole
     * reason `sol-transfer.ts` reads the RECIPIENT's increase rather than the
     * sender's decrease.
     */
    preBalances?: number[];
    postBalances?: number[];
  } | null;
} | null;

/** Injected so tests can drive the verifiers with fixture transactions. */
export type TransactionFetcher = (signature: string) => Promise<SolanaTransaction>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A confirmed transaction that genuinely does not exist and a node that is
 * rate-limiting us both look like "no result". Retrying across endpoints with
 * backoff is what keeps the second case from being reported to a paying user as
 * the first.
 */
export async function fetchTransaction(signature: string): Promise<SolanaTransaction> {
  const endpoints = solanaRpcUrls();
  let lastError: unknown = new Error("No RPC endpoint configured");

  for (let attempt = 0; attempt < RPC_MAX_ATTEMPTS; attempt++) {
    // Rotate endpoints so a single bad node does not eat every attempt.
    const endpoint = endpoints[attempt % endpoints.length];
    try {
      return await callGetTransaction(endpoint, signature);
    } catch (error) {
      lastError = error;
      if (attempt < RPC_MAX_ATTEMPTS - 1) {
        // Capped so a retry cannot hold a request open for long. Attempts are
        // sequential, so they never multiply concurrent connections; the cap is
        // about how long one request can occupy a worker.
        await sleep(Math.min(RPC_BACKOFF_MS * 2 ** attempt, RPC_BACKOFF_MAX_MS));
      }
    }
  }

  throw lastError;
}

async function callGetTransaction(
  endpoint: string,
  signature: string,
): Promise<SolanaTransaction> {
  const payload = await rpcCall(endpoint, "getTransaction", [
    signature,
    {
      encoding: "jsonParsed",
      commitment: RPC_COMMITMENT,
      maxSupportedTransactionVersion: 0,
    },
  ]);
  return (payload as SolanaTransaction) ?? null;
}

/**
 * One JSON-RPC call, with the error discipline every caller in this project
 * needs and none of them should have to remember.
 *
 * **The endpoint is never read out of a thrown error, logged, or interpolated
 * into anything.** A paid provider's URL carries its key in the query string,
 * and both a rejected `fetch` (DNS, TLS, a refused connection) and a provider's
 * own error body routinely echo the URL that was called. So failures throw a
 * message this function wrote, and nothing from upstream travels with it.
 */
export async function rpcCall(
  endpoint: string,
  method: string,
  params: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  } catch {
    throw new Error(`RPC call ${method} could not be sent`);
  }

  if (!response.ok) throw new Error(`RPC responded ${response.status} to ${method}`);

  let body: { result?: unknown; error?: unknown };
  try {
    body = (await response.json()) as { result?: unknown; error?: unknown };
  } catch {
    throw new Error(`RPC returned an unreadable body for ${method}`);
  }

  if (body.error) throw new Error(`RPC returned an error for ${method}`);
  return body.result ?? null;
}

/** The first configured endpoint, which is the one the server calls directly. */
export function primaryEndpoint(): string {
  return solanaRpcUrls()[0];
}
