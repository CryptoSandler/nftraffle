/**
 * Finding the browser's EVM wallets, by EIP-6963.
 *
 * **No dependency, and that is the whole point.** The EVM equivalent of
 * `@solana/wallet-adapter-react` is a connection library that brings a
 * dependency tree measured in hundreds of packages; what this product needs
 * from it is a list of injected providers and a request call. EIP-6963 is that
 * list, and it is an event on `window` — the same trade `wallet/solana-standard.ts`
 * already made, for the same reason: the audit stays at zero and the surface
 * stays small enough to read.
 *
 * **EIP-6963 rather than `window.ethereum`.** The old single global is a slot
 * two wallets fight over — whichever injected last wins, and the person ends up
 * signing from a wallet they did not choose. The discovery event gives every
 * installed wallet its own entry with its own provider, so the choice belongs
 * to the person rather than to injection order.
 *
 * **This module is pure and knows nothing about React or `window`.** It decides
 * things about a list, which is what makes it testable in Node.
 *
 * WHO CALLS THIS: `components/useEvmWallet.ts`, which is the only thing that
 * listens to the live event, and which is used by `components/BuyTickets.tsx`
 * on a Robinhood raffle.
 */

/** The parts of an EIP-1193 provider this product uses. */
export type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

/** One entry from an EIP-6963 announcement. */
export type EvmWalletEntry = {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
};

/**
 * Whether an announcement is shaped like one we can use.
 *
 * These arrive from any extension on the page, so the shape is checked rather
 * than assumed. A malformed entry is dropped silently: a wallet nobody can name
 * is not one to offer, and an exception here would break the panel for every
 * OTHER wallet the person has installed.
 */
export function isUsableEntry(value: unknown): value is EvmWalletEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as { info?: unknown; provider?: unknown };
  const info = entry.info as Record<string, unknown> | undefined;
  if (typeof info !== "object" || info === null) return false;
  if (typeof info.uuid !== "string" || info.uuid.length === 0) return false;
  if (typeof info.name !== "string" || info.name.length === 0) return false;
  if (typeof info.rdns !== "string" || info.rdns.length === 0) return false;
  const provider = entry.provider as { request?: unknown } | undefined;
  return typeof provider === "object" && provider !== null && typeof provider.request === "function";
}

/**
 * Adds an entry to the list, keeping one per wallet.
 *
 * **Deduplicated by `rdns`, not by `uuid`.** A wallet re-announces on every
 * request for the list — that is how the protocol works — and a fresh `uuid`
 * each time is allowed. Keying on `uuid` produces a list that grows with the
 * same wallet repeated, which is a real bug people hit and not a theoretical
 * one; `rdns` is the stable identifier the spec provides for exactly this.
 *
 * The LATEST provider wins, because a re-announcement is the wallet telling us
 * which object to use now.
 */
export function addEntry(list: readonly EvmWalletEntry[], entry: EvmWalletEntry): EvmWalletEntry[] {
  const without = list.filter((existing) => existing.info.rdns !== entry.info.rdns);
  return [...without, entry].sort((a, b) => a.info.name.localeCompare(b.info.name));
}

/** A hex quantity (`0x…`) as a number, or null. Chain ids arrive this way. */
export function hexToNumber(value: unknown): number | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  try {
    const n = Number(BigInt(value));
    return Number.isSafeInteger(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * The first account an EIP-1193 provider returned, validated as an address.
 *
 * The provider is an extension we do not control, so the value is checked
 * rather than trusted. An unvalidated address here becomes an order's payer,
 * and an order whose payer is nonsense can never be settled.
 */
export function firstAccount(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = value[0];
  if (typeof first !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(first.trim())) return null;
  return first.trim();
}

/** A nonce for the payer binding: 16 hex characters from the platform's CSPRNG. */
export function makeNonce(random: Pick<Crypto, "getRandomValues">): string {
  const bytes = new Uint8Array(8);
  random.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
