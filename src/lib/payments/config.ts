import { base58Decode } from "../base58";

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
function readWallet(name: string): WalletResult {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return { ok: false, reason: `This deployment has no ${name} configured.` };
  }
  if (!isAddressShaped(raw)) {
    return { ok: false, reason: `${name} is not a valid Solana address.` };
  }
  return { ok: true, address: raw };
}

/** Receives ticket payments, listing fees and launch fees. */
export function paymentWallet(): WalletResult {
  return readWallet("PAYMENT_WALLET");
}

/**
 * Holds raffle prizes between deposit and payout.
 *
 * The one wallet in this product that holds somebody else's property. Its
 * private key is not in this repository, not on the server, and not reachable
 * by any code path here — every transfer out of it is performed by a human, and
 * this codebase's only job is to verify that it happened.
 */
export function escrowWallet(): WalletResult {
  return readWallet("ESCROW_WALLET");
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
export function solanaRpcUrls(): string[] {
  return (
    process.env.SOLANA_RPC_URL?.split(",")
      .map((url) => url.trim())
      .filter(Boolean) ?? []
  );
}

export function rpcConfigured(): boolean {
  return solanaRpcUrls().length > 0;
}

/** Confirmations required before a transfer counts as settled. */
export const RPC_COMMITMENT = "confirmed";
/** Attempts per verification, across all configured endpoints. */
export const RPC_MAX_ATTEMPTS = 3;
/** First backoff step; doubles each retry, capped by RPC_BACKOFF_MAX_MS. */
export const RPC_BACKOFF_MS = 300;
/** Ceiling on a single backoff step, so a retry cannot hold a request open. */
export const RPC_BACKOFF_MAX_MS = 1_200;

/**
 * Tolerance when comparing a transaction's on-chain blockTime against a
 * window this server computed. Our clock and the cluster's are not the same
 * clock; two minutes is generous for skew without meaningfully widening the
 * window a payment can land in.
 */
export const BLOCKTIME_SKEW_SECONDS = 120;

// --- Lamports ----------------------------------------------------------------

/** Lamports in one SOL. Not a setting. */
export const LAMPORTS_PER_SOL = 1_000_000_000n;

/**
 * Renders lamports as a SOL amount somebody can read.
 *
 * Trailing zeros trimmed, but never below two decimals, so the number on screen
 * looks like a price rather than like a float. The exact value is kept: this
 * quotes what a wallet is about to be asked for, and a rounded quote next to an
 * unrounded wallet dialog is the kind of small disagreement that makes a payer
 * close the tab.
 */
export function formatSol(lamports: bigint): string {
  const negative = lamports < 0n;
  const value = negative ? -lamports : lamports;
  const whole = value / LAMPORTS_PER_SOL;
  const fraction = (value % LAMPORTS_PER_SOL).toString().padStart(9, "0").replace(/0+$/, "");
  const decimals = fraction.length < 2 ? fraction.padEnd(2, "0") : fraction;
  return `${negative ? "-" : ""}${whole}.${decimals}`;
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
export type FeeResult = { ok: true; lamports: bigint } | { ok: false; reason: string };

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
function solFee(name: string): FeeResult {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === "") {
    return { ok: false, reason: `This deployment has no ${name} configured.` };
  }
  const sol = Number(raw);
  if (!Number.isFinite(sol) || sol < 0) {
    return { ok: false, reason: `${name} is not a non-negative number.` };
  }
  // Rounded to whole lamports, which is what the chain moves.
  return { ok: true, lamports: BigInt(Math.round(sol * Number(LAMPORTS_PER_SOL))) };
}

/** Charged once, in SOL, to create a collection and its candy machine. */
export function launchFee(): FeeResult {
  return solFee("LAUNCH_FEE_SOL");
}

/** Charged once, in SOL, to list a raffle. Antibot as much as revenue. */
export function raffleListingFee(): FeeResult {
  return solFee("RAFFLE_LISTING_FEE_SOL");
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
 * `collections.mint_fee_lamports` record what each one actually charges.
 */
export function mintFeeBps(): BpsResult {
  return bpsFee("MINT_FEE_BPS");
}

/** The house's share of a raffle's ticket sales, in basis points. */
export function houseFeeBps(): BpsResult {
  return bpsFee("HOUSE_FEE_BPS");
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
export function feeLamports(grossLamports: bigint, bps: number): bigint {
  return (grossLamports * BigInt(bps)) / 10_000n;
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
