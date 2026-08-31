import { base58Decode } from "../base58";
import type { ChainId } from "../chain/adapter";

/**
 * Payment configuration: the wallets, the RPC, and the four fees.
 *
 * **We only ever RECEIVE.** There is no private key, no signing and no
 * withdrawal path anywhere in this project (CLAUDE.md). Both wallets are
 * operated entirely outside it and are supplied by environment.
 *
 * WHO CALLS THIS: `chain/rpc.ts` (endpoints and retry constants),
 * `payments/sol-transfer.ts` (skew), every route that quotes a price, and every
 * screen that has to decide whether its surface is open at all.
 */

/**
 * The environment-variable suffix for each chain.
 *
 * A map rather than `chain.toUpperCase()`, so the variable names stay a
 * deliberate list rather than a function of an identifier somebody might
 * rename. `SOLANA` and `ROBINHOOD` are what `.env.example` documents.
 */
const ENV_SUFFIX: Record<ChainId, string> = {
  solana: "SOLANA",
  robinhood: "ROBINHOOD",
};

/**
 * Decimal places in each chain's native unit.
 *
 * Duplicated from the per-chain constants on purpose: this module must not
 * import `chain/solana/*` or `chain/robinhood/*`, because those import the
 * adapter which imports this file. Two small numbers restated is a better trade
 * than an import cycle, and both are covered by the fee tests.
 */
const NATIVE_DECIMALS: Record<ChainId, number> = {
  solana: 9,
  robinhood: 18,
};

// --- Addresses ---------------------------------------------------------------

/**
 * A Solana address is a 32-byte Ed25519 public key, which is 32 bytes of
 * base58. Checked here rather than by constructing a `PublicKey`, so that
 * nothing server-side has to import a wallet library to validate a string.
 */
const PUBKEY_BYTES = 32;

/** Long enough for any real address; short enough that the O(n²) decoder cannot be weaponised. */
export const MAX_RAW_ADDRESS_LENGTH = 64;

export function isAddressShaped(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_RAW_ADDRESS_LENGTH) return false;
  const decoded = base58Decode(trimmed);
  return decoded !== null && decoded.length === PUBKEY_BYTES;
}

export type WalletResult = { ok: true; address: string } | { ok: false; reason: string };

/**
 * Reads and validates a configured wallet.
 *
 * **Deliberately has no fallback and no placeholder.** A default here would
 * mean a misconfigured deploy quietly collects real money to somebody else's
 * address, and a placeholder is worse than a default because a placeholder that
 * happens to be a valid address is an address that receives.
 *
 * The absence of either wallet is a first-class product state, not an error:
 * the surfaces that need it close with their own screen (spec §6).
 */
/**
 * Address shapes, per chain.
 *
 * **This used to be Solana-only, and it silently closed every Robinhood
 * surface.** `isAddressShaped` base58-decodes and requires 32 bytes; a
 * perfectly good EVM address fails that and was reported as "not a valid
 * Solana address" — from a function that had no idea which chain it was reading
 * for. The failure was indistinguishable from "not configured", so a fully
 * configured EVM deployment looked unconfigured.
 *
 * Checked here rather than through `adapterFor(chain).isAddress` because the
 * adapters import this module, and an import cycle between configuration and
 * the things configured by it is a worse problem than two regexes.
 */
const ADDRESS_SHAPE: Record<ChainId, (value: string) => boolean> = {
  solana: isAddressShaped,
  robinhood: (value) => /^0x[0-9a-fA-F]{40}$/.test(value),
};

const CHAIN_LABEL: Record<ChainId, string> = {
  solana: "Solana",
  robinhood: "Robinhood Chain",
};

function readWallet(name: string, chain: ChainId): WalletResult {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return { ok: false, reason: `This deployment has no ${name} configured.` };
  }
  if (!ADDRESS_SHAPE[chain](raw)) {
    return { ok: false, reason: `${name} is not a valid ${CHAIN_LABEL[chain]} address.` };
  }
  return { ok: true, address: raw };
}

/**
 * Receives ticket payments, listing fees and launch fees, on one chain.
 *
 * **Suffixed per chain** (docs/decisions.md Q9), and the two wallets must be
 * different addresses on different chains — an EVM address is not a Solana
 * address and neither can receive the other's funds.
 */
export function paymentWallet(chain: ChainId): WalletResult {
  return readWallet(`PAYMENT_WALLET_${ENV_SUFFIX[chain]}`, chain);
}

