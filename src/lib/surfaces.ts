import type { ChainId } from "./chain/adapter";
import {
  escrowWallet,
  houseFeeBps,
  launchFee,
  mintFeeBps,
  paymentWallet,
  raffleListingFee,
  rpcConfigured,
} from "./payments/config";

/**
 * Which parts of this product are available on this deployment, and the one
 * sentence to show when they are not.
 *
 * **A missing configuration value is a first-class product state, not an
 * error.** The alternative — a placeholder wallet, a default fee, a crash on
 * boot — is worse in three distinct ways, and this module exists so nobody
 * reaches for any of them:
 *
 *   - A PLACEHOLDER wallet address is an address. It receives. A deployment
 *     that goes live with one collects real SOL into a wallet nobody holds the
 *     key to, and the payer has no way to know.
 *   - A DEFAULT fee is a number that appears in a sentence on screen while
 *     something else is enforced, which is exactly the defect DESIGN.md §8.2
 *     exists to prevent.
 *   - A CRASH takes down the read-only surfaces too. A visitor should still be
 *     able to look at a raffle that is running on a deployment that cannot
 *     currently sell tickets.
 *
 * **The reason never reaches the visitor.** It names environment variables, and
 * "which variable is missing here" is reconnaissance. The visitor gets the
 * sentence; the reason goes to the server log, where configuration faults
 * belong. That is the same split `identify()` and `requireAdmin` already make.
 *
 * WHO CALLS THIS: every page and route that takes money or writes to the chain
 * — `/launch`, `/raffle/new`, the buy panel on `/r/[slug]`, and their POST
 * routes. Read-only pages deliberately do not call it: a raffle that is already
 * running stays readable whatever this deployment can or cannot do next.
 */

export type Surface = "buy_tickets" | "list_raffle" | "launch_collection";

export type SurfaceState =
  | { open: true }
  | { open: false; message: string; reason: string };

/** The sentence a visitor sees. Deliberately not per-surface-specific about why. */
const CLOSED_MESSAGES: Record<Surface, string> = {
  buy_tickets:
    "Ticket sales are not open on this deployment yet. Nothing has been charged, and the " +
    "raffles below are readable in the meantime.",
  list_raffle:
    "Listing a raffle is not open on this deployment yet. Nothing has been charged, and no " +
    "asset has been asked for.",
  launch_collection:
    "Launching is not open on this deployment yet. Nothing has been charged, and nothing has " +
    "been created on chain.",
};

/**
 * What each surface needs before it can honestly ask for a signature.
 *
 * Read as a list of preconditions rather than as a chain of ifs, so adding a
 * surface is adding a row. Each entry returns a reason string or null.
 */
/**
 * Chains this codebase will serve a money surface for at all.
 *
 * **Robinhood Chain was in a hard-coded closed set and is not any more**
 * (docs/decisions.md Q17). That set existed to hold it shut until one real
 * Solana raffle had run; the owner reversed the sequence on 2026-08-31, so the
 * condition it encoded no longer exists and leaving it would be a switch whose
 * stated reason had stopped being true.
 *
 * **What holds the surface shut now is CONFIGURATION, and it is stricter rather
 * than looser.** A chain can only take money on a deployment that has a
 * receiving wallet, an escrow wallet, a fee and an RPC endpoint for it — which
 * is what `REQUIREMENTS` below already checks, per chain, and which production
 * deliberately does not have for either chain. A second switch on top of that
 * meant two things to change and a way to half-open one of them.
 *
 * The gate for Robinhood MAINNET is therefore not in this file and cannot be:
 * it is the owner loading the environment, once
 * `docs/testnet-rehearsal-robinhood.md` has passed whole. Code cannot enforce
 * "the owner is satisfied", and pretending otherwise with a boolean is how a
 * boolean gets flipped by somebody who is not the owner.
 */
const OPEN_CHAINS: ReadonlySet<ChainId> = new Set<ChainId>(["solana", "robinhood"]);

const CHAIN_CLOSED_MESSAGE =
  "This chain is not open on this deployment yet. Nothing has been charged.";

const REQUIREMENTS: Record<Surface, (chain: ChainId) => string | null> = {
  // Selling a ticket needs somewhere for the SOL to go, a chain to verify it
  // on, and a house fee to split the proceeds by at payout time. The fee is
  // required at SALE time rather than at payout time deliberately: a raffle
  // that sold tickets and only then discovered it had no fee configured would
  // be a seller owed an amount nobody can compute.
  buy_tickets: (chain) =>
    firstMissing([
      ["RPC_URL", rpcConfigured(chain)],
      ["PAYMENT_WALLET", paymentWallet(chain).ok],
      ["HOUSE_FEE_BPS", houseFeeBps(chain).ok],
    ]),

  // Listing needs an escrow wallet to hold the prize, a payment wallet for the
  // listing fee, and the two fees the seller is quoted before they commit.
  list_raffle: (chain) =>
    firstMissing([
      ["RPC_URL", rpcConfigured(chain)],
      ["ESCROW_WALLET", escrowWallet(chain).ok],
      ["PAYMENT_WALLET", paymentWallet(chain).ok],
      ["RAFFLE_LISTING_FEE", raffleListingFee(chain).ok],
      ["HOUSE_FEE_BPS", houseFeeBps(chain).ok],
    ]),

  // Launching never touches escrow — the creator holds everything and this
  // server custodies nothing in that leg (spec §1). It needs the payment wallet
  // for the launch fee and the platform's mint share, which becomes the candy
  // machine's solFixedFee guard.
  launch_collection: (chain) =>
    firstMissing([
      ["RPC_URL", rpcConfigured(chain)],
      ["PAYMENT_WALLET", paymentWallet(chain).ok],
      ["LAUNCH_FEE", launchFee(chain).ok],
      ["MINT_FEE_BPS", mintFeeBps(chain).ok],
    ]),
};

function firstMissing(checks: [name: string, ok: boolean][]): string | null {
  const missing = checks.filter(([, ok]) => !ok).map(([name]) => name);
  return missing.length ? `missing configuration: ${missing.join(", ")}` : null;
}

/**
 * Whether a surface is open.
 *
 * Callers that render must NOT put `reason` on the page. It is returned so the
 * caller can log it beside the route name, which is the whole point of it being
 * specific.
 */
export function surfaceState(surface: Surface, chain: ChainId): SurfaceState {
  // The chain gate first: a chain that is not open should not report which of
  // its variables are missing, because that is a roadmap rather than an answer.
  if (!OPEN_CHAINS.has(chain)) {
    return { open: false, message: CHAIN_CLOSED_MESSAGE, reason: `chain not open: ${chain}` };
  }
  const reason = REQUIREMENTS[surface](chain);
  if (!reason) return { open: true };
  return { open: false, message: CLOSED_MESSAGES[surface], reason };
}

/**
 * The guard for a route handler: logs the reason and returns the visitor's
 * sentence, or null to proceed.
 */
export function surfaceRefusal(
  surface: Surface,
  chain: ChainId,
  routeName: string,
): { message: string } | null {
  const state = surfaceState(surface, chain);
  if (state.open) return null;
  console.error(`${routeName} [${chain}]: ${state.reason}`);
  return { message: state.message };
}
