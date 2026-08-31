import { describe, expect, it } from "vitest";
import { generateReference } from "../reference";
import { base58Decode } from "../../../base58";

/**
 * The Solana Pay reference key.
 *
 * Moved here from the ticket tests when the chain seam was cut: a reference key
 * is a Solana Pay convention, not a property of raffles. EVM has no equivalent
 * and its adapter returns null.
 */
describe("generateReference", () => {
  it("is a 32-byte base58 public key", async () => {
    const reference = await generateReference();
    expect(reference).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(base58Decode(reference)?.length).toBe(32);
  });

  it("never repeats", async () => {
    // It rides on a public transaction and is how a reconcile pass finds a
    // payment whose payer never came back. A repeat would match one payment to
    // two orders.
    const seen = new Set(await Promise.all(Array.from({ length: 25 }, () => generateReference())));
    expect(seen.size).toBe(25);
  });

  it("returns only the public half", async () => {
    /**
     * THE INVARIANT THIS FUNCTION EXISTS TO KEEP (SECURITY.md I1). The private
     * key is generated, never exported, and falls out of scope. What comes back
     * is 32 bytes — a public key — not the 64 a secret key would be.
     */
    const decoded = base58Decode(await generateReference());
    expect(decoded?.length).toBe(32);
    expect(decoded?.length).not.toBe(64);
  });
});
