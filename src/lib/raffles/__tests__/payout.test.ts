import { describe, expect, it } from "vitest";
import { payoutSplit, verifyPayout } from "../payout";

/**
 * The payout: arithmetic anybody can check, and evidence the server checks.
 *
 * Spec §0.5 is the rule under test. Payouts are performed by a human, so the
 * "paid" mark is an operator's claim ABOUT THEMSELVES — and the public raffle
 * page shows that mark to the person who did not send the transfer. An
 * unverified mark on that page is the product asserting something nothing
 * checked, which is the one thing a manual-payout design cannot afford.
 */

const WINNER = "6dNVEXCsBpisPjcyanBz4qgpm2SXPkR7wRPmuA6cxRLW";
const SELLER = "3Nq7EtQe3aUZLxRUkzYq9c6DdShxWFRp3wY4qWCTGVAH";
const ESCROW = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const MINT = "8H1yMDsxDs52kZ8kmDzYWiCoTfxLZDvcqcMjxLdbBnRz";

describe("payoutSplit", () => {
  it("splits gross into house fee and seller net", () => {
    const split = payoutSplit({ ticketPriceLamports: 100_000_000n, ticketsSold: 10, houseFeeBps: 500 });
    expect(split.grossLamports).toBe(1_000_000_000n);
    expect(split.houseFeeLamports).toBe(50_000_000n);
    expect(split.sellerNetLamports).toBe(950_000_000n);
  });

  it("always accounts for every lamport", () => {
    // The property that matters more than any single figure: nothing is created
    // and nothing goes missing in the rounding.
    for (const [price, sold, bps] of [
      [1n, 1, 5_000],
      [333_333_333n, 7, 250],
      [1n, 9_999, 9_999],
      [100_000_000n, 3, 10_000],
      [100_000_000n, 3, 0],
    ] as const) {
      const split = payoutSplit({ ticketPriceLamports: price, ticketsSold: sold, houseFeeBps: bps });
      expect(split.houseFeeLamports + split.sellerNetLamports).toBe(split.grossLamports);
      expect(split.sellerNetLamports).toBeGreaterThanOrEqual(0n);
      expect(split.houseFeeLamports).toBeGreaterThanOrEqual(0n);
    }
  });

  it("gives the rounding remainder to the seller, never to the house", () => {
    // Rounding a fee up is the platform taking a lamport it did not earn, on
    // every raffle, forever.
    const split = payoutSplit({ ticketPriceLamports: 1n, ticketsSold: 1, houseFeeBps: 5_000 });
    expect(split.houseFeeLamports).toBe(0n);
    expect(split.sellerNetLamports).toBe(1n);
  });

  it("handles a raffle that sold one ticket", () => {
    // The no-minimum rule makes this real (spec §0.6). The seller's create
    // screen shows exactly this number before they list.
    const split = payoutSplit({ ticketPriceLamports: 250_000_000n, ticketsSold: 1, houseFeeBps: 500 });
    expect(split.grossLamports).toBe(250_000_000n);
    expect(split.sellerNetLamports).toBe(237_500_000n);
  });

  it("handles a raffle that sold nothing", () => {
    const split = payoutSplit({ ticketPriceLamports: 250_000_000n, ticketsSold: 0, houseFeeBps: 500 });
    expect(split.grossLamports).toBe(0n);
    expect(split.sellerNetLamports).toBe(0n);
  });
});

