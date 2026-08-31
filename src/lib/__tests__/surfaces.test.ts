import { afterEach, describe, expect, it, vi } from "vitest";
import { surfaceRefusal, surfaceState } from "../surfaces";

/**
 * The closed-by-default state, which is the state every deployment starts in
 * and the one a developer sees locally by default.
 *
 * Two properties are being defended, and the second is the one that is easy to
 * lose in a refactor: the surface must close rather than guess, AND the
 * visitor-facing message must never name an environment variable.
 */

const WALLET = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ESCROW = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

const ALL = [
  "SOLANA_RPC_URL",
  "ROBINHOOD_RPC_URL",
  "PAYMENT_WALLET_SOLANA",
  "ESCROW_WALLET_SOLANA",
  "LAUNCH_FEE_SOLANA",
  "MINT_FEE_BPS_SOLANA",
  "RAFFLE_LISTING_FEE_SOLANA",
  "HOUSE_FEE_BPS_SOLANA",
] as const;

function configureAll() {
  process.env.SOLANA_RPC_URL = "https://mainnet.example/rpc";
  process.env.PAYMENT_WALLET_SOLANA = WALLET;
  process.env.ESCROW_WALLET_SOLANA = ESCROW;
  process.env.LAUNCH_FEE_SOLANA = "0.5";
  process.env.MINT_FEE_BPS_SOLANA = "300";
  process.env.RAFFLE_LISTING_FEE_SOLANA = "0.05";
  process.env.HOUSE_FEE_BPS_SOLANA = "500";
}

afterEach(() => {
  for (const name of ALL) delete process.env[name];
  vi.restoreAllMocks();
});

describe("closed by default", () => {
  it("closes every surface when nothing is configured", () => {
    for (const surface of ["buy_tickets", "list_raffle", "launch_collection"] as const) {
      expect(surfaceState(surface, "solana").open, surface).toBe(false);
    }
  });

  it("opens every surface once everything is configured", () => {
    configureAll();
    for (const surface of ["buy_tickets", "list_raffle", "launch_collection"] as const) {
      expect(surfaceState(surface, "solana").open, surface).toBe(true);
    }
  });
});

describe("each surface names its own requirements", () => {
  it("closes ticket sales without a payment wallet, and nothing else", () => {
    configureAll();
    delete process.env.PAYMENT_WALLET_SOLANA;
    expect(surfaceState("buy_tickets", "solana").open).toBe(false);
    expect(surfaceState("list_raffle", "solana").open).toBe(false);
    expect(surfaceState("launch_collection", "solana").open).toBe(false);
  });

  it("leaves launching open when only the escrow wallet is missing", () => {
    // The launchpad never touches escrow: the creator holds everything and this
    // server custodies nothing in that leg. A deployment that can launch but
    // cannot escrow is a real, coherent configuration.
    configureAll();
    delete process.env.ESCROW_WALLET_SOLANA;
    expect(surfaceState("launch_collection", "solana").open).toBe(true);
    expect(surfaceState("list_raffle", "solana").open).toBe(false);
  });

  it("leaves ticket sales open when only the launch fee is missing", () => {
    configureAll();
    delete process.env.LAUNCH_FEE_SOLANA;
    expect(surfaceState("buy_tickets", "solana").open).toBe(true);
    expect(surfaceState("launch_collection", "solana").open).toBe(false);
  });

  it("closes ticket sales when the house fee is missing", () => {
    // Required at SALE time, not at payout time. A raffle that sold tickets and
    // only then discovered it had no fee configured would be a seller owed an
    // amount nobody can compute.
    configureAll();
    delete process.env.HOUSE_FEE_BPS_SOLANA;
    expect(surfaceState("buy_tickets", "solana").open).toBe(false);
  });

  it("closes everything when the RPC is missing", () => {
    configureAll();
    delete process.env.SOLANA_RPC_URL;
    for (const surface of ["buy_tickets", "list_raffle", "launch_collection"] as const) {
      expect(surfaceState(surface, "solana").open, surface).toBe(false);
    }
  });

  it("treats a zero fee as configured", () => {
    configureAll();
    process.env.HOUSE_FEE_BPS_SOLANA = "0";
    process.env.LAUNCH_FEE_SOLANA = "0";
    expect(surfaceState("buy_tickets", "solana").open).toBe(true);
    expect(surfaceState("launch_collection", "solana").open).toBe(true);
  });

  it("closes a surface whose wallet is malformed rather than passing it through", () => {
    configureAll();
    process.env.PAYMENT_WALLET_SOLANA = "not-an-address";
    expect(surfaceState("buy_tickets", "solana").open).toBe(false);
  });
});

