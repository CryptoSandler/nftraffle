import { describe, expect, it } from "vitest";
import type { NativeTransferResult } from "../../payments/native-transfer";
import { verifyEscrowDeposit, verifyListingFee } from "../escrow";

/**
 * The check that decides whether a raffle may take money from strangers.
 *
 * A raffle that opens without its prize really being in escrow is the single
 * worst outcome this product has: people pay for tickets to win something
 * nobody holds. So the check is written from the assumption that the seller is
 * lying about every input, and each test below is one of the lies.
 */

const SELLER = "6dNVEXCsBpisPjcyanBz4qgpm2SXPkR7wRPmuA6cxRLW";
const IMPOSTOR = "3Nq7EtQe3aUZLxRUkzYq9c6DdShxWFRp3wY4qWCTGVAH";
const ESCROW = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const MINT = "8H1yMDsxDs52kZ8kmDzYWiCoTfxLZDvcqcMjxLdbBnRz";

const DRAFT_CREATED_AT = new Date("2026-08-28T12:00:00Z");
const DEPOSIT_TIME = new Date("2026-08-28T12:05:00Z").getTime();

function deposit(overrides: Partial<Parameters<typeof verifyEscrowDeposit>[0]> = {}) {
  return verifyEscrowDeposit({
    signature: "escrow-sig",
    prizeAsset: MINT,
    sellerWallet: SELLER,
    escrowWallet: ESCROW,
    draftCreatedAt: DRAFT_CREATED_AT,
    // Solana's tolerance and Solana's address rule. Base58 is case-sensitive,
    // so the comparison is exact — an EVM adapter passes a case-insensitive one
    // and getting that backwards on either chain is a real bug.
    blocktimeSkewSeconds: 120,
    sameAddress: (a, b) => typeof a === "string" && typeof b === "string" && a === b,
    // The chain says escrow holds it now.
    currentOwner: async () => ESCROW,
    // The chain says this transaction moved it there, from the seller.
    readTransfer: async () => ({
      ok: true,
      asset: MINT,
      from: SELLER,
      to: ESCROW,
      blockTimeMs: DEPOSIT_TIME,
    }),
    ...overrides,
  });
}

