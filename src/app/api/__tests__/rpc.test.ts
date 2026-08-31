import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxyRpc } from "../../../lib/rpc-proxy";

/**
 * The route wrapper at `/api/rpc/[chain]` only validates the chain segment and
 * hands over; every rule under test lives in the proxy, so these drive it
 * directly and name the chain themselves.
 */
const rpcRoute = (request: Request) => proxyRpc(request, "solana");

/**
 * The proxy the wallet adapter talks to instead of a Solana node directly.
 *
 * None of these tests touch the database — `identify()` never reads it, and
 * neither does this route. Every test drives the handler directly against a
 * stubbed `fetch`, so the suite stays fast and each assertion is about this
 * route's own logic, not the network.
 */

// x-forwarded-for, not cf-connecting-ip — see routes.test.ts for why: with
// TRUSTED_PLATFORM_HEADER unset, clientIp() reads x-forwarded-for, which is
// the header that keeps two distinct IPs genuinely distinct in this suite.
function post(body: unknown, ip = "1.2.3.4", extraHeaders: Record<string, string> = {}): Request {
  return new Request("https://nftraffle.example/api/rpc/solana", {
    method: "POST",
    headers: { "x-forwarded-for": ip, "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
}

function whitelistedCall(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { jsonrpc: "2.0", id: 1, method: "getLatestBlockhash", params: [], ...overrides };
}

/** Stubs `fetch` and hands back the mock so a test can inspect how it was called. */
function stubFetch(handler: (url: string, init: RequestInit) => unknown) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const result = handler(url, init);
    return {
      ok: true,
      status: 200,
      json: async () => result,
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * `SOLANA_RPC_URL` has no default in this project (payments/config.ts), so an
 * unconfigured deployment has no upstream and the route answers 503 before it
 * does anything else. Every test that expects a forward has to configure one —
 * which is the point of the guard, and is asserted directly further down.
 */
beforeEach(() => {
  process.env.SOLANA_RPC_URL = "https://mainnet.example/rpc?api-key=secret";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SOLANA_RPC_URL;
});

describe("POST /api/rpc", () => {
  it("forwards a whitelisted method", async () => {
    const fetchMock = stubFetch(() => ({ jsonrpc: "2.0", id: 1, result: "fake-blockhash" }));

    const response = await rpcRoute(post(whitelistedCall()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: 1, result: "fake-blockhash" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("forwards a whitelisted batch", async () => {
    const fetchMock = stubFetch((_url, init) => {
      const sent = JSON.parse(init.body as string);
      expect(Array.isArray(sent)).toBe(true);
      return [
        { jsonrpc: "2.0", id: 1, result: "fake-blockhash" },
        { jsonrpc: "2.0", id: 2, result: { context: {}, value: null } },
      ];
    });

    const response = await rpcRoute(
      post([whitelistedCall({ id: 1 }), whitelistedCall({ id: 2, method: "getAccountInfo" })]),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a method that is not whitelisted, without forwarding it", async () => {
    const fetchMock = stubFetch(() => ({}));

    const response = await rpcRoute(post(whitelistedCall({ method: "getProgramAccounts" })));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a batch containing a non-whitelisted method", async () => {
    const fetchMock = stubFetch(() => ({}));

    const response = await rpcRoute(
      post([whitelistedCall({ id: 1 }), whitelistedCall({ id: 2, method: "anythingAtAll" })]),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed JSON body, without forwarding it", async () => {
    const fetchMock = stubFetch(() => ({}));

    const response = await rpcRoute(
      new Request("https://nftraffle.example/api/rpc/solana", {
        method: "POST",
        headers: { "x-forwarded-for": "1.2.3.4", "content-type": "application/json" },
        body: "{not json",
      }),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caps the body size, without forwarding an oversized body", async () => {
    const fetchMock = stubFetch(() => ({}));

    const response = await rpcRoute(
      post(whitelistedCall({ params: ["x".repeat(50_000)] })),
    );

    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rate limits by ip_hash and fails closed without an address", async () => {
    const fetchMock = stubFetch(() => ({ jsonrpc: "2.0", id: 1, result: "fake-blockhash" }));
    const previousMax = process.env.RPC_RATE_LIMIT_MAX;
    process.env.RPC_RATE_LIMIT_MAX = "1";

    try {
      const ip = "9.9.9.9";
      const first = await rpcRoute(post(whitelistedCall(), ip));
      expect(first.status).toBe(200);

      const second = await rpcRoute(post(whitelistedCall(), ip));
      expect(second.status).toBe(429);

      // Only the first, allowed call ever reached the upstream stub.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      if (previousMax === undefined) delete process.env.RPC_RATE_LIMIT_MAX;
      else process.env.RPC_RATE_LIMIT_MAX = previousMax;
    }

    // Fails closed: with no trustworthy client address, identify() refuses
    // before the rate limiter or the whitelist is ever consulted.
    const previousAllow = process.env.ALLOW_UNTRUSTED_CLIENT_IP;
    delete process.env.ALLOW_UNTRUSTED_CLIENT_IP;
    try {
      const noAddress = await rpcRoute(
        new Request("https://nftraffle.example/api/rpc/solana", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(whitelistedCall()),
        }),
      );
      expect(noAddress.status).toBe(400);
    } finally {
      if (previousAllow === undefined) delete process.env.ALLOW_UNTRUSTED_CLIENT_IP;
      else process.env.ALLOW_UNTRUSTED_CLIENT_IP = previousAllow;
    }
  });

  it("never returns the upstream URL or key in an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(
          "fetch failed: connect ECONNREFUSED to https://paid-provider.example/?api-key=super-secret-key",
        );
      }),
    );

    const response = await rpcRoute(post(whitelistedCall(), "5.5.5.5"));
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(text).not.toContain("paid-provider.example");
    expect(text).not.toContain("super-secret-key");
    expect(text).not.toContain("api-key");
  });

  it("never returns the upstream URL or key from a non-2xx error body", async () => {
    // A paid provider's error body routinely echoes request context back —
    // including the very URL this endpoint exists to keep server-side. The
    // route must never even look at that content: a non-2xx status alone
    // is enough to answer generically, regardless of what the body says.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({
          error: "internal error contacting https://real-upstream.example/?api-key=REALKEY at line 5",
        }),
      })),
    );

    const response = await rpcRoute(post(whitelistedCall(), "8.8.8.1"));
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(text).not.toContain("real-upstream.example");
    expect(text).not.toContain("REALKEY");
    expect(text).not.toContain("api-key");
  });

  it("never returns the upstream URL or key from a 2xx JSON-RPC error member", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          error: {
            code: -32602,
            message: "Invalid params, see https://fake-provider.example/docs?api-key=FAKEKEY123",
          },
        }),
      })),
    );

    const response = await rpcRoute(post(whitelistedCall(), "8.8.8.2"));
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain("fake-provider.example");
    expect(text).not.toContain("FAKEKEY123");
    expect(text).not.toContain("api-key");
    // The caller still gets a JSON-RPC error entry — just a generic one.
    expect(await new Response(text).json()).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: expect.any(String) },
    });
  });

  it("never returns the upstream URL or key from a 200 that is not a JSON-RPC response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          // Valid JSON, 2xx status, but neither `result` nor `error`: not a
          // shape this proxy recognises as a JSON-RPC response.
          message: "see https://another-fake.example/?api-key=ANOTHERFAKEKEY for details",
        }),
      })),
    );

    const response = await rpcRoute(post(whitelistedCall(), "8.8.8.3"));
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(text).not.toContain("another-fake.example");
    expect(text).not.toContain("ANOTHERFAKEKEY");
    expect(text).not.toContain("api-key");
  });

  it("round-trips a legitimate success's result and id untouched", async () => {
    // The upstream's own id (999) is deliberately wrong, to prove the
    // response carries OUR caller's request id, not whatever upstream sent.
    stubFetch(() => ({
      jsonrpc: "2.0",
      id: 999,
      result: { context: { slot: 123 }, value: "fake-blockhash-xyz" },
    }));

    const response = await rpcRoute(post(whitelistedCall({ id: 42 }), "8.8.8.4"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: 42,
      result: { context: { slot: 123 }, value: "fake-blockhash-xyz" },
    });
  });

  it("does not forward client headers upstream", async () => {
    let sentHeaders: Headers | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sentHeaders = new Headers(init.headers);
        return {
          ok: true,
          status: 200,
          json: async () => ({ jsonrpc: "2.0", id: 1, result: "fake-blockhash" }),
        } as unknown as Response;
      }),
    );

    const response = await rpcRoute(
      post(whitelistedCall(), "6.6.6.6", {
        cookie: "pw_painter=super-secret-session",
        authorization: "Bearer should-not-leave-this-server",
        "x-forwarded-for": "6.6.6.6, 7.7.7.7",
      }),
    );

    expect(response.status).toBe(200);
    expect(sentHeaders).toBeDefined();
    expect(sentHeaders!.get("cookie")).toBeNull();
    expect(sentHeaders!.get("authorization")).toBeNull();
    expect(sentHeaders!.get("x-forwarded-for")).toBeNull();
    expect(sentHeaders!.get("content-type")).toBe("application/json");
  });

  it("refuses with 503 when this deployment has no Solana connection", async () => {
    // The sibling project defaulted to the public mainnet endpoint. This one
    // cannot: DAS methods are not served there, so a silent fallback would fail
    // the launchpad and raffle paths in a way that reads as a bug. Refusing is
    // the honest answer, and it happens before the caller is even identified —
    // there is nothing to meter access to.
    delete process.env.SOLANA_RPC_URL;
    const fetchMock = stubFetch(() => ({ jsonrpc: "2.0", id: 1, result: "should-not-happen" }));

    const response = await rpcRoute(post(whitelistedCall()));

    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never forwards a DAS method the whitelist does not name", async () => {
    // getSignaturesForAddress and getProgramAccounts both turn a metered,
    // method-limited proxy into a general-purpose indexer somebody else can
    // point their app at and we pay for.
    const fetchMock = stubFetch(() => ({ jsonrpc: "2.0", id: 1, result: [] }));

    for (const method of ["getProgramAccounts", "getSignaturesForAddress", "getTokenAccountsByOwner"]) {
      const response = await rpcRoute(post(whitelistedCall({ method })));
      expect(response.status, method).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the DAS methods the product actually needs", async () => {
    for (const method of ["getAsset", "getAssetsByOwner", "getAssetsByGroup", "getBlock"]) {
      const fetchMock = stubFetch(() => ({ jsonrpc: "2.0", id: 1, result: {} }));
      const response = await rpcRoute(post(whitelistedCall({ method })));
      expect(response.status, method).toBe(200);
      expect(fetchMock, method).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    }
  });
});

