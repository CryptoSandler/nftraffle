import { describe, expect, it } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha3_256 } from "@noble/hashes/sha3.js";
import {
  addressFromPublicKey,
  BINDING_VALIDITY_MS,
  payerBindingMessage,
  personalSignDigest,
  verifyPayerBinding,
  type BindingFields,
} from "../evm-binding";

/**
 * Proving an order's payer controls the address it names.
 *
 * **Two of these tests are anchored OUTSIDE this codebase, and that is the
 * point.** A signature scheme tested only against itself verifies happily while
 * agreeing with no wallet on earth — it would round-trip, reject tampering, and
 * fail the first time a person pressed Sign. So the hash function and the
 * address derivation are each checked against a published constant before
 * anything else is asserted.
 */

/** Anvil/Hardhat's first default account. Published in their docs for years. */
const KNOWN_KEY = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const KNOWN_ADDRESS = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

function sign(message: string, keyHex = KNOWN_KEY): string {
  const digest = personalSignDigest(message);
  // The recovery id travels beside the signature here and LAST in Ethereum's
  // encoding, offset by 27. Both spellings are accepted on the way back in —
  // there is a test for that, because wallets disagree.
  const signature = secp256k1.sign(digest, Uint8Array.from(Buffer.from(keyHex, "hex")), {
    prehash: false,
  });
  const body = Buffer.from(signature.toCompactRawBytes()).toString("hex");
  const v = (signature.recovery + 27).toString(16).padStart(2, "0");
  return `0x${body}${v}`;
}

const NOW = Date.parse("2026-09-01T12:00:00Z");

function fields(over: Partial<BindingFields> = {}): BindingFields {
  return {
    domain: "nftraffle.example",
    address: KNOWN_ADDRESS,
    slug: "prize-abc",
    chainId: 46630,
    nonce: "a1b2c3d4",
    issuedAt: new Date(NOW).toISOString(),
    ...over,
  };
}

function verify(over: Partial<BindingFields> = {}, sigOver?: string, nowMs = NOW) {
  const f = fields(over);
  return verifyPayerBinding({
    signature: sigOver ?? sign(payerBindingMessage(f)),
    fields: f,
    expectedDomain: "nftraffle.example",
    expectedSlug: "prize-abc",
    expectedChainId: 46630,
    nowMs,
  });
}

describe("the primitives agree with the rest of Ethereum", () => {
  it("hashes with keccak-256, not SHA3-256", () => {
    // The canonical empty-string keccak. These two functions differ only in a
    // padding byte, produce different digests for every input, and picking the
    // wrong one is the classic way an implementation verifies against itself
    // and nothing else.
    expect(Buffer.from(keccak_256(new Uint8Array())).toString("hex")).toBe(
      "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
    expect(Buffer.from(sha3_256(new Uint8Array())).toString("hex")).not.toBe(
      "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
  });

  it("derives the published address from the published private key", () => {
    const pub = secp256k1.getPublicKey(Uint8Array.from(Buffer.from(KNOWN_KEY, "hex")), false);
    expect(addressFromPublicKey(pub)).toBe(KNOWN_ADDRESS);
  });

  it("uses the EIP-191 prefix with a BYTE length, not a character count", () => {
    // A message with any non-ASCII in it hashes differently under the two
    // readings, and a wallet uses bytes. Asserted by construction rather than
    // by a magic digest.
    const message = "héllo";
    const bytes = new TextEncoder().encode(message);
    expect(bytes.length).toBe(6);
    expect(message.length).toBe(5);
    const expected = keccak_256(
      Uint8Array.from(Buffer.concat([
        Buffer.from(`\x19Ethereum Signed Message:\n${bytes.length}`, "utf8"),
        Buffer.from(bytes),
      ])),
    );
    expect(Buffer.from(personalSignDigest(message))).toEqual(Buffer.from(expected));
  });
});

describe("verifyPayerBinding", () => {
  it("accepts a signature the named address really made", () => {
    expect(verify()).toEqual({ ok: true, address: KNOWN_ADDRESS });
  });

  it("REFUSES a signature made by a different key", () => {
    // The whole point: an order may name an address only if its holder said so.
    const other = "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    const f = fields();
    expect(verify({}, sign(payerBindingMessage(f), other))).toEqual({
      ok: false,
      reason: "address_mismatch",
    });
  });

  it("REFUSES a signature for a DIFFERENT raffle", () => {
    // Rebuilt, never parsed: signing for one raffle must not open an order on
    // another, and a substring check would let it.
    const signed = sign(payerBindingMessage(fields({ slug: "some-other-raffle" })));
    expect(verify({}, signed)).toEqual({ ok: false, reason: "address_mismatch" });
  });

  it("REFUSES a signature taken on a different site", () => {
    expect(verify({ domain: "evil.example" })).toEqual({ ok: false, reason: "wrong_domain" });
  });

  it("REFUSES a signature for a different chain", () => {
    // A testnet signature must not bind a mainnet order.
    expect(verify({ chainId: 4663 })).toEqual({ ok: false, reason: "wrong_chain" });
  });

  it("REFUSES a stale signature, and a future-dated one too", () => {
    // Future-dated matters: without it a signature could be minted now and held
    // indefinitely against a later order.
    expect(verify({}, undefined, NOW + BINDING_VALIDITY_MS + 1_000)).toMatchObject({
      ok: false,
      reason: "expired",
    });
    expect(verify({}, undefined, NOW - BINDING_VALIDITY_MS - 1_000)).toMatchObject({
      ok: false,
      reason: "expired",
    });
  });

  it("accepts both v=27/28 and v=0/1, which wallets disagree about", () => {
    const f = fields();
    const raw = sign(payerBindingMessage(f));
    const v = Number.parseInt(raw.slice(-2), 16);
    const flipped = `${raw.slice(0, -2)}${(v - 27).toString(16).padStart(2, "0")}`;
    expect(verify({}, flipped)).toEqual({ ok: true, address: KNOWN_ADDRESS });
  });

  it("REFUSES a malformed signature rather than throwing", () => {
    // These arrive from a browser. A 500 on a hostile string is a bug.
    for (const bad of ["", "0x", "not a signature", `0x${"aa".repeat(65)}ff`, `0x${"00".repeat(65)}`]) {
      expect(verify({}, bad).ok, bad).toBe(false);
    }
  });

  it("REFUSES a nonce that is not a nonce", () => {
    for (const nonce of ["", "short", "zz".repeat(8), "a".repeat(200)]) {
      expect(verify({ nonce }).ok, nonce).toBe(false);
    }
  });

  it("is case-insensitive about the claimed address, as EIP-55 requires", () => {
    // Checksummed and lowercase spellings are the same address; refusing on
    // case would reject real wallets.
    const checksummed = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    const f = fields({ address: checksummed });
    expect(verify({ address: checksummed }, sign(payerBindingMessage(f)))).toMatchObject({ ok: true });
  });

  it("puts the address, raffle and chain in the text a person is shown", () => {
    // A signing prompt whose fields are not in the visible text is one nobody
    // can refuse meaningfully.
    const text = payerBindingMessage(fields());
    expect(text).toContain(KNOWN_ADDRESS);
    expect(text).toContain("prize-abc");
    expect(text).toContain("46630");
    expect(text).toContain("does not move any funds");
  });
});
