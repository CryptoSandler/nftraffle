import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/**
 * **CLEARED BEFORE, NOT ONLY AFTER — and the "only after" version was wrong.**
 *
 * The suite loads `.env.local`, so a developer who has actually configured their
 * machine hands the FIRST test a fully configured environment and
 * "closes every surface when nothing is configured" fails against a defect that
 * does not exist. Measured 2026-09-02: adding `PAYMENT_WALLET_SOLANA` locally,
 * to photograph the buy panel, turned this file red.
 *
 * Cleanup after each case was already here. What was missing is that a test's
 * preconditions are its own job: the file before it may not have run, and the
 * environment it inherits belongs to whoever is running it.
 */
beforeEach(() => {
  for (const name of ALL) delete process.env[name];
});

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

describe("configuration is what opens a chain, and nothing else is", () => {
  it("opens Robinhood only when every variable it needs is set", () => {
    /**
     * **This test replaces one that asserted the opposite**, and the reason is
     * recorded rather than implied: Robinhood used to be held shut by a
     * hard-coded set, because the approved sequence was Solana first. The owner
     * reversed that on 2026-08-31 (docs/decisions.md Q17), so the condition the
     * set encoded stopped existing.
     *
     * What must stay true is that a HALF-configured chain never opens. A
     * deployment with an RPC endpoint but no escrow wallet can take money it
     * cannot custody, which is worse than one that takes none.
     */
    const vars = {
      ROBINHOOD_RPC_URL: "https://rpc.testnet.chain.robinhood.com",
      PAYMENT_WALLET_ROBINHOOD: "0x1111111111111111111111111111111111111111",
      ESCROW_WALLET_ROBINHOOD: "0x2222222222222222222222222222222222222222",
      RAFFLE_LISTING_FEE_ROBINHOOD: "0.01",
      HOUSE_FEE_BPS_ROBINHOOD: "500",
      LAUNCH_FEE_ROBINHOOD: "0.1",
      MINT_FEE_BPS_ROBINHOOD: "300",
    };
    for (const [k, v] of Object.entries(vars)) process.env[k] = v;

    for (const surface of ["buy_tickets", "list_raffle", "launch_collection"] as const) {
      expect(surfaceState(surface, "robinhood").open, surface).toBe(true);
    }

    /**
     * Every variable is load-bearing for at least one surface.
     *
     * NOT "every variable closes every surface" — that was the first version of
     * this assertion and it was simply false: escrow holds the prize, so it
     * gates LISTING a raffle and has nothing to do with buying a ticket. A test
     * that overstates the rule gets weakened by the next person rather than
     * read.
     */
    for (const name of Object.keys(vars)) {
      const kept = process.env[name];
      delete process.env[name];
      const closed = (["buy_tickets", "list_raffle", "launch_collection"] as const).filter(
        (surface) => !surfaceState(surface, "robinhood").open,
      );
      expect(closed.length, `${name} should gate at least one surface`).toBeGreaterThan(0);
      process.env[name] = kept;
    }

    // And the two that decide where money and property go, named explicitly.
    delete process.env.PAYMENT_WALLET_ROBINHOOD;
    expect(surfaceState("buy_tickets", "robinhood").open).toBe(false);
    process.env.PAYMENT_WALLET_ROBINHOOD = vars.PAYMENT_WALLET_ROBINHOOD;

    delete process.env.ESCROW_WALLET_ROBINHOOD;
    expect(surfaceState("list_raffle", "robinhood").open).toBe(false);
    process.env.ESCROW_WALLET_ROBINHOOD = vars.ESCROW_WALLET_ROBINHOOD;

    for (const name of Object.keys(vars)) delete process.env[name];
  });

  it("does not tell a visitor which variables are missing", () => {
    // A closed surface should not report its configuration gaps: that is a
    // roadmap rather than an answer.
    const state = surfaceState("buy_tickets", "robinhood");
    if (state.open) throw new Error("expected closed");
    expect(state.message).not.toMatch(/ROBINHOOD|RPC|WALLET|FEE/);
    // The operator still learns it from the log side.
    expect(state.reason.length).toBeGreaterThan(0);
  });

  it("leaves Solana open when Solana is configured", () => {
    configureAll();
    expect(surfaceState("buy_tickets", "solana").open).toBe(true);
  });
});

describe("wallet validation knows which chain it is reading for", () => {
  /**
   * THE BUG THIS CATCHES, found while opening the Robinhood surface.
   *
   * `readWallet` base58-decoded every address and required 32 bytes, whatever
   * chain it was asked about. A perfectly valid EVM address failed that, so a
   * fully configured Robinhood deployment reported itself unconfigured — and
   * the visitor-facing message is the same either way, so it looked like a
   * missing variable rather than a rejected one.
   *
   * It is asserted in both directions on purpose. A validator that accepted
   * everything would also make the "configured" case pass.
   */
  it("accepts an EVM address for Robinhood and refuses a Solana one", async () => {
    const { paymentWallet } = await import("../payments/config");
    process.env.PAYMENT_WALLET_ROBINHOOD = "0x1111111111111111111111111111111111111111";
    expect(paymentWallet("robinhood").ok).toBe(true);

    process.env.PAYMENT_WALLET_ROBINHOOD = "F7FfSamtLjDwEx4cpHDV6EqtYjXf8HMDyiF98FbNogXE";
    expect(paymentWallet("robinhood").ok).toBe(false);
    delete process.env.PAYMENT_WALLET_ROBINHOOD;
  });

  it("accepts a Solana address for Solana and refuses an EVM one", async () => {
    const { escrowWallet } = await import("../payments/config");
    process.env.ESCROW_WALLET_SOLANA = "F7FfSamtLjDwEx4cpHDV6EqtYjXf8HMDyiF98FbNogXE";
    expect(escrowWallet("solana").ok).toBe(true);

    // The direction that actually loses money: an EVM address configured as a
    // Solana escrow is a wallet nothing on Solana can ever send to.
    process.env.ESCROW_WALLET_SOLANA = "0x1111111111111111111111111111111111111111";
    expect(escrowWallet("solana").ok).toBe(false);
    delete process.env.ESCROW_WALLET_SOLANA;
  });
});
