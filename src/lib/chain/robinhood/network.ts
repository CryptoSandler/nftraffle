/**
 * Which Robinhood Chain network this deployment is pointed at.
 *
 * **The same rule as Solana's `cluster.ts`, for the same reason** (CLAUDE.md,
 * "Showing the network before a signature"): the browser only ever talks to
 * `/api/rpc/robinhood`, so it cannot see which network the proxy points at. A
 * deployment whose `ROBINHOOD_RPC_URL` names testnet would otherwise show
 * mainnet on an ordinary origin, and nothing client-side could tell.
 *
 * **Classified by ASKING THE CHAIN, not by reading the URL.** Solana classifies
 * from the endpoint's shape because its clusters have recognisable hostnames
 * and no cheap self-identifying call. EVM has `eth_chainId`, which is
 * authoritative: the node states which chain it is, and a URL pattern is a
 * guess about a provider's naming convention. Guessing here would be the
 * `getChainForEndpoint` trap the cluster module already documents — a mapping
 * that answers confidently for endpoints it has never seen.
 *
 * **`unknown` blocks signing.** A disclosure that can be silently wrong is
 * worse than no disclosure, because it is trusted. A payer who cannot pay will
 * ask; a payer who paid on the wrong chain will not know to.
 *
 * WHO CALLS THIS: `src/app/r/[slug]/page.tsx`, server-side, to pass a NAME down
 * to the buy panel. The endpoint itself never leaves the server.
 */

import { evmCall } from "./rpc";
import { ROBINHOOD_MAINNET_CHAIN_ID, ROBINHOOD_TESTNET_CHAIN_ID } from "./constants";

export type RobinhoodNetwork = "robinhood:mainnet" | "robinhood:testnet" | "unknown";

/** What a person is shown. Never a URL, never a chain id we did not recognise. */
export function robinhoodNetworkLabel(network: RobinhoodNetwork): string {
  if (network === "robinhood:mainnet") return "Robinhood Chain";
  if (network === "robinhood:testnet") return "Robinhood Chain testnet";
  return "an unrecognised network";
}

/** The numeric id behind a classified network, for the signature binding. */
export function chainIdFor(network: RobinhoodNetwork): number | null {
  if (network === "robinhood:mainnet") return ROBINHOOD_MAINNET_CHAIN_ID;
  if (network === "robinhood:testnet") return ROBINHOOD_TESTNET_CHAIN_ID;
  return null;
}

/**
 * Cached for the life of the process.
 *
 * A node's chain id does not change; if it does, the endpoint was repointed,
 * which is a deploy. Caching keeps a page render from making a network call it
 * already knows the answer to, and a cold start re-asks.
 *
 * Only a SUCCESSFUL classification is cached. Caching `unknown` would make one
 * failed call during a blip close the surface until the next deploy.
 */
let cached: RobinhoodNetwork | null = null;

export async function robinhoodNetwork(): Promise<RobinhoodNetwork> {
  if (cached) return cached;
  let id: unknown;
  try {
    id = await evmCall("eth_chainId", []);
  } catch {
    // THE NAME IS NOT EVEN READ — the endpoint may carry a key, and this is the
    // one place where a thrown fetch's message is most likely to contain it.
    console.error("robinhoodNetwork: eth_chainId failed; treating the network as unknown.");
    return "unknown";
  }
  if (typeof id !== "string") return "unknown";

  let numeric: number;
  try {
    numeric = Number(BigInt(id));
  } catch {
    return "unknown";
  }

  const network: RobinhoodNetwork =
    numeric === ROBINHOOD_MAINNET_CHAIN_ID
      ? "robinhood:mainnet"
      : numeric === ROBINHOOD_TESTNET_CHAIN_ID
        ? "robinhood:testnet"
        : "unknown";

  if (network !== "unknown") cached = network;
  else console.error(`robinhoodNetwork: node reported chain id ${numeric}, which is neither Robinhood network.`);
  return network;
}

/** Test seam. Nothing in the application calls this. */
export function resetRobinhoodNetworkCache(): void {
  cached = null;
}

/**
 * Whether it is safe to ask for a signature, given what the server classified
 * and what the wallet says it is connected to.
 *
 * **Both halves matter and neither is sufficient.** The server knows which node
 * it will verify against; the wallet knows which chain it will broadcast to. A
 * payment sent on a chain we do not read is a payment nobody can credit, and it
 * is unrecoverable — so a disagreement blocks rather than warns.
 *
 * Mirrors `paymentSafety` in `chain/solana/cluster.ts`, deliberately: two
 * chains, one rule, and a reader who has understood one has understood both.
 */
export function robinhoodPaymentSafety(input: {
  serverNetwork: RobinhoodNetwork;
  /** From the wallet's `eth_chainId`. Null when no wallet is connected yet. */
  walletChainId: number | null;
  isProduction: boolean;
}): { ok: true } | { ok: false; message: string } {
  if (input.serverNetwork === "unknown") {
    return {
      ok: false,
      message:
        "This deployment could not confirm which network it is connected to, so it will not ask " +
        "you to sign anything. Nothing has been charged.",
    };
  }
  if (input.isProduction && input.serverNetwork !== "robinhood:mainnet") {
    return {
      ok: false,
      message:
        "This is a production deployment pointed at a test network. It will not ask you to sign " +
        "anything. Nothing has been charged.",
    };
  }
  if (input.walletChainId === null) return { ok: true };
  if (input.walletChainId !== chainIdFor(input.serverNetwork)) {
    return {
      ok: false,
      message:
        `Your wallet is on a different network from this site (${robinhoodNetworkLabel(input.serverNetwork)}). ` +
        "Switch networks in your wallet before paying — a payment sent on the wrong chain cannot be recovered.",
    };
  }
  return { ok: true };
}