describe("verifyPayout", () => {
  const base = {
    prizeSignature: "prize-sig",
    proceedsSignature: "proceeds-sig",
    prizeMint: MINT,
    escrowWallet: ESCROW,
    winnerWallet: WINNER,
    sellerWallet: SELLER,
    sellerNetLamports: 950_000_000n,
  };

  const goodPrize = async () => ({
    ok: true as const,
    mint: MINT,
    from: ESCROW,
    to: WINNER,
    blockTimeMs: Date.now(),
  });

  const goodProceeds = async () => ({
    ok: true as const,
    payer: ESCROW,
    lamports: 950_000_000n,
    blockTimeMs: Date.now(),
  });

  it("accepts a payout where both legs check out", async () => {
    expect(
      await verifyPayout({ ...base, readPrizeTransfer: goodPrize, verifyProceeds: goodProceeds }),
    ).toMatchObject({ ok: true });
  });

  it("refuses when the prize went to somebody other than the winner", async () => {
    // The failure this whole module exists for: an operator sending the asset
    // to the wrong wallet, and the page then telling the real winner they were
    // paid.
    expect(
      await verifyPayout({
        ...base,
        readPrizeTransfer: async () => ({
          ok: true, mint: MINT, from: ESCROW, to: SELLER, blockTimeMs: Date.now(),
        }),
        verifyProceeds: goodProceeds,
      }),
    ).toMatchObject({ ok: false, reason: "prize_wrong_recipient" });
  });

  it("refuses when a different asset was sent", async () => {
    expect(
      await verifyPayout({
        ...base,
        readPrizeTransfer: async () => ({
          ok: true, mint: "anotherMint111111111111111111111111111111", from: ESCROW, to: WINNER,
          blockTimeMs: Date.now(),
        }),
        verifyProceeds: goodProceeds,
      }),
    ).toMatchObject({ ok: false, reason: "prize_wrong_mint" });
  });

  it("refuses when the prize did not leave escrow", async () => {
    // A transfer of the right mint to the right winner that did not come out of
    // escrow means the asset in escrow is still sitting there, unaccounted for.
    expect(
      await verifyPayout({
        ...base,
        readPrizeTransfer: async () => ({
          ok: true, mint: MINT, from: SELLER, to: WINNER, blockTimeMs: Date.now(),
        }),
        verifyProceeds: goodProceeds,
      }),
    ).toMatchObject({ ok: false, reason: "prize_wrong_source" });
  });

  it("refuses when the seller was underpaid", async () => {
    expect(
      await verifyPayout({
        ...base,
        readPrizeTransfer: goodPrize,
        verifyProceeds: async () => ({
          ok: false as const, reason: "insufficient_amount" as const, message: "short",
        }),
      }),
    ).toMatchObject({ ok: false, reason: "insufficient_amount" });
  });

  it("asks the proceeds verifier for the seller's exact net, paid to the seller", async () => {
    let asked: { recipient: string; minLamports: bigint } | undefined;
    await verifyPayout({
      ...base,
      readPrizeTransfer: goodPrize,
      verifyProceeds: async (input) => {
        asked = { recipient: input.recipient, minLamports: input.minLamports };
        return { ok: true, payer: ESCROW, lamports: 950_000_000n, blockTimeMs: Date.now() };
      },
    });
    expect(asked).toEqual({ recipient: SELLER, minLamports: 950_000_000n });
  });

  it("skips the proceeds leg when the seller's net is zero", async () => {
    // A raffle that sold nothing owes the seller nothing, and demanding a
    // zero-lamport transfer as evidence would block the one payout that only
    // has a prize leg — returning the asset.
    let called = false;
    const result = await verifyPayout({
      ...base,
      sellerNetLamports: 0n,
      proceedsSignature: "",
      readPrizeTransfer: goodPrize,
      verifyProceeds: async () => {
        called = true;
        return { ok: true, payer: ESCROW, lamports: 0n, blockTimeMs: Date.now() };
      },
    });
    expect(result).toMatchObject({ ok: true });
    expect(called).toBe(false);
  });

  it("refuses when the prize transfer cannot be read", async () => {
    expect(
      await verifyPayout({
        ...base,
        readPrizeTransfer: async () => ({ ok: false, reason: "not_found" }),
        verifyProceeds: goodProceeds,
      }),
    ).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("checks the prize leg before the proceeds leg", async () => {
    // Order matters for the operator reading the error. The prize is somebody
    // else's property and the proceeds are money; being told which one is wrong
    // first should follow which one is harder to undo.
    let proceedsCalled = false;
    await verifyPayout({
      ...base,
      readPrizeTransfer: async () => ({ ok: false, reason: "not_found" }),
      verifyProceeds: async () => {
        proceedsCalled = true;
        return { ok: true, payer: ESCROW, lamports: 1n, blockTimeMs: Date.now() };
      },
    });
    expect(proceedsCalled).toBe(false);
  });
});