describe("the visitor is never told which variable is missing", () => {
  it("keeps every environment variable name out of the message", () => {
    // "Which variable is missing here" is reconnaissance. The operational
    // detail goes to the server log; the visitor gets a sentence.
    for (const surface of ["buy_tickets", "list_raffle", "launch_collection"] as const) {
      const state = surfaceState(surface, "solana");
      if (state.open) throw new Error("expected closed");
      for (const name of ALL) {
        expect(state.message, `${surface} leaks ${name}`).not.toContain(name);
      }
      expect(state.message).not.toMatch(/env|environment|config/i);
    }
  });

  it("says nothing has been charged, because nothing has", () => {
    expect(surfaceState("buy_tickets", "solana")).toMatchObject({
      open: false,
      message: expect.stringContaining("Nothing has been charged"),
    });
  });

  it("does put the variable names in the reason, which is for the log", () => {
    const state = surfaceState("list_raffle", "solana");
    if (state.open) throw new Error("expected closed");
    expect(state.reason).toContain("ESCROW_WALLET");
  });
});

describe("surfaceRefusal", () => {
  it("logs the reason with the route name and returns only the message", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const refusal = surfaceRefusal("buy_tickets", "solana", "POST /api/raffles/x/orders");

    expect(refusal?.message).toContain("Nothing has been charged");
    expect(Object.keys(refusal ?? {})).toEqual(["message"]);
    // The log line names the chain too, because "which variable is missing"
    // is only actionable once you know which chain's variable it was.
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("POST /api/raffles/x/orders [solana]: missing configuration"),
    );
  });

  it("returns null when the surface is open, so the caller proceeds", () => {
    configureAll();
    expect(surfaceRefusal("buy_tickets", "solana", "route")).toBeNull();
  });
});

describe("a chain can be closed regardless of its configuration", () => {
  it("keeps Robinhood Chain closed even when everything is set", () => {
    /**
     * The approved sequence: the Robinhood adapter is built and tested, and its
     * surface stays shut until one real raffle has run end to end on Solana
     * (docs/decisions.md). Removing "robinhood" from OPEN_CHAINS is the whole of
     * "open the second chain" — this test is what stops that happening by
     * accident, e.g. by someone setting the variables and assuming that is the
     * switch.
     */
    process.env.ROBINHOOD_RPC_URL = "https://rpc.testnet.chain.robinhood.com";
    process.env.PAYMENT_WALLET_ROBINHOOD = "0x1111111111111111111111111111111111111111";
    process.env.ESCROW_WALLET_ROBINHOOD = "0x2222222222222222222222222222222222222222";
    process.env.RAFFLE_LISTING_FEE_ROBINHOOD = "0.01";
    process.env.HOUSE_FEE_BPS_ROBINHOOD = "500";
    process.env.LAUNCH_FEE_ROBINHOOD = "0.1";
    process.env.MINT_FEE_BPS_ROBINHOOD = "300";

    for (const surface of ["buy_tickets", "list_raffle", "launch_collection"] as const) {
      expect(surfaceState(surface, "robinhood").open, surface).toBe(false);
    }

    for (const name of [
      "ROBINHOOD_RPC_URL", "PAYMENT_WALLET_ROBINHOOD", "ESCROW_WALLET_ROBINHOOD",
      "RAFFLE_LISTING_FEE_ROBINHOOD", "HOUSE_FEE_BPS_ROBINHOOD", "LAUNCH_FEE_ROBINHOOD",
      "MINT_FEE_BPS_ROBINHOOD",
    ]) delete process.env[name];
  });

  it("does not tell a visitor which of a closed chain's variables are missing", () => {
    // A chain that is not open should not report its configuration gaps: that
    // is a roadmap rather than an answer.
    const state = surfaceState("buy_tickets", "robinhood");
    if (state.open) throw new Error("expected closed");
    expect(state.message).not.toMatch(/ROBINHOOD|RPC|WALLET|FEE/);
    // The operator still learns it from the log side.
    expect(state.reason).toContain("chain not open");
  });

  it("leaves Solana open when Solana is configured", () => {
    configureAll();
    expect(surfaceState("buy_tickets", "solana").open).toBe(true);
  });
});