describe("the whitelist is PER CHAIN, not shared", () => {
  /**
   * The risk the per-chain route introduces, tested directly.
   *
   * One proxy serving two chains is only safe if the method lists stay
   * separate. A shared list would mean a caller could spend the Solana
   * provider's quota on `eth_call` — refused upstream, but paid for by us — and,
   * worse, that adding a method for one chain silently adds it for the other.
   */
  const robinhood = (request: Request) => proxyRpc(request, "robinhood");

  beforeEach(() => {
    process.env.SOLANA_RPC_URL = "https://rpc.example/solana";
    process.env.ROBINHOOD_RPC_URL = "https://rpc.example/robinhood";
  });

  it("refuses an EVM method on the Solana proxy", async () => {
    const response = await rpcRoute(
      new Request("https://nftraffle.example/api/rpc/solana", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [] }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("refuses a Solana method on the Robinhood proxy", async () => {
    const response = await robinhood(
      new Request("https://nftraffle.example/api/rpc/robinhood", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAsset", params: [] }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("refuses eth_sendRawTransaction, which would make this a public relay", async () => {
    // An EIP-1193 wallet submits through its own node, so nothing in this
    // product needs a send path here. Adding one would hand anybody a
    // transaction relay on our provider's bill.
    const response = await robinhood(
      new Request("https://nftraffle.example/api/rpc/robinhood", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: ["0x00"] }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("refuses eth_getLogs, which would make this an indexer", async () => {
    const response = await robinhood(
      new Request("https://nftraffle.example/api/rpc/robinhood", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{}] }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("control: a method that IS on the Robinhood list gets past the whitelist", async () => {
    // Without this, every assertion above would also pass against a proxy that
    // refused everything — which is the shape a broken check takes.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1234" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const response = await robinhood(
      new Request("https://nftraffle.example/api/rpc/robinhood", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      }),
    );
    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("refuses every chain that is not one of the two", async () => {
    // The route wrapper's job. A caller-named upstream is exactly what the
    // Solana-only version of this proxy warned against.
    const { POST } = await import("../rpc/[chain]/route");
    const response = await POST(
      new Request("https://nftraffle.example/api/rpc/ethereum", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ chain: "ethereum" }) } as never,
    );
    expect(response.status).toBe(404);
  });
});
