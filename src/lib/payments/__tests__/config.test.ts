import { afterEach, describe, expect, it } from "vitest";
import {
  escrowWallet,
  evmRpcUrls,
  feeAmount,
  formatNative,
  houseFeeBps,
  isAddressShaped,
  launchFee,
  mintFeeBps,
  paymentWallet,
  raffleListingFee,
  rpcConfigured,
  solanaRpcUrls,
} from "../config";

/** A real Solana address (the SPL Token program), used only for its shape. */
const SOL_ADDR = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const EVM_ADDR = "0x1111111111111111111111111111111111111111";

const TOUCHED = [
  "PAYMENT_WALLET_SOLANA", "PAYMENT_WALLET_ROBINHOOD",
  "ESCROW_WALLET_SOLANA", "ESCROW_WALLET_ROBINHOOD",
  "SOLANA_RPC_URL", "ROBINHOOD_RPC_URL",
  "LAUNCH_FEE_SOLANA", "LAUNCH_FEE_ROBINHOOD",
  "RAFFLE_LISTING_FEE_SOLANA", "RAFFLE_LISTING_FEE_ROBINHOOD",
  "MINT_FEE_BPS_SOLANA", "MINT_FEE_BPS_ROBINHOOD",
  "HOUSE_FEE_BPS_SOLANA", "HOUSE_FEE_BPS_ROBINHOOD",
] as const;

afterEach(() => {
  for (const name of TOUCHED) delete process.env[name];
});

describe("configuration is per chain", () => {
  it("reads each chain's wallet from its own variable", () => {
    // The two wallets are different addresses on different chains and neither
    // can receive the other's funds. One shared variable would be a deployment
    // that looks configured and pays into nothing.
    process.env.PAYMENT_WALLET_SOLANA = SOL_ADDR;
    expect(paymentWallet("solana")).toEqual({ ok: true, address: SOL_ADDR });
    expect(paymentWallet("robinhood").ok).toBe(false);
  });

  it("reads each chain's RPC from its own variable", () => {
    process.env.SOLANA_RPC_URL = "https://a.example/rpc";
    expect(rpcConfigured("solana")).toBe(true);
    expect(rpcConfigured("robinhood")).toBe(false);
    expect(solanaRpcUrls()).toEqual(["https://a.example/rpc"]);
    expect(evmRpcUrls()).toEqual([]);
  });

  it("has no RPC default on either chain", () => {
    // The sibling project defaulted to a public node. This one must not: DAS is
    // not served by Solana's public endpoint, and a silent fallback would fail
    // in a way that reads as a bug rather than as missing configuration.
    expect(rpcConfigured("solana")).toBe(false);
    expect(rpcConfigured("robinhood")).toBe(false);
  });

  it("suffixes the basis-point fees too", () => {
    /**
     * This overrules the analysis's own recommendation, which argued a ratio
     * has no currency so one value should be shared. The owner's reason is
     * better and is recorded in docs/decisions.md Q9: gas, audience and price
     * expectations differ per chain, so forcing one house fee across chains is
     * a constraint nobody asked for.
     */
    process.env.HOUSE_FEE_BPS_SOLANA = "500";
    process.env.HOUSE_FEE_BPS_ROBINHOOD = "250";
    expect(houseFeeBps("solana")).toEqual({ ok: true, bps: 500 });
    expect(houseFeeBps("robinhood")).toEqual({ ok: true, bps: 250 });
  });

  it("keeps each chain's fees independent", () => {
    process.env.LAUNCH_FEE_SOLANA = "0.5";
    expect(launchFee("solana").ok).toBe(true);
    expect(launchFee("robinhood").ok).toBe(false);
  });
});

describe("wallets", () => {
  it("refuses when unset, and never invents a placeholder", () => {
    const wallet = paymentWallet("solana");
    expect(wallet.ok).toBe(false);
    // The whole point: no address at all, rather than one that could receive.
    expect(wallet).not.toHaveProperty("address");
  });

  it("refuses a malformed address rather than passing it through", () => {
    process.env.PAYMENT_WALLET_SOLANA = "not-an-address";
    expect(paymentWallet("solana").ok).toBe(false);
  });

  it("reads escrow independently of payment", () => {
    process.env.PAYMENT_WALLET_SOLANA = SOL_ADDR;
    expect(paymentWallet("solana").ok).toBe(true);
    expect(escrowWallet("solana").ok).toBe(false);
  });
});

describe("address shape", () => {
  it("accepts a real 32-byte base58 address", () => {
    expect(isAddressShaped(SOL_ADDR)).toBe(true);
  });

  it("rejects empty, short, and non-base58 input", () => {
    expect(isAddressShaped("")).toBe(false);
    expect(isAddressShaped("abc")).toBe(false);
    // '0', 'O', 'I' and 'l' are excluded from the base58 alphabet.
    expect(isAddressShaped("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ50A")).toBe(false);
  });

  it("rejects an EVM address, which is not a Solana address", () => {
    // Both are "an address" in prose and neither can receive the other's funds.
    expect(isAddressShaped(EVM_ADDR)).toBe(false);
  });

  it("rejects an input long enough to make the O(n^2) decoder expensive", () => {
    expect(isAddressShaped("1".repeat(5_000))).toBe(false);
  });
});