/**
 * Holds raffle prizes between deposit and payout.
 *
 * The one wallet in this product that holds somebody else's property. Its
 * private key is not in this repository, not on the server, and not reachable
 * by any code path here — every transfer out of it is performed by a human, and
 * this codebase's only job is to verify that it happened.
 */
export function escrowWallet(chain: ChainId): WalletResult {
  return readWallet(`ESCROW_WALLET_${ENV_SUFFIX[chain]}`, chain);
}

// --- RPC ---------------------------------------------------------------------

/**
 * Solana RPC endpoints, tried in order, comma-separated.
 *
 * **No default.** The sibling project defaulted to the public mainnet endpoint;
 * this one cannot, because DAS methods (`getAsset`, `getAssetsByOwner`) are not
 * served by the public node, so a deployment that silently fell back to it
 * would fail on the launchpad and raffle paths in a way that looks like a bug
 * rather than like missing configuration. An empty list closes the on-chain
 * surfaces, which is the honest outcome.
 */
function rpcUrls(name: string): string[] {
  return (
    process.env[name]?.split(",")
      .map((url) => url.trim())
      .filter(Boolean) ?? []
  );
}

export function solanaRpcUrls(): string[] {
  return rpcUrls("SOLANA_RPC_URL");
}

/**
 * Robinhood Chain endpoints.
 *
 * **Testnet only for now** (docs/decisions.md, the approved sequence): the
 * adapter is built and its surface stays closed until one real raffle has run
 * end to end on Solana. Nothing enforces testnet here — the variable takes
 * whatever it is given — because `surfaceState` is what keeps the surface shut,
 * and putting a second gate in the config would mean two places to open.
 */
export function evmRpcUrls(): string[] {
  return rpcUrls("ROBINHOOD_RPC_URL");
}

export function rpcConfigured(chain: ChainId): boolean {
  return (chain === "solana" ? solanaRpcUrls() : evmRpcUrls()).length > 0;
}


// --- Native amounts ----------------------------------------------------------

/**
 * Renders an amount in a chain's native unit.
 *
 * **Takes `decimals` rather than assuming nine.** The Solana-only version of
 * this hardcoded lamports, and an EVM amount rendered through it would be off
 * by a billion — in the direction where the number still looks plausible.
 *
 * Trailing zeros trimmed, but never below two decimals, so the number reads as
 * a price rather than a float. The exact value is kept: this quotes what a
 * wallet is about to be asked for, and a rounded quote beside an unrounded
 * wallet dialog is what makes a payer close the tab.
 */
export function formatNative(amount: bigint, decimals: number): string {
  const negative = amount < 0n;
  const value = negative ? -amount : amount;
  const unit = 10n ** BigInt(decimals);
  const whole = value / unit;
  const fraction = (value % unit).toString().padStart(decimals, "0").replace(/0+$/, "");
  const shown = fraction.length < 2 ? fraction.padEnd(2, "0") : fraction;
  return `${negative ? "-" : ""}${whole}.${shown}`;
}

// --- The four fees -----------------------------------------------------------

/**
 * Every fee is read from the environment and **none has a default**.
 *
 * This is the rule DESIGN.md §8.2 makes normative, and it is stricter than the
 * sibling project's, which defaulted its registration fee to 0.003 SOL. The
 * difference is that a default fee here would be quoted in copy on a screen
 * where somebody is deciding whether to launch or list — and a number in a
 * sentence that nothing enforces is the exact defect §8.2 exists to prevent.
 *
 * A missing fee therefore closes its surface rather than charging a guess.
 * `null` is the honest answer and every caller has to handle it.
 */
export type FeeResult = { ok: true; amount: bigint } | { ok: false; reason: string };

/**
 * A SOL-denominated fee from the environment, in lamports.
 *
 * **Zero is valid and it is the door.** Set a fee to `0` and it switches off
 * with a variable and no deploy — which is what makes "launch that shows the
 * fee is killing the volume" a one-minute change instead of a release. Unset is
 * a different thing from zero and closes the surface; the two must not collapse
 * into each other, which is why this reads `undefined` separately rather than
 * coercing through `??`.
 */
function nativeFee(name: string, decimals: number): FeeResult {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === "") {
    return { ok: false, reason: `This deployment has no ${name} configured.` };
  }
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    return { ok: false, reason: `${name} is not a non-negative decimal number.` };
  }

  /**
   * Parsed as a DECIMAL STRING, never through `Number`.
   *
   * ETH has 18 decimals and a double holds about 15-16 significant digits, so
   * `Number("0.000000000000000001") * 1e18` does not reliably give 1. The
   * Solana path survived `Number` because 9 decimals fits; the EVM path does
   * not, and one shared parser that is correct for both is better than two
   * where only one has been thought about.
   */
  const [whole, fraction = ""] = raw.split(".");
  if (fraction.length > decimals) {
    return { ok: false, reason: `${name} has more than ${decimals} decimal places.` };
  }
  const padded = fraction.padEnd(decimals, "0");
  return { ok: true, amount: BigInt(whole + padded) };
}

