import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign as opensslSign } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58Encode } from "../../base58";
import { BINDING_VALIDITY_MS } from "../evm-binding";
import {
  sellerBindingMessage,
  verifySellerBinding,
  type SellerBindingFields,
} from "../solana-binding";

/**
 * Proving that whoever opens a draft controls the wallet it names as seller.
 *
 * **The first test is anchored OUTSIDE this codebase, and that is the point.**
 * A signature scheme tested only against its own signer verifies happily while
 * agreeing with no wallet on earth: it round-trips, it rejects tampering, and
 * it fails the first time a person presses Sign in Phantom. So the first thing
 * asserted is that a signature made by OpenSSL — a different implementation,
 * shipped with Node, that has never seen this repository — verifies through our
 * path. `@noble/curves` verifying `@noble/curves` proves nothing about that.
 */

/** An ed25519 keypair from OpenSSL, in the shape a Solana wallet hands over. */
function opensslWallet() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  // JWK's `x` is the raw 32-byte public key, base64url. For ed25519 the Solana
  // address IS that key in base58 — there is no hashing step, unlike Ethereum.
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url");
  return {
    address: base58Encode(new Uint8Array(raw)),
    sign: (message: string) =>
      base58Encode(new Uint8Array(opensslSign(null, Buffer.from(message, "utf8"), privateKey))),
  };
}

/** The same, from the library we verify with. Used for the tests OpenSSL does not need to witness. */
function nobleWallet() {
  const secretKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(secretKey);
  return {
    address: base58Encode(publicKey),
    sign: (message: string) =>
      base58Encode(ed25519.sign(new TextEncoder().encode(message), secretKey)),
  };
}

const NOW = Date.parse("2026-09-01T12:00:00Z");
const DOMAIN = "nftraffle.example";
const ASSET = "5rzKZDLLbaHwZKQq5rzKZDLLbaHwZKQq5rzKZDLLbaHw";

function fields(over: Partial<SellerBindingFields> = {}): SellerBindingFields {
  return {
    domain: DOMAIN,
    address: "",
    chain: "solana",
    prizeAsset: ASSET,
    nonce: "a1b2c3d4",
    issuedAt: new Date(NOW).toISOString(),
    ...over,
  };
}

/** Signs the exact message these fields produce, then verifies it as the route would. */
function roundTrip(
  wallet: { address: string; sign: (m: string) => string },
  over: Partial<SellerBindingFields> = {},
  opts: { signature?: string; nowMs?: number; expectedAsset?: string } = {},
) {
  const f = fields({ address: wallet.address, ...over });
  return verifySellerBinding({
    signature: opts.signature ?? wallet.sign(sellerBindingMessage(f)),
    fields: f,
    expectedDomain: DOMAIN,
    expectedChain: "solana",
    expectedAsset: opts.expectedAsset ?? ASSET,
    nowMs: opts.nowMs ?? NOW,
  });
}

describe("the scheme agrees with an implementation that is not ours", () => {
  it("accepts a signature made by OpenSSL", () => {
    const wallet = opensslWallet();

    const result = roundTrip(wallet);

    expect(result).toEqual({ ok: true, address: wallet.address });
  });
});

describe("what the signature has to be over", () => {
  it("refuses a signature made by a different wallet", () => {
    const claimed = nobleWallet();
    const other = nobleWallet();
    const message = sellerBindingMessage(fields({ address: claimed.address }));

    const result = roundTrip(claimed, {}, { signature: other.sign(message) });

    expect(result).toEqual({ ok: false, reason: "address_mismatch" });
  });

  it("refuses a signature for a different asset", () => {
    const wallet = nobleWallet();

    // Signed honestly, for an asset that is not the one being listed.
    const result = roundTrip(wallet, { prizeAsset: "11111111111111111111111111111111" });

    expect(result).toEqual({ ok: false, reason: "wrong_asset" });
  });

  it("refuses a signature taken for another site", () => {
    const wallet = nobleWallet();

    const result = roundTrip(wallet, { domain: "phishing.example" });

    expect(result).toEqual({ ok: false, reason: "wrong_domain" });
  });

  it("refuses a signature for another chain", () => {
    const wallet = nobleWallet();

    const result = roundTrip(wallet, { chain: "robinhood" });

    expect(result).toEqual({ ok: false, reason: "wrong_chain" });
  });

  it("refuses a message whose text was altered after signing", () => {
    const wallet = nobleWallet();
    const honest = sellerBindingMessage(fields({ address: wallet.address }));

    // The signature is real; the fields it is checked against are not the ones
    // that were signed. Rebuilding the message server-side is what catches it.
    const result = roundTrip(wallet, { nonce: "ffffffff" }, { signature: wallet.sign(honest) });

    expect(result).toEqual({ ok: false, reason: "address_mismatch" });
  });
});

describe("the window", () => {
  it("accepts a signature made just inside the window", () => {
    const wallet = nobleWallet();

    const result = roundTrip(wallet, {}, { nowMs: NOW + BINDING_VALIDITY_MS - 1 });

    expect(result.ok).toBe(true);
  });

  it("refuses a signature older than the window", () => {
    const wallet = nobleWallet();

    const result = roundTrip(wallet, {}, { nowMs: NOW + BINDING_VALIDITY_MS + 1 });

    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a signature issued in the future", () => {
    const wallet = nobleWallet();

    // Minted now and held: as wrong as a stale one, and worth more to an
    // attacker, so the window is checked in both directions.
    const result = roundTrip(wallet, {}, { nowMs: NOW - BINDING_VALIDITY_MS - 1 });

    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses an unparseable issuedAt", () => {
    const wallet = nobleWallet();

    const result = roundTrip(wallet, { issuedAt: "yesterday" });

    expect(result).toEqual({ ok: false, reason: "bad_message" });
  });
});

describe("what is refused before any curve arithmetic happens", () => {
  it("refuses a signature that is not base58", () => {
    const wallet = nobleWallet();

    const result = roundTrip(wallet, {}, { signature: "0x" + "ab".repeat(64) });

    expect(result).toEqual({ ok: false, reason: "malformed_signature" });
  });

  it("refuses a signature that is not 64 bytes", () => {
    const wallet = nobleWallet();

    const result = roundTrip(wallet, {}, { signature: base58Encode(new Uint8Array(63)) });

    expect(result).toEqual({ ok: false, reason: "malformed_signature" });
  });

  it("refuses an address that is not a 32-byte base58 key", () => {
    const wallet = nobleWallet();

    const result = roundTrip(wallet, { address: "not-an-address" });

    expect(result).toEqual({ ok: false, reason: "bad_message" });
  });

  it("refuses a nonce that is not 8 to 64 hex characters", () => {
    const wallet = nobleWallet();

    const result = roundTrip(wallet, { nonce: "short" });

    expect(result).toEqual({ ok: false, reason: "bad_message" });
  });
});

describe("the text a person is asked to sign", () => {
  it("states that nothing is being spent, and names the asset and the site", () => {
    const message = sellerBindingMessage(fields({ address: "SELLER" }));

    // A prompt full of fields with no sentence is one people click through.
    expect(message).toContain("does not move any funds");
    expect(message).toContain(DOMAIN);
    expect(message).toContain(`Asset: ${ASSET}`);
    expect(message).toContain("Address: SELLER");
  });
});
