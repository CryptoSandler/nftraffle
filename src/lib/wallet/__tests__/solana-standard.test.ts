import { describe, expect, it } from "vitest";
import {
  SOLANA_SIGN_AND_SEND,
  SOLANA_SIGN_TRANSACTION,
  STANDARD_CONNECT,
  usableWallets,
  walletCapability,
  type ReadableWallet,
} from "../solana-standard";

/**
 * Which of the browser's registered wallets this product can actually use.
 *
 * The Wallet Standard registry hands back every wallet the page can see,
 * including ones that speak no Solana at all and ones that speak Solana on a
 * chain this deployment does not settle on. Filtering is this module's whole
 * job, and getting it wrong in the permissive direction means offering somebody
 * a Connect button that leads to a wallet which cannot sign what we are about
 * to ask for.
 */

function wallet(overrides: Partial<ReadableWallet> = {}): ReadableWallet {
  return {
    name: "Test Wallet",
    icon: "data:image/svg+xml;base64,AAA",
    chains: ["solana:mainnet"],
    features: {
      [STANDARD_CONNECT]: {},
      [SOLANA_SIGN_AND_SEND]: {},
    },
    ...overrides,
  };
}

describe("walletCapability", () => {
  it("prefers sign-and-send when the wallet offers it", () => {
    // The wallet submits, so the browser never needs the RPC endpoint for the
    // send — one fewer round trip through our proxy, and the wallet handles
    // retries and preflight itself.
    expect(walletCapability(wallet(), "solana:mainnet")).toBe("sign_and_send");
  });

  it("falls back to sign-only", () => {
    const signOnly = wallet({
      features: { [STANDARD_CONNECT]: {}, [SOLANA_SIGN_TRANSACTION]: {} },
    });
    expect(walletCapability(signOnly, "solana:mainnet")).toBe("sign_only");
  });

  it("prefers sign-and-send when a wallet offers both", () => {
    const both = wallet({
      features: {
        [STANDARD_CONNECT]: {},
        [SOLANA_SIGN_TRANSACTION]: {},
        [SOLANA_SIGN_AND_SEND]: {},
      },
    });
    expect(walletCapability(both, "solana:mainnet")).toBe("sign_and_send");
  });

  it("refuses a wallet that cannot sign a transaction at all", () => {
    // A wallet offering only signMessage can prove an identity and cannot pay
    // for anything. Listing it would produce a Connect button that leads
    // nowhere useful.
    const messageOnly = wallet({
      features: { [STANDARD_CONNECT]: {}, "solana:signMessage": {} },
    });
    expect(walletCapability(messageOnly, "solana:mainnet")).toBeNull();
  });

  it("refuses a wallet that cannot be connected", () => {
    // Without `standard:connect` there is no way to obtain an account, so
    // whatever else it supports is unreachable.
    const noConnect = wallet({ features: { [SOLANA_SIGN_AND_SEND]: {} } });
    expect(walletCapability(noConnect, "solana:mainnet")).toBeNull();
  });

  it("refuses a wallet that does not support the chain we settle on", () => {
    // THE CASE THAT COSTS MONEY. A wallet that speaks only devnet, offered on a
    // deployment settling on mainnet, produces a payment on a chain where it
    // can never be credited. `paymentSafety` in chain/cluster.ts blocks the
    // signature too; this is the same refusal one layer earlier, where the
    // person has not yet been invited to try.
    const devnetOnly = wallet({ chains: ["solana:devnet"] });
    expect(walletCapability(devnetOnly, "solana:mainnet")).toBeNull();
  });

  it("accepts a wallet that supports the chain among several", () => {
    const many = wallet({ chains: ["solana:devnet", "solana:mainnet", "eip155:1"] });
    expect(walletCapability(many, "solana:mainnet")).toBe("sign_and_send");
  });

  it("refuses a wallet with no Solana chains at all", () => {
    expect(walletCapability(wallet({ chains: ["eip155:1"] }), "solana:mainnet")).toBeNull();
  });

  it("does not throw on a malformed registration", () => {
    // The registry is populated by browser extensions we do not control, and a
    // page that throws while enumerating them shows nothing at all rather than
    // the wallets that registered correctly.
    const junk = { name: "", icon: "", chains: [], features: {} } as ReadableWallet;
    expect(walletCapability(junk, "solana:mainnet")).toBeNull();
  });
});

describe("usableWallets", () => {
  it("keeps only what can sign on this chain, and reports how", () => {
    const found = usableWallets(
      [
        wallet({ name: "Good" }),
        wallet({ name: "Devnet only", chains: ["solana:devnet"] }),
        wallet({
          name: "Sign only",
          features: { [STANDARD_CONNECT]: {}, [SOLANA_SIGN_TRANSACTION]: {} },
        }),
        wallet({ name: "Ethereum", chains: ["eip155:1"] }),
      ],
      "solana:mainnet",
    );

    expect(found.map((w) => [w.name, w.capability])).toEqual([
      ["Good", "sign_and_send"],
      ["Sign only", "sign_only"],
    ]);
  });

  it("returns an empty list rather than throwing when nothing is installed", () => {
    // The ordinary case for a first-time visitor, and it has to render as
    // "install a wallet" rather than as a broken page.
    expect(usableWallets([], "solana:mainnet")).toEqual([]);
  });

  it("deduplicates wallets registering under one name", () => {
    // Some extensions register twice — once eagerly and once on the app-ready
    // event — and a list showing "Phantom, Phantom" reads as a bug.
    const twice = usableWallets([wallet({ name: "Phantom" }), wallet({ name: "Phantom" })], "solana:mainnet");
    expect(twice).toHaveLength(1);
  });

  it("keeps the registry's own order", () => {
    // Deliberately not sorted, and not ranked. Ordering wallets is a
    // recommendation, and this product has no basis for recommending one
    // wallet over another.
    const found = usableWallets(
      [wallet({ name: "Zebra" }), wallet({ name: "Alpha" })],
      "solana:mainnet",
    );
    expect(found.map((w) => w.name)).toEqual(["Zebra", "Alpha"]);
  });

  it("carries the wallet through, so a caller can connect to it", () => {
    const source = wallet({ name: "Good" });
    expect(usableWallets([source], "solana:mainnet")[0].wallet).toBe(source);
  });
});