describe("verifyEscrowDeposit", () => {
  it("accepts a real deposit of the exact mint from the seller", async () => {
    expect(await deposit()).toMatchObject({ ok: true });
  });

  it("refuses when the asset is no longer in escrow", async () => {
    // THE DEPOSIT-AND-WITHDRAW ATTACK, and the reason ownership is checked at
    // all when a signature is already being checked. A seller can deposit,
    // capture the signature, withdraw the asset, and then publish. The transfer
    // really happened; the asset is not there. Only asking who owns it NOW
    // catches that.
    expect(await deposit({ currentOwner: async () => SELLER })).toMatchObject({
      ok: false,
      reason: "not_in_escrow",
    });
  });

  it("refuses a transfer of a different mint", async () => {
    // A seller quoting the signature of a worthless asset's transfer while the
    // draft names a valuable one.
    expect(
      await deposit({
        readTransfer: async () => ({
          ok: true,
          asset: "someOtherMintAddress1111111111111111111111",
          from: SELLER,
          to: ESCROW,
          blockTimeMs: DEPOSIT_TIME,
        }),
      }),
    ).toMatchObject({ ok: false, reason: "wrong_mint" });
  });

  it("refuses a transfer that went somewhere other than escrow", async () => {
    expect(
      await deposit({
        readTransfer: async () => ({
          ok: true,
          asset: MINT,
          from: SELLER,
          to: IMPOSTOR,
          blockTimeMs: DEPOSIT_TIME,
        }),
      }),
    ).toMatchObject({ ok: false, reason: "wrong_destination" });
  });

  it("refuses a transfer that did not come from the seller", async () => {
    // Somebody else's deposit, claimed. Without this, a watcher could publish a
    // raffle against a stranger's asset and collect the proceeds.
    expect(
      await deposit({
        readTransfer: async () => ({
          ok: true,
          asset: MINT,
          from: IMPOSTOR,
          to: ESCROW,
          blockTimeMs: DEPOSIT_TIME,
        }),
      }),
    ).toMatchObject({ ok: false, reason: "wrong_sender" });
  });

  it("refuses a transfer that predates the draft", async () => {
    // The draft is what a deposit is verified AGAINST (spec §0.3). A transfer
    // from before the draft existed cannot have been made for it, and allowing
    // it would let one historical deposit publish raffle after raffle.
    expect(
      await deposit({
        readTransfer: async () => ({
          ok: true,
          asset: MINT,
          from: SELLER,
          to: ESCROW,
          blockTimeMs: new Date("2026-08-28T11:00:00Z").getTime(),
        }),
      }),
    ).toMatchObject({ ok: false, reason: "predates_draft" });
  });

  it("allows a little clock skew in the seller's favour", async () => {
    // Our clock and the cluster's are not the same clock. A deposit landing a
    // few seconds before the draft's timestamp is skew, not fraud.
    expect(
      await deposit({
        readTransfer: async () => ({
          ok: true,
          asset: MINT,
          from: SELLER,
          to: ESCROW,
          blockTimeMs: DRAFT_CREATED_AT.getTime() - 30_000,
        }),
      }),
    ).toMatchObject({ ok: true });
  });

  it("refuses when the transaction cannot be read, rather than assuming", async () => {
    // "Not on chain yet" and "never existed" look identical from here, and
    // guessing in the seller's favour is exactly the hole this exists to close.
    expect(
      await deposit({ readTransfer: async () => ({ ok: false, reason: "not_found" }) }),
    ).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("refuses when ownership cannot be read, rather than trusting the transfer alone", async () => {
    // Fails closed. An RPC that cannot answer "who owns this" leaves the
    // deposit-and-withdraw case undetectable, so the answer is no.
    expect(await deposit({ currentOwner: async () => null })).toMatchObject({
      ok: false,
      reason: "ownership_unknown",
    });
  });
});

describe("verifyListingFee", () => {
  const feePaid: NativeTransferResult = {
    ok: true,
    payer: SELLER,
    amount: 50_000_000n,
    blockTimeMs: DEPOSIT_TIME,
  };

  it("accepts a fee paid by the seller", async () => {
    const result = await verifyListingFee({
      signature: "fee-sig",
      sellerWallet: SELLER,
      paymentWallet: ESCROW,
      feeAmount: 50_000_000n,
      verify: async () => feePaid,
    });
    expect(result).toMatchObject({ ok: true });
  });

  it("binds the fee to the seller's wallet", async () => {
    // The listing fee is antibot as much as revenue (spec §1). A fee anybody
    // could pay on anybody's behalf, with a signature reused across drafts, is
    // not a cost to the person being metered.
    let sawExpectedPayer: string | null | undefined;
    await verifyListingFee({
      signature: "fee-sig",
      sellerWallet: SELLER,
      paymentWallet: ESCROW,
      feeAmount: 50_000_000n,
      verify: async (input) => {
        sawExpectedPayer = input.expectedPayer;
        return feePaid;
      },
    });
    expect(sawExpectedPayer).toBe(SELLER);
  });

  it("passes the failure through rather than inventing one", async () => {
    const result = await verifyListingFee({
      signature: "fee-sig",
      sellerWallet: SELLER,
      paymentWallet: ESCROW,
      feeAmount: 50_000_000n,
      verify: async () => ({ ok: false, reason: "insufficient_amount", message: "too little" }),
    });
    expect(result).toMatchObject({ ok: false, reason: "insufficient_amount" });
  });

  it("accepts a zero fee without asking the chain anything", async () => {
    // Zero is the door: a fee switches off with a variable and no deploy. A
    // zero fee that still demanded a signature would make "off" mean "still
    // send me an empty transaction".
    let called = false;
    const result = await verifyListingFee({
      signature: "",
      sellerWallet: SELLER,
      paymentWallet: ESCROW,
      feeAmount: 0n,
      verify: async () => {
        called = true;
        return feePaid;
      },
    });
    expect(result).toMatchObject({ ok: true });
    expect(called).toBe(false);
  });
});
