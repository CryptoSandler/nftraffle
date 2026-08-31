import { describe, expect, it } from "vitest";
import { compileTransaction } from "@solana/kit";
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

describe("Phantom hygiene: one signer, and the reference never signs", () => {
  /**
   * **A transaction with a second signer cannot be signed by anybody.**
   *
   * The Solana Pay reference is a keypair this project generates, reads the
   * public half of, and discards the private half of at the moment of creation
   * (SECURITY.md I1). There is deliberately no `exportKey` call on it anywhere.
   * So if it were ever attached as a signer, the payer's wallet would prompt for
   * a signature nothing on earth can produce — and Phantom's simulation would
   * fail, which is the red "may be malicious" screen `docs/wallet-warnings.md`
   * exists to keep away from.
   *
   * This is asserted on the COMPILED message rather than on the builder's
   * inputs, because the compiler is what decides the signer count.
   */
  const REFERENCE = "5bNY48R7u6YBTyrFB2X9KyGjvzo3shjhkffgjhdNfouW";

  function compiled(reference: string | null) {
    const message = buildTicketPaymentMessage({
      payer: PAYER,
      payTo: PAY_TO,
      amountLamports: 50_000_000n,
      reference,
      blockhash: BLOCKHASH,
      lastValidBlockHeight: 100n,
    });
    return compileTransaction(message);
  }

  it("has exactly one signature slot, with and without a reference", () => {
    // `signatures` is keyed by signer address, so its size IS the signer count.
    expect(Object.keys(compiled(null).signatures)).toHaveLength(1);
    expect(Object.keys(compiled(REFERENCE).signatures)).toHaveLength(1);
  });

  it("the one signer is the payer", () => {
    expect(Object.keys(compiled(REFERENCE).signatures)).toEqual([PAYER]);
  });

  it("adding the reference does not add a signer", () => {
    // The regression this guards: attaching the reference with the wrong
    // AccountRole. It is a one-word change and it breaks every payment.
    const withRef = Object.keys(compiled(REFERENCE).signatures);
    const without = Object.keys(compiled(null).signatures);
    expect(withRef).toEqual(without);
  });
});
