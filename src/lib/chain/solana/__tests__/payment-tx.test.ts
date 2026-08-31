import { describe, expect, it } from "vitest";
import { buildTicketPaymentMessage } from "../payment-tx";

/**
 * Building the transfer a buyer signs.
 *
 * Two things here are load-bearing and neither is obvious from the happy path:
 * the reference account must be attached but never made a signer, and the
 * amount must be the one the server quoted rather than one the browser
 * recomputed.
 */

const PAYER = "6dNVEXCsBpisPjcyanBz4qgpm2SXPkR7wRPmuA6cxRLW";
const PAY_TO = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const REFERENCE = "8H1yMDsxDs52kZ8kmDzYWiCoTfxLZDvcqcMjxLdbBnRz";
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3teA9";

const base = {
  payer: PAYER,
  payTo: PAY_TO,
  amountLamports: 100_000_000n,
  blockhash: BLOCKHASH,
  lastValidBlockHeight: 300_000_000n,
};

describe("buildTicketPaymentMessage", () => {
  it("transfers the quoted amount from the payer to the payment wallet", () => {
    const message = buildTicketPaymentMessage({ ...base, reference: null });
    const instruction = message.instructions[0];

    const accounts = instruction.accounts?.map((a) => a.address) ?? [];
    expect(accounts).toContain(PAYER);
    expect(accounts).toContain(PAY_TO);
    expect(message.feePayer.address).toBe(PAYER);
  });

  it("attaches the reference as a READ-ONLY, NON-SIGNER account", () => {
    /**
     * THE SUBTLE PART. The reference is how a reconcile pass finds a payment
     * whose payer never came back — it has to be ON the transaction, in the
     * account list, so an RPC can search by it.
     *
     * It must NOT be a signer. Nobody holds its private key: this project
     * generates the keypair, reads out the public half, and discards the rest
     * (SECURITY.md I1). A transaction that required its signature could never
     * be signed by anyone, so the buyer's wallet would simply fail.
     */
    const message = buildTicketPaymentMessage({ ...base, reference: REFERENCE });
    const accounts = message.instructions[0].accounts ?? [];
    const ref = accounts.find((a) => a.address === REFERENCE);

    expect(ref).toBeDefined();
    // AccountRole.READONLY — not READONLY_SIGNER, not WRITABLE.
    expect(ref!.role).toBe(0);
  });

  it("omits the reference entirely when the chain has none", () => {
    // EVM returns null. An account list carrying a stray entry would change the
    // transaction for no reason.
    const message = buildTicketPaymentMessage({ ...base, reference: null });
    const accounts = message.instructions[0].accounts ?? [];
    expect(accounts.map((a) => a.address)).not.toContain(REFERENCE);
  });

  it("refuses a malformed address rather than building a transaction", () => {
    // A transaction built around a bad address either fails at the wallet, or
    // worse, succeeds against something unintended. Fail here, where the caller
    // still knows what it was doing.
    expect(() =>
      buildTicketPaymentMessage({ ...base, payTo: "not-an-address", reference: null }),
    ).toThrow();
  });

  it("refuses a non-positive amount", () => {
    expect(() =>
      buildTicketPaymentMessage({ ...base, amountLamports: 0n, reference: null }),
    ).toThrow(/amount/i);
  });

  it("carries the blockhash it was given, not one it fetched", () => {
    // The lifetime comes from the server's proxy through the caller. A builder
    // that fetched its own would be a second place the endpoint could leak.
    const message = buildTicketPaymentMessage({ ...base, reference: null });
    expect(message.lifetimeConstraint.blockhash).toBe(BLOCKHASH);
  });
});