describe("fees have no defaults", () => {
  it("refuses every fee when unset", () => {
    expect(launchFee("solana").ok).toBe(false);
    expect(raffleListingFee("solana").ok).toBe(false);
    expect(mintFeeBps("solana").ok).toBe(false);
    expect(houseFeeBps("solana").ok).toBe(false);
  });

  it("treats zero as configured, not as unset", () => {
    // Zero is the door: a fee switches off with a variable and no deploy. If
    // zero and unset collapsed, switching a fee off would close the surface
    // instead of making it free.
    process.env.LAUNCH_FEE_SOLANA = "0";
    process.env.HOUSE_FEE_BPS_SOLANA = "0";
    expect(launchFee("solana")).toEqual({ ok: true, amount: 0n });
    expect(houseFeeBps("solana")).toEqual({ ok: true, bps: 0 });
  });

  it("refuses a malformed fee rather than falling back", () => {
    process.env.LAUNCH_FEE_SOLANA = "free";
    process.env.RAFFLE_LISTING_FEE_SOLANA = "-1";
    expect(launchFee("solana").ok).toBe(false);
    expect(raffleListingFee("solana").ok).toBe(false);
  });

  it("parses in each chain's own base", () => {
    process.env.RAFFLE_LISTING_FEE_SOLANA = "0.05";
    process.env.RAFFLE_LISTING_FEE_ROBINHOOD = "0.05";
    expect(raffleListingFee("solana")).toEqual({ ok: true, amount: 50_000_000n });
    expect(raffleListingFee("robinhood")).toEqual({ ok: true, amount: 50_000_000_000_000_000n });
  });

  it("parses eighteen decimals exactly, which a double cannot", () => {
    /**
     * THE REASON THE PARSER IS A STRING PARSER.
     *
     * `Number("0.000000000000000001") * 1e18` does not reliably give 1 — a
     * double carries about fifteen significant digits and ETH has eighteen
     * decimals. The Solana path survived `Number` because nine decimals fits;
     * the EVM path does not, and one parser that is correct for both beats two
     * where only one was thought about.
     */
    process.env.LAUNCH_FEE_ROBINHOOD = "0.000000000000000001";
    expect(launchFee("robinhood")).toEqual({ ok: true, amount: 1n });

    process.env.LAUNCH_FEE_ROBINHOOD = "1.234567890123456789";
    expect(launchFee("robinhood")).toEqual({ ok: true, amount: 1_234_567_890_123_456_789n });
  });

  it("refuses more decimal places than the chain has", () => {
    process.env.LAUNCH_FEE_SOLANA = "0.0000000001"; // ten places, SOL has nine
    expect(launchFee("solana").ok).toBe(false);
  });

  it("refuses basis points that are fractional or out of range", () => {
    for (const bad of ["2.5", "-1", "10001", "abc"]) {
      process.env.MINT_FEE_BPS_SOLANA = bad;
      expect(mintFeeBps("solana").ok, `bad=${bad}`).toBe(false);
    }
    process.env.MINT_FEE_BPS_SOLANA = "10000";
    expect(mintFeeBps("solana")).toEqual({ ok: true, bps: 10_000 });
  });
});

describe("feeAmount", () => {
  it("takes the stated share", () => {
    expect(feeAmount(1_000_000_000n, 500)).toBe(50_000_000n);
  });

  it("rounds DOWN, so a fee can never exceed the gross", () => {
    // Rounding up would be the platform taking a unit it did not earn, on every
    // raffle, forever — and could make a seller's net negative on a dust sale.
    expect(feeAmount(1n, 5_000)).toBe(0n);
    expect(feeAmount(999n, 1)).toBe(0n);
    expect(feeAmount(10_001n, 1)).toBe(1n);
  });

  it("never exceeds the gross even at the maximum rate", () => {
    expect(feeAmount(7n, 10_000)).toBe(7n);
  });
});

describe("formatNative", () => {
  it("takes the chain's decimals rather than assuming nine", () => {
    // The Solana-only version hardcoded lamports. An EVM amount through it
    // would be off by a billion, in the direction where the number still looks
    // plausible — which is the worst kind of wrong for a figure on a payment
    // screen.
    expect(formatNative(1_000_000_000n, 9)).toBe("1.00");
    expect(formatNative(1_000_000_000_000_000_000n, 18)).toBe("1.00");
    expect(formatNative(1_000_000_000n, 18)).toBe("0.000000001");
  });

  it("always shows at least two decimals", () => {
    expect(formatNative(0n, 9)).toBe("0.00");
    expect(formatNative(1_500_000_000n, 9)).toBe("1.50");
  });

  it("keeps precision rather than rounding a quote", () => {
    // This number sits next to a wallet dialog. A rounded quote beside an
    // unrounded confirmation is what makes a payer close the tab.
    expect(formatNative(123_456_789n, 9)).toBe("0.123456789");
  });

  it("renders a negative amount without losing the sign", () => {
    expect(formatNative(-1_500_000_000n, 9)).toBe("-1.50");
  });
});
