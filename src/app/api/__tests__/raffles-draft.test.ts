import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../raffles/route";
import { queryOne } from "../../../lib/db";
import { sellerBindingMessage } from "../../../lib/wallet/solana-binding";
import {
  apiRequest,
  assetRef,
  binding,
  draftBody,
  healthyChain,
  stubChain,
  wallet,
} from "./listing-fixtures";

/**
 * Opening a raffle draft, driven through the route rather than through
 * `createDraft`.
 *
 * **These are wiring tests and that is the whole point of them.** A unit test
 * of `verifySellerBinding` passes just as happily when nothing calls it — which
 * is the failure CLAUDE.md describes, and the one that shipped two finished,
 * tested, uncalled functions in the sibling project. Every test here drives
 * `POST /api/raffles` and asserts the effect; each one is falsified by deleting
 * the call it is about from the route.
 */

/** Everything below drives the real route; the wallet and the chain are fixtures. */
function draftRequest(body: unknown, ip = "1.2.3.4"): Request {
  return apiRequest("/api/raffles", body, ip);
}

function stubOwner(owner: string) {
  return stubChain(healthyChain(owner)).fetchMock;
}

beforeEach(() => {
  process.env.SOLANA_RPC_URL = "https://rpc.example/das?api-key=secret";
  process.env.ESCROW_WALLET_SOLANA = assetRef();
  process.env.PAYMENT_WALLET_SOLANA = assetRef();
  process.env.RAFFLE_LISTING_FEE_SOLANA = "0.01";
  process.env.HOUSE_FEE_BPS_SOLANA = "500";
  process.env.LISTING_RATE_LIMIT_MAX = "50";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LISTING_RATE_LIMIT_MAX;
});

const body = draftBody;

describe("a draft names a seller only when that seller signed for it", () => {
  it("creates the draft when the binding is good", async () => {
    const seller = wallet();
    const asset = assetRef();
    stubOwner(seller.address);

    const response = await POST(draftRequest(body(seller, asset)));
    const created = await response.json();

    expect(response.status).toBe(201);
    const row = await queryOne<{ seller_wallet: string }>(
      `SELECT seller_wallet FROM raffles WHERE slug = $1`,
      [created.slug],
    );
    // Derived from the signature, not copied from a field the caller filled in.
    expect(row?.seller_wallet).toBe(seller.address);
  });

  it("refuses a draft that carries no binding at all", async () => {
    const seller = wallet();
    const asset = assetRef();
    stubOwner(seller.address);

    const response = await POST(
      draftRequest({ ...body(seller, asset), binding: undefined, sellerWallet: seller.address }),
    );

    expect(response.status).toBe(400);
  });

  it("refuses a binding signed by a wallet other than the one it names", async () => {
    const seller = wallet();
    const impostor = wallet();
    const asset = assetRef();
    stubOwner(seller.address);
    const forged = binding(seller, asset);
    // The fields still name the real seller; the signature is somebody else's.
    forged.signature = impostor.sign(sellerBindingMessage(forged.fields));

    const response = await POST(draftRequest({ ...body(seller, asset), binding: forged }));
    const refusal = await response.json();

    expect(response.status).toBe(400);
    expect(refusal.reason).toBe("address_mismatch");
  });

  it("refuses a binding signed for a different asset than the draft lists", async () => {
    const seller = wallet();
    const listed = assetRef();
    stubOwner(seller.address);

    const response = await POST(
      draftRequest({ ...body(seller, listed), binding: binding(seller, assetRef()) }),
    );
    const refusal = await response.json();

    expect(response.status).toBe(400);
    expect(refusal.reason).toBe("wrong_asset");
  });

  it("refuses a body whose sellerWallet contradicts the wallet that signed", async () => {
    const seller = wallet();
    const asset = assetRef();
    stubOwner(seller.address);

    const response = await POST(
      draftRequest({ ...body(seller, asset), sellerWallet: wallet().address }),
    );

    expect(response.status).toBe(400);
  });
});

describe("the asset itself", () => {
  it("refuses a draft for an asset that has been burned", async () => {
    const seller = wallet();
    const asset = assetRef();
    // DAS keeps answering `ownership.owner` for a burnt Core asset, so the
    // ownership check alone accepts it. The devnet e2e on 2026-09-01 listed one
    // by accident and only found out at the deposit, where the transfer failed
    // simulation with Core's `IncorrectAccount` — by which point the draft had
    // taken the asset's listing slot.
    stubChain({
      ...healthyChain(seller.address),
      getAsset: { id: asset, ownership: { owner: seller.address }, burnt: true, grouping: [] },
    });

    const response = await POST(draftRequest(body(seller, asset)));
    const refusal = await response.json();

    expect(response.status).toBe(409);
    expect(refusal.error).toMatch(/burn/i);
  });
});

describe("what a refusal costs us", () => {
  it("does not read the chain when the binding is bad", async () => {
    const seller = wallet();
    const asset = assetRef();
    const fetchMock = stubOwner(seller.address);
    const forged = binding(seller, asset);
    forged.signature = wallet().sign(sellerBindingMessage(forged.fields));

    // `sellerWallet` is sent and valid, so the route has everything it needs to
    // reach the chain — the binding is the only thing wrong. Without that, this
    // test would pass on a route that refuses for an unrelated reason.
    await POST(
      draftRequest({ ...body(seller, asset), binding: forged, sellerWallet: seller.address }),
    );

    // The DAS read is billed by a provider and the signature check is local
    // arithmetic. Cheap before expensive, or an unsigned request can spend our
    // RPC budget for free.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the rate limit", () => {
  it("refuses further attempts from an address that has made too many", async () => {
    process.env.LISTING_RATE_LIMIT_MAX = "2";
    const seller = wallet();
    stubOwner(seller.address);

    const first = await POST(draftRequest(body(seller, assetRef()), "9.9.9.9"));
    const second = await POST(draftRequest(body(seller, assetRef()), "9.9.9.9"));
    const third = await POST(draftRequest(body(seller, assetRef()), "9.9.9.9"));

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBeTruthy();
  });

  it("counts per address, so one caller cannot exhaust another's allowance", async () => {
    process.env.LISTING_RATE_LIMIT_MAX = "1";
    const seller = wallet();
    stubOwner(seller.address);

    await POST(draftRequest(body(seller, assetRef()), "9.9.9.9"));
    const other = await POST(draftRequest(body(seller, assetRef()), "8.8.8.8"));

    expect(other.status).toBe(201);
  });
});
