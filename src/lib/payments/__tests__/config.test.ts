import { afterEach, describe, expect, it } from "vitest";
import {
  escrowWallet,
  feeLamports,
  formatSol,
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
const VALID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const TOUCHED = [
  "PAYMENT_WALLET",
  "ESCROW_WALLET",
  "SOLANA_RPC_URL",
  "LAUNCH_FEE_SOL",
  "RAFFLE_LISTING_FEE_SOL",
  "MINT_FEE_BPS",
  "HOUSE_FEE_BPS",
] as const;

afterEach(() => {
  for (const name of TOUCHED) delete process.env[name];
});

describe("address shape", () => {
  it("accepts a real 32-byte base58 address", () => {
    expect(isAddressShaped(VALID)).toBe(true);
  });

  it("rejects empty, short, and non-base58 input", () => {
    expect(isAddressShaped("")).toBe(false);
    expect(isAddressShaped("   ")).toBe(false);
    expect(isAddressShaped("abc")).toBe(false);
    // '0', 'O', 'I' and 'l' are excluded from the base58 alphabet.
    expect(isAddressShaped("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ50A")).toBe(false);
  });

  it("rejects an input long enough to make the O(n^2) decoder expensive", () => {
    expect(isAddressShaped("1".repeat(5_000))).toBe(false);
  });

  it("rejects a signature, which is base58 but 64 bytes", () => {
    // A signature is 87-88 base58 characters. Accepting one as an address
    // would let a wallet field be filled with something that can never receive.
    expect(isAddressShaped("5".repeat(88))).toBe(false);
  });
});

describe("wallets", () => {
  it("refuses when unset, and never invents a placeholder", () => {
    const wallet = paymentWallet();
    expect(wallet.ok).toBe(false);
    // The whole point: no address at all, rather than one that could receive.
    expect(wallet).not.toHaveProperty("address");
  });

  it("refuses a malformed address rather than passing it through", () => {
    process.env.PAYMENT_WALLET = "not-an-address";
    expect(paymentWallet().ok).toBe(false);
  });

  it("accepts a valid address", () => {
    process.env.PAYMENT_WALLET = ` ${VALID} `;
    expect(paymentWallet()).toEqual({ ok: true, address: VALID });
  });

  it("reads the escrow wallet independently of the payment wallet", () => {
    // They are different wallets on purpose: one receives fees, one holds
    // somebody else's property. A deployment can have one and not the other.
    process.env.PAYMENT_WALLET = VALID;
    expect(paymentWallet().ok).toBe(true);
    expect(escrowWallet().ok).toBe(false);
  });
});

describe("RPC endpoints", () => {
  it("is empty rather than defaulting to the public node", () => {
    // The sibling project defaulted here. This one must not: DAS methods are
    // not served by the public endpoint, so a silent fallback would fail the
    // launchpad and raffle paths in a way that looks like a bug.
    expect(solanaRpcUrls()).toEqual([]);
    expect(rpcConfigured()).toBe(false);
  });

  it("splits and trims a comma-separated list", () => {
    process.env.SOLANA_RPC_URL = " https://a.example/rpc , https://b.example/rpc ";
    expect(solanaRpcUrls()).toEqual(["https://a.example/rpc", "https://b.example/rpc"]);
    expect(rpcConfigured()).toBe(true);
  });
});

describe("fees have no defaults", () => {
  it("refuses every fee when unset", () => {
    expect(launchFee().ok).toBe(false);
    expect(raffleListingFee().ok).toBe(false);
    expect(mintFeeBps().ok).toBe(false);
    expect(houseFeeBps().ok).toBe(false);
  });

  it("treats zero as a configured fee, not as unset", () => {
    // Zero is the door: a fee switches off with a variable and no deploy. If
    // zero and unset collapsed into each other, switching a fee off would close
    // the surface instead of making it free.
    process.env.LAUNCH_FEE_SOL = "0";
    process.env.HOUSE_FEE_BPS = "0";
    expect(launchFee()).toEqual({ ok: true, lamports: 0n });
    expect(houseFeeBps()).toEqual({ ok: true, bps: 0 });
  });

  it("refuses a malformed fee rather than falling back to a default", () => {
    process.env.LAUNCH_FEE_SOL = "free";
    process.env.RAFFLE_LISTING_FEE_SOL = "-1";
    expect(launchFee().ok).toBe(false);
    expect(raffleListingFee().ok).toBe(false);
  });

  it("converts SOL to whole lamports", () => {
    process.env.RAFFLE_LISTING_FEE_SOL = "0.05";
    expect(raffleListingFee()).toEqual({ ok: true, lamports: 50_000_000n });
  });

  it("refuses basis points that are fractional or out of range", () => {
    for (const bad of ["2.5", "-1", "10001", "abc"]) {
      process.env.MINT_FEE_BPS = bad;
      expect(mintFeeBps().ok, `MINT_FEE_BPS=${bad}`).toBe(false);
    }
    process.env.MINT_FEE_BPS = "10000";
    expect(mintFeeBps()).toEqual({ ok: true, bps: 10_000 });
  });
});

describe("feeLamports", () => {
  it("takes the stated share", () => {
    expect(feeLamports(1_000_000_000n, 500)).toBe(50_000_000n);
  });

  it("rounds DOWN, so a fee can never exceed the gross", () => {
    // Rounding up would be the platform taking a lamport it did not earn, on
    // every raffle, forever — and could make a seller's net negative on a dust
    // sale.
    expect(feeLamports(1n, 5_000)).toBe(0n);
    expect(feeLamports(999n, 1)).toBe(0n);
    expect(feeLamports(10_001n, 1)).toBe(1n);
  });

  it("never exceeds the gross even at the maximum rate", () => {
    expect(feeLamports(7n, 10_000)).toBe(7n);
  });
});

describe("formatSol", () => {
  it("always shows at least two decimals", () => {
    expect(formatSol(1_000_000_000n)).toBe("1.00");
    expect(formatSol(0n)).toBe("0.00");
  });

  it("keeps precision rather than rounding a quote", () => {
    // This number is shown next to a wallet dialog. A rounded quote beside an
    // unrounded confirmation is what makes a payer close the tab.
    expect(formatSol(123_456_789n)).toBe("0.123456789");
    expect(formatSol(1_500_000_000n)).toBe("1.50");
  });

  it("renders a negative amount without losing the sign", () => {
    expect(formatSol(-1_500_000_000n)).toBe("-1.50");
  });
});
