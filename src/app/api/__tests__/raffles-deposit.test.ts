import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createDraft } from "../raffles/route";
import { POST as deposit } from "../raffles/[slug]/deposit/route";
import { base58Decode, base58Encode } from "../../../lib/base58";
import { ed25519 } from "@noble/curves/ed25519.js";
import { cancelRaffleAsSeller, raffleBySlug } from "../../../lib/raffles/lifecycle";
import {
  apiRequest,
  assetRef,
  draftBody,
  healthyChain,
  stubChain,
  wallet,
  type Wallet,
} from "./listing-fixtures";

/**
 * The transaction a seller signs to pay the listing fee and deposit the prize.
 *
 * **The rule these tests exist to hold: we never hand a wallet a transaction
 * that fails simulation** (`docs/wallet-warnings.md`). Its ABSENCE from the
 * response is what stops the wallet opening — not a flag the browser could
 * misread — so every refusal below is asserted to carry no transaction at all.
 */

const ESCROW = base58Encode(ed25519.getPublicKey(ed25519.utils.randomSecretKey()));

beforeEach(() => {
  process.env.SOLANA_RPC_URL = "https://rpc.example/das?api-key=secret";
  process.env.ESCROW_WALLET_SOLANA = ESCROW;
  process.env.PAYMENT_WALLET_SOLANA = base58Encode(
    ed25519.getPublicKey(ed25519.utils.randomSecretKey()),
  );
  process.env.RAFFLE_LISTING_FEE_SOLANA = "0.01";
  process.env.HOUSE_FEE_BPS_SOLANA = "500";
  process.env.LISTING_RATE_LIMIT_MAX = "50";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LISTING_RATE_LIMIT_MAX;
});

/** Creates a draft the way the form does, and hands back its slug. */
async function draftFor(seller: Wallet): Promise<string> {
  const asset = assetRef();
  stubChain(healthyChain(seller.address));
  const response = await createDraft(apiRequest("/api/raffles", draftBody(seller, asset)));
  const created = await response.json();
  if (response.status !== 201) throw new Error(`draft failed: ${JSON.stringify(created)}`);
  return created.slug as string;
}

function depositRequest(slug: string) {
  return deposit(apiRequest(`/api/raffles/${slug}/deposit`, {}), {
    params: Promise.resolve({ slug }),
  } as never);
}

describe("the deposit transaction", () => {
  it("hands back one transaction for the fee and the prize together", async () => {
    const seller = wallet();
    const slug = await draftFor(seller);
    stubChain(healthyChain(seller.address));

    const response = await depositRequest(slug);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(typeof body.transaction).toBe("string");
    expect(body.transaction.length).toBeGreaterThan(0);
  });

  it("does not hand over a transaction the chain says would fail", async () => {
    const seller = wallet();
    const slug = await draftFor(seller);
    stubChain(
      healthyChain(seller.address, {
        simulateTransaction: { value: { err: { InstructionError: [0, "Custom"] }, logs: [] } },
      }),
    );

    const response = await depositRequest(slug);
    const body = await response.json();

    // The absence is the mechanism. A wallet opened on this transaction shows
    // the red screen that teaches people to click through red screens.
    expect(body.transaction).toBeUndefined();
    expect(body.error).toBeTruthy();
  });

  it("says what is missing when the seller cannot cover the fee", async () => {
    const seller = wallet();
    const slug = await draftFor(seller);
    stubChain(healthyChain(seller.address, { getBalance: { value: 1000 } }));

    const response = await depositRequest(slug);
    const body = await response.json();

    expect(body.transaction).toBeUndefined();
    // In SOL, which is the currency they recognise, and specific enough to act on.
    expect(body.error).toMatch(/SOL/);
  });

  it("refuses when the seller no longer holds the asset", async () => {
    const seller = wallet();
    const slug = await draftFor(seller);
    // Sold between drafting and depositing.
    stubChain(healthyChain(wallet().address));

    const response = await depositRequest(slug);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.transaction).toBeUndefined();
  });

  it("refuses once the raffle is no longer a draft", async () => {
    const seller = wallet();
    const slug = await draftFor(seller);
    // Moved by the transition that owns it, not by an UPDATE. The first attempt
    // at this test set `status = 'open'` directly and the schema refused it:
    // `raffles_open_is_escrowed` will not store an open raffle with no deposit.
    const raffle = await raffleBySlug(slug);
    await cancelRaffleAsSeller(raffle!.id, seller.address, "changed my mind");
    stubChain(healthyChain(seller.address));

    const response = await depositRequest(slug);

    expect(response.status).toBe(409);
  });

  it("names the escrow wallet as the new owner, from configuration", async () => {
    const seller = wallet();
    const slug = await draftFor(seller);
    const { fetchMock } = stubChain(healthyChain(seller.address));

    await depositRequest(slug);

    // The escrow address must reach the transaction from `payments/config.ts`
    // and nowhere else. Simulating something built from a body field would be
    // simulating a transfer to whatever the caller asked for.
    const simulated = fetchMock.mock.calls
      .map((call) => JSON.parse((call[1] as { body: string }).body))
      .find((call) => call.method === "simulateTransaction");
    const wire = Buffer.from(simulated.params[0], "base64").toString("hex");
    expect(wire).toContain(Buffer.from(base58Decode(ESCROW)!).toString("hex"));
  });
});
