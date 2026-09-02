import { ed25519 } from "@noble/curves/ed25519.js";
import { vi } from "vitest";
import { base58Encode } from "../../../lib/base58";
import { sellerBindingMessage, type SellerBindingFields } from "../../../lib/wallet/solana-binding";

/**
 * Fixtures for the listing flow's route tests, shared by the draft tests and
 * the deposit tests because both need a signing wallet and a stubbed chain.
 *
 * Test-only: nothing under `src/lib` or `src/app` imports this.
 */

export const HOST = "nftraffle.example";

export function wallet() {
  const secretKey = ed25519.utils.randomSecretKey();
  const address = base58Encode(ed25519.getPublicKey(secretKey));
  return {
    address,
    sign: (message: string) =>
      base58Encode(ed25519.sign(new TextEncoder().encode(message), secretKey)),
  };
}

export type Wallet = ReturnType<typeof wallet>;

/** A 32-byte base58 string, which is what a Solana mint looks like. */
export function assetRef(): string {
  return base58Encode(ed25519.getPublicKey(ed25519.utils.randomSecretKey()));
}

export function binding(seller: Wallet, prizeAsset: string, over: Partial<SellerBindingFields> = {}) {
  const fields: SellerBindingFields = {
    domain: HOST,
    address: seller.address,
    chain: "solana",
    prizeAsset,
    nonce: "a1b2c3d4",
    issuedAt: new Date().toISOString(),
    ...over,
  };
  return { signature: seller.sign(sellerBindingMessage(fields)), fields };
}

export function draftBody(seller: Wallet, asset: string, over: Record<string, unknown> = {}) {
  return {
    chain: "solana",
    prizeAsset: asset,
    ticketPrice: "0.05",
    maxTickets: 10,
    durationMinutes: 60,
    binding: binding(seller, asset),
    ...over,
  };
}

export function apiRequest(path: string, body: unknown, ip = "1.2.3.4"): Request {
  return new Request(`https://${HOST}${path}`, {
    method: "POST",
    headers: { "x-forwarded-for": ip, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * A Solana node, answering by method name.
 *
 * Every RPC this flow makes goes through one endpoint, so the stub dispatches on
 * the JSON-RPC method rather than on the URL. An unstubbed method throws by
 * name, which is what turns "the code called something we did not expect" into
 * a readable failure instead of a null dereference three frames later.
 */
export function stubChain(answers: Record<string, unknown>) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (_url: string, init: { body?: string }) => {
    const method = JSON.parse(init.body ?? "{}").method as string;
    calls.push(method);
    if (!(method in answers)) throw new Error(`unstubbed RPC method: ${method}`);
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: answers[method] }),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

/** The happy-path answers: the seller holds the asset and the chain is healthy. */
export function healthyChain(owner: string, over: Record<string, unknown> = {}) {
  return {
    getAsset: { id: "", ownership: { owner }, grouping: [] },
    getLatestBlockhash: {
      value: { blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 500 },
    },
    getBalance: { value: 5_000_000_000 },
    getFeeForMessage: { value: 5000 },
    simulateTransaction: { value: { err: null, logs: [] } },
    ...over,
  };
}