/** Charged once, in the chain's native currency, to create a collection. */
export function launchFee(chain: ChainId): FeeResult {
  return nativeFee(`LAUNCH_FEE_${ENV_SUFFIX[chain]}`, NATIVE_DECIMALS[chain]);
}

/**
 * Charged once, in the chain's native currency, to list a raffle. Antibot as
 * much as revenue.
 */
export function raffleListingFee(chain: ChainId): FeeResult {
  return nativeFee(`RAFFLE_LISTING_FEE_${ENV_SUFFIX[chain]}`, NATIVE_DECIMALS[chain]);
}

export type BpsResult = { ok: true; bps: number } | { ok: false; reason: string };

/**
 * A basis-point fee from the environment.
 *
 * Whole basis points only. A fractional bps has no representation on the chain
 * — every amount derived from it is rounded to lamports anyway — so accepting
 * one would mean quoting a precision the money path does not have.
 */
function bpsFee(name: string): BpsResult {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === "") {
    return { ok: false, reason: `This deployment has no ${name} configured.` };
  }
  const bps = Number(raw);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    return { ok: false, reason: `${name} must be a whole number of basis points between 0 and 10000.` };
  }
  return { ok: true, bps };
}

/**
 * The platform's share of a mint, in basis points.
 *
 * Applied as the candy machine's `solFixedFee` guard rather than as an
 * instruction our client appends — see spec §0.1. That means it is converted to
 * **fixed lamports at candy-machine creation time** and frozen for that
 * machine's life, so changing this value reaches collections launched
 * afterwards and not live ones. `collections.mint_fee_bps` and
 * `collections.mint_fee_native` record what each one actually charges.
 */
export function mintFeeBps(chain: ChainId): BpsResult {
  return bpsFee(`MINT_FEE_BPS_${ENV_SUFFIX[chain]}`);
}

/**
 * The house's share of a raffle's ticket sales, in basis points, per chain.
 *
 * **Suffixed even though a ratio has no currency** (docs/decisions.md Q9). The
 * analysis recommended sharing one value; the owner's reasoning is better and
 * is recorded there — gas, audience and price expectations differ per chain, so
 * forcing one house fee across chains is a constraint nobody asked for.
 */
export function houseFeeBps(chain: ChainId): BpsResult {
  return bpsFee(`HOUSE_FEE_BPS_${ENV_SUFFIX[chain]}`);
}

/**
 * A fee's lamport amount, from a gross and a basis-point rate.
 *
 * Integer arithmetic throughout and rounding DOWN, so the fee can never exceed
 * the gross and the seller's net can never be negative by a rounding lamport.
 * Which direction to round is arbitrary in the abstract and not arbitrary here:
 * rounding a fee up is the platform taking a lamport it did not earn, on every
 * raffle, forever.
 */
export function feeAmount(gross: bigint, bps: number): bigint {
  return (gross * BigInt(bps)) / 10_000n;
}

/**
 * Where somebody whose payment did not match is told to go.
 *
 * The convention is a `support@` inbox on this project's own domain, the same
 * one the sibling projects follow (`docs/decisions.md` Q6). `null` is a real
 * answer and is the current state, because there is no domain yet — copy that
 * reads this must degrade to "this has been recorded" rather than inventing a
 * channel.
 */
export function supportContact(): string | null {
  return process.env.SUPPORT_CONTACT?.trim() || null;
}

// --- Windows -----------------------------------------------------------------

/** How long a ticket order holds its price before it expires and must be reopened. */
export const PAYMENT_WINDOW_MINUTES = 30;

/**
 * Rate limits on verification. Without them, one order id could drive unlimited
 * RPC calls — checking a payment costs a real request to the cluster, and that
 * request is spent whether or not the payment turns out to exist.
 */
export const VERIFY_LIMITS = {
  /** Attempts allowed against a single order within the window. */
  perOrder: 10,
  /** Attempts allowed from one caller within the window, across all orders. */
  perIp: 30,
  windowMinutes: 10,
  /** Minimum gap between two attempts on the same order, in seconds. */
  minIntervalSeconds: 3,
} as const;
