import { evmRpcUrls } from "../../payments/config";

/**
 * Talking to Robinhood Chain from the server.
 *
 * Plain JSON-RPC over `fetch`, no client library. The methods used are
 * `eth_getTransactionReceipt`, `eth_getTransactionByHash`,
 * `eth_getBlockByNumber`, `eth_blockNumber` and `eth_call` — five fixed shapes,
 * which is not enough to earn a dependency on the server side (CLAUDE.md,
 * rung 5). `viem` is scheduled for the browser, where building and signing
 * transactions genuinely needs it.
 *
 * **The endpoint is never read out of a thrown error, logged, or interpolated
 * into anything.** A paid provider's URL carries its key in the query string,
 * and both a rejected `fetch` and a provider's own error body routinely echo
 * the URL that was called. Failures throw a message this file wrote, and
 * nothing from upstream travels with it — the same rule the Solana RPC module
 * follows, for the same reason.
 *
 * WHO CALLS THIS: `chain/robinhood/index.ts`, and nothing else.
 */

const TIMEOUT_MS = 12_000;

export async function evmCall(method: string, params: unknown[]): Promise<unknown> {
  const endpoints = evmRpcUrls();
  if (endpoints.length === 0) throw new Error("No Robinhood Chain RPC endpoint configured");

  let lastError: unknown = new Error(`RPC call ${method} was never attempted`);
  // Rotate endpoints so a single bad node does not eat every attempt. Sequential,
  // so attempts never multiply concurrent connections.
  for (const endpoint of endpoints) {
    try {
      return await callOnce(endpoint, method, params);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function callOnce(endpoint: string, method: string, params: unknown[]): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
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

/**
 * The timestamp of the block a transaction landed in, in seconds.
 *
 * `null` rather than a throw when the block is not readable: the callers treat
 * an unknown timestamp as a refusal, which is different from an RPC outage, and
 * collapsing the two would let a node problem look like a payer's mistake.
 */
export async function blockTimestampSeconds(blockNumberHex: string): Promise<number | null> {
  const block = (await evmCall("eth_getBlockByNumber", [blockNumberHex, false])) as
    | { timestamp?: string }
    | null;
  if (!block?.timestamp) return null;
  const seconds = Number(BigInt(block.timestamp));
  return Number.isFinite(seconds) ? seconds : null;
}

/** The chain's current block height, or null when it cannot be read. */
export async function currentBlockHeight(): Promise<bigint | null> {
  try {
    const result = await evmCall("eth_blockNumber", []);
    return typeof result === "string" ? BigInt(result) : null;
  } catch {
    // Fails closed at the caller: a raffle whose announced height could not be
    // computed must not be created with a guessed one.
    return null;
  }
}

/**
 * One block's hash and timestamp.
 *
 * Unlike Solana, an EVM chain has no holes: every height up to the head has a
 * block. So `null` here means "not reached yet" rather than "skipped", and the
 * anchor search handles both the same way — it keeps looking or reports that the
 * anchor has not arrived.
 *
 * WHO CALLS THIS: `chain/robinhood/index.ts`, as `blockAt` and through the
 * shared anchor search.
 */
export async function blockAtHeight(
  height: bigint,
): Promise<{ hash: string; timeMs: number } | null> {
  try {
    const block = (await evmCall("eth_getBlockByNumber", [
      `0x${height.toString(16)}`,
      false,
    ])) as { hash?: string; timestamp?: string } | null;
    if (typeof block?.hash !== "string" || !block.timestamp) return null;
    return { hash: block.hash, timeMs: Number(BigInt(block.timestamp)) * 1000 };
  } catch {
    return null;
  }
}
