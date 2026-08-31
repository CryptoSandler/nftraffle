import { describe, expect, it } from "vitest";
import {
  checkAffordable,
  FALLBACK_SIGNATURE_FEE_LAMPORTS,
  readSimulation,
  solText,
} from "../preflight";

/**
 * The check that stops us handing Phantom a transaction it will refuse.
 *
 * **This is a wallet-behaviour problem, not a correctness one, and the tests are
 * written that way.** A failing payment was always safe — it costs the payer a
 * fee and settlement verifies the chain afterwards. What it was not was quiet:
 * Phantom simulates every transaction it is given, and one that cannot succeed
 * produces a red "this transaction may be malicious" screen, which a person
 * reads as a warning about the SITE. Routinely triggering it teaches our own
 * users to click through the warning that protects them.
 *
 * So every branch below is about what the person is TOLD, not only about
 * whether we refuse. Being refused with the wrong sentence is most of the
 * damage.
 */

const SOL = 1_000_000_000n;

describe("checkAffordable", () => {
  it("passes when the balance covers the amount and the fee", () => {
    expect(
      checkAffordable({ balanceLamports: SOL, amountLamports: SOL / 2n, feeLamports: 5_000n }),
    ).toEqual({ ok: true });
  });

  it("passes at exactly the amount plus the fee", () => {
    // The boundary is inclusive. Refusing here would tell somebody who has
    // precisely enough that they do not.
    expect(
      checkAffordable({ balanceLamports: SOL / 2n + 5_000n, amountLamports: SOL / 2n, feeLamports: 5_000n }),
    ).toEqual({ ok: true });
  });

  it("REFUSES when the balance covers the amount but not the fee", () => {
    // The case a naive check misses, and the one that actually happens: the
    // person funded their wallet with exactly the ticket price.
    const verdict = checkAffordable({
      balanceLamports: SOL / 2n,
      amountLamports: SOL / 2n,
      feeLamports: 5_000n,
    });
    expect(verdict).toMatchObject({ ok: false, reason: "insufficient_funds" });
  });

  it("names the SHORTFALL, in SOL, not the balance or the requirement", () => {
    // "You need 0.03 more SOL" is actionable. "Insufficient funds" is not, and
    // "balance 0.47, required 0.5" makes the reader do arithmetic while their
    // wallet is open.
    const verdict = checkAffordable({
      balanceLamports: 470_000_000n,
      amountLamports: 500_000_000n,
      feeLamports: 5_000n,
    });
    if (verdict.ok) throw new Error("expected a refusal");
    expect(verdict.message).toContain("0.030005");
    expect(verdict.message).toContain("more SOL");
  });

  it("refuses an empty wallet without dividing by anything", () => {
    expect(
      checkAffordable({ balanceLamports: 0n, amountLamports: 1n, feeLamports: 5_000n }),
    ).toMatchObject({ ok: false, reason: "insufficient_funds" });
  });
});

describe("readSimulation", () => {
  it("passes when the chain reports no error", () => {
    expect(readSimulation({ value: { err: null } })).toEqual({ ok: true });
  });

  it("REFUSES when the chain reports an error", () => {
    const verdict = readSimulation({ value: { err: { InstructionError: [0, "Custom"] } } });
    expect(verdict).toMatchObject({ ok: false, reason: "simulation_failed" });
  });

  it("says nothing was charged and no wallet was opened", () => {
    // The sentence is doing two jobs: explaining, and pre-empting the question
    // somebody asks when a payment screen closes by itself.
    const verdict = readSimulation({ value: { err: "anything" } });
    if (verdict.ok) throw new Error("expected a refusal");
    expect(verdict.message).toContain("Nothing has been charged");
    expect(verdict.message).toContain("no wallet has been opened");
  });

  it("treats an unreadable response as UNAVAILABLE, never as a pass", () => {
    /**
     * The most important branch in this file. A preflight that reads "I could
     * not tell" as "fine" is worse than no preflight at all: it produces exactly
     * the confident green light that sends somebody into the red Phantom screen
     * this exists to prevent.
     */
    for (const body of [null, undefined, {}, { value: null }, { value: "yes" }, 42, "ok"]) {
      expect(readSimulation(body), JSON.stringify(body)).toMatchObject({
        ok: false,
        reason: "rpc_unavailable",
      });
    }
  });

  it("distinguishes a failed simulation from an unreachable node", () => {
    // Different operational facts, different sentences. One means the payment
    // is wrong; the other means we do not know yet.
    expect(readSimulation({ value: { err: "x" } })).toMatchObject({ reason: "simulation_failed" });
    expect(readSimulation(null)).toMatchObject({ reason: "rpc_unavailable" });
  });
});

describe("solText", () => {
  it("renders lamports as a number a person recognises", () => {
    expect(solText(0n)).toBe("0");
    expect(solText(SOL)).toBe("1");
    expect(solText(SOL / 2n)).toBe("0.5");
    expect(solText(5_000n)).toBe("0.000005");
    expect(solText(30_005_000n)).toBe("0.030005");
  });

  it("never renders in scientific notation, however small", () => {
    // A shortfall shown as 5e-6 SOL is a shortfall nobody can act on.
    expect(solText(1n)).toBe("0.000000001");
    expect(solText(1n)).not.toContain("e");
  });
});

describe("the fallback fee", () => {
  it("is one signature at Solana's base rate", () => {
    // 5,000 lamports per signature, and this transaction carries exactly one —
    // the buyer's. Used only when getFeeForMessage fails, so a fee change
    // degrades this check rather than breaking it.
    expect(FALLBACK_SIGNATURE_FEE_LAMPORTS).toBe(5_000n);
  });
});
