import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { payerBindingMessage, verifyPayerBinding } from "../evm-binding";

/**
 * OUR EIP-191 SIGNING, CHECKED AGAINST SOMEBODY ELSE'S IMPLEMENTATION.
 *
 * `evm-binding.test.ts` anchors the pieces — keccak against the published
 * empty-string digest, address derivation against a published key/address pair
 * — but every whole SIGNATURE it verifies is one it also produced. That is
 * self-consistency, and a scheme can be perfectly self-consistent while agreeing
 * with no wallet on earth: it would round-trip, reject tampering, and fail the
 * first time a person pressed Sign in Phantom or MetaMask.
 *
 * Foundry's `cast wallet sign` is an independent implementation of the same
 * standard. If our verifier accepts what it produces, the two agree.
 *
 * **Skipped, not failed, when `cast` is absent.** It is a machine prerequisite
 * (`docs/deploy.md` §0) rather than a project dependency, and a suite that goes
 * red on a machine without Foundry teaches people to ignore it.
 */

function hasCast(): boolean {
  for (const bin of ["cast", `${process.env.HOME}/.foundry/bin/cast`]) {
    try {
      execFileSync(bin, ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      /* try the next */
    }
  }
  return false;
}

function castPath(): string {
  try {
    execFileSync("cast", ["--version"], { stdio: "ignore" });
    return "cast";
  } catch {
    return `${process.env.HOME}/.foundry/bin/cast`;
  }
}

const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const fields = {
  domain: "localhost:3000",
  address: ADDRESS,
  slug: "concentric-no-2",
  chainId: 46630,
  nonce: "a1b2c3d4e5f60718",
  issuedAt: new Date().toISOString(),
};

describe.skipIf(!hasCast())("cast wallet sign and our verifier agree", () => {
  it("accepts a signature made by Foundry, and recovers the right address", () => {
    const signature = execFileSync(
      castPath(),
      ["wallet", "sign", "--private-key", KEY, payerBindingMessage(fields)],
      { encoding: "utf8" },
    ).trim();

    const verdict = verifyPayerBinding({
      signature,
      fields,
      expectedDomain: fields.domain,
      expectedSlug: fields.slug,
      expectedChainId: fields.chainId,
      nowMs: Date.now(),
    });

    expect(verdict).toEqual({ ok: true, address: ADDRESS.toLowerCase() });
  });

  it("still refuses a Foundry signature of a DIFFERENT message", () => {
    // The control: without it, a verifier that accepted everything would pass
    // the case above.
    const signature = execFileSync(
      castPath(),
      ["wallet", "sign", "--private-key", KEY, payerBindingMessage({ ...fields, slug: "another-raffle" })],
      { encoding: "utf8" },
    ).trim();

    expect(
      verifyPayerBinding({
        signature,
        fields,
        expectedDomain: fields.domain,
        expectedSlug: fields.slug,
        expectedChainId: fields.chainId,
        nowMs: Date.now(),
      }),
    ).toMatchObject({ ok: false, reason: "address_mismatch" });
  });
});
