import { describe, expect, it } from "vitest";
import { checkDeployedLaunch } from "../verify";

/**
 * The check that makes the platform's mint fee true rather than intended.
 *
 * **Spec §5.3 step 4, and §0.1 is why it exists.** The creator assembles and
 * signs the launch transaction. The transaction this server built is therefore
 * a suggestion: what matters is the account that ended up on chain. Every case
 * below is a machine that would look fine on our own page and charge us
 * nothing.
 */

const PAYMENT = "6eyg2zyaHX4FXGJLD1nsnmmjexH9vif2veyXt1MbNpYa";
const CREATOR = "F7FfSamtLjDwEx4cpHDV6EqtYjXf8HMDyiF98FbNogXE";
const COLLECTION = "54AtbSXjVhYVxXSsUPh6PZ9S8UxeSGWHA7GDatpGSCyL";

function check(over: Partial<Parameters<typeof checkDeployedLaunch>[0]["deployed"]> = {}, expectedOver = {}) {
  return checkDeployedLaunch({
    deployed: {
      itemsAvailable: 100n,
      itemsRedeemed: 0n,
      collection: COLLECTION,
      authority: CREATOR,
      fee: { destination: PAYMENT, lamports: 1_500_000n },
      price: { destination: CREATOR, lamports: 50_000_000n },
      startsAtMs: 1_788_318_362_000,
      ...over,
    },
    expected: {
      collection: COLLECTION,
      creator: CREATOR,
      paymentWallet: PAYMENT,
      itemsAvailable: 100,
      mintFeeNative: 1_500_000n,
      priceNative: 50_000_000n,
      ...expectedOver,
    },
  });
}

describe("what the chain has to agree with before a collection goes live", () => {
  it("accepts the machine this server built", () => {
    expect(check()).toEqual({ ok: true });
  });

  it("REFUSES a machine with no platform fee guard at all", () => {
    // The whole attack in one line: the creator drops `solFixedFee` from the
    // transaction and mints for free forever.
    expect(check({ fee: null })).toMatchObject({ ok: false, reason: "no_fee_guard" });
  });

  it("REFUSES a fee guard that pays somebody else", () => {
    expect(check({ fee: { destination: CREATOR, lamports: 1_500_000n } })).toMatchObject({
      ok: false,
      reason: "fee_wrong_destination",
    });
  });

  it("REFUSES a fee guard set below what the collection was quoted at", () => {
    expect(check({ fee: { destination: PAYMENT, lamports: 1n } })).toMatchObject({
      ok: false,
      reason: "fee_too_small",
    });
  });

  it("accepts a fee guard set ABOVE the quote", () => {
    // Generosity is not an attack, and refusing it would be this project
    // insisting on a number rather than on a minimum.
    expect(check({ fee: { destination: PAYMENT, lamports: 2_000_000n } })).toEqual({ ok: true });
  });

  it("REFUSES a machine whose collection is not the one we drafted", () => {
    expect(check({ collection: PAYMENT })).toMatchObject({ ok: false, reason: "wrong_collection" });
  });

  it("REFUSES a price that does not match the page", () => {
    // The mint page quotes this number. A machine that charges more than the
    // page says is this site lying to a minter on a creator's behalf.
    expect(check({ price: { destination: CREATOR, lamports: 90_000_000n } })).toMatchObject({
      ok: false,
      reason: "wrong_price",
    });
  });

  it("REFUSES a price paid to a wallet the page does not name", () => {
    expect(check({ price: { destination: PAYMENT, lamports: 50_000_000n } })).toMatchObject({
      ok: false,
      reason: "price_wrong_destination",
    });
  });

  it("REFUSES a supply that does not match the draft", () => {
    expect(check({ itemsAvailable: 10_000n })).toMatchObject({ ok: false, reason: "wrong_supply" });
  });

  it("REFUSES a machine that was already minted from before it was published", () => {
    // A machine with mints on it was live somewhere else first. Publishing it
    // here would show a supply that is already partly gone as untouched.
    expect(check({ itemsRedeemed: 3n })).toMatchObject({ ok: false, reason: "already_minted" });
  });
});
