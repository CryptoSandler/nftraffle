/**
 * Reading the browser's Wallet Standard registry directly.
 *
 * **WHY THIS EXISTS INSTEAD OF `@solana/wallet-adapter-react`.** That package
 * is the conventional choice and it was the original plan. It pulls
 * `@solana-mobile/wallet-adapter-mobile`, which pulls the whole of
 * `react-native` and its metro build toolchain — and every one of the 19
 * advisories `npm audit` reported against this project came from that subtree
 * or from `@solana/web3.js` underneath it. None of that code runs in a Next
 * build, so the advisories were not exploitable here; they were also not
 * dismissible, because "our audit is noisy but the noise is fine" is a habit
 * that hides the one advisory that matters.
 *
 * What the adapter actually provided for this product was wallet discovery and
 * a connect call. The Wallet Standard is the protocol underneath it and both
 * are one small package each. Removing the adapter took the dependency count
 * from 419 to 163 and the audit to zero.
 *
 * **What is given up, stated plainly:** the adapter's mobile deep-linking, its
 * autoconnect, and its prebuilt modal. Mobile wallets that implement the Wallet
 * Standard in their in-app browser still work; a mobile wallet reachable only
 * by deep link does not. That is a real gap and it is a product question rather
 * than an oversight — recorded in the report rather than papered over.
 *
 * **This module is pure and knows nothing about React or `window`.** The
 * registry is read by `useSolanaWallets` in `src/components/useSolanaWallets.ts`;
 * everything here is a decision about a list, which is what makes it testable
 * in Node.
 *
 * WHO CALLS THIS: `useSolanaWallets`, which is the only thing that touches the
 * live registry. That hook currently has NO caller of its own — the buy panel
 * is Batch C task C2 in `docs/superpowers/plans/2026-08-28-remaining-batches.md`
 * — and that is said out loud rather than implied, per CLAUDE.md.
 */

/** Feature identifiers, from `@solana/wallet-standard-features`. */
export const SOLANA_SIGN_AND_SEND = "solana:signAndSendTransaction";
export const SOLANA_SIGN_TRANSACTION = "solana:signTransaction";
/** From `@wallet-standard/features`. Without it there is no way to get an account. */
export const STANDARD_CONNECT = "standard:connect";

/**
 * The part of a Wallet Standard `Wallet` this module reads.
 *
 * Structurally typed rather than importing the interface, so the pure logic can
 * be driven by fixtures without constructing a real wallet. A live `Wallet`
 * satisfies it.
 */
export type ReadableWallet = {
  readonly name: string;
  readonly icon: string;
  readonly chains: readonly string[];
  readonly features: Readonly<Record<string, unknown>>;
};

/** How a wallet can pay: it submits, or we do. */
export type WalletCapability = "sign_and_send" | "sign_only";

export type UsableWallet = {
  name: string;
  icon: string;
  capability: WalletCapability;
  /** The registration itself, so a caller can connect and sign with it. */
  wallet: ReadableWallet;
};

/**
 * What this wallet can do on `chain`, or null if it is no use to us.
 *
 * **Fails closed on every axis**, because the permissive direction produces a
 * Connect button that leads somewhere it cannot pay from — and the person only
 * finds out after approving something.
 *
 * The chain check is the one that costs money if it is skipped: a wallet
 * speaking only devnet, offered on a deployment settling on mainnet, produces a
 * payment on a chain where it can never be credited. `paymentSafety` in
 * `chain/cluster.ts` blocks that signature too; this is the same refusal one
 * layer earlier, before anybody has been invited to try.
 *
 * Never throws. The registry is populated by browser extensions nobody here
 * controls, and a page that throws while enumerating them shows none of the
 * wallets that registered correctly.
 */
export function walletCapability(
  wallet: ReadableWallet,
  chain: string,
): WalletCapability | null {
  const chains = Array.isArray(wallet?.chains) ? wallet.chains : [];
  if (!chains.includes(chain)) return null;

  const features = wallet?.features;
  if (typeof features !== "object" || features === null) return null;

  // Without `standard:connect` there is no way to obtain an account, so
  // whatever else the wallet supports is unreachable.
  if (!(STANDARD_CONNECT in features)) return null;

  // Sign-and-send first: the wallet submits, so the browser never needs an
  // endpoint for the send, and the wallet owns preflight and retries.
  if (SOLANA_SIGN_AND_SEND in features) return "sign_and_send";
  if (SOLANA_SIGN_TRANSACTION in features) return "sign_only";

  // A wallet offering only `solana:signMessage` can prove an identity and
  // cannot pay for anything.
  return null;
}

/**
 * The registered wallets this deployment can actually use, in registry order.
 *
 * **Deliberately not sorted and not ranked.** Ordering wallets is a
 * recommendation, and this product has no basis for recommending one over
 * another — the registry's order is whatever the browser saw first, which is at
 * least not an opinion we invented.
 *
 * Deduplicated by name because some extensions register twice, once eagerly and
 * once on the app-ready event, and a list reading "Phantom, Phantom" reads as a
 * bug in our page rather than in theirs.
 */
export function usableWallets(
  wallets: readonly ReadableWallet[],
  chain: string,
): UsableWallet[] {
  const seen = new Set<string>();
  const usable: UsableWallet[] = [];

  for (const wallet of wallets ?? []) {
    const capability = walletCapability(wallet, chain);
    if (!capability) continue;
    if (seen.has(wallet.name)) continue;
    seen.add(wallet.name);
    usable.push({ name: wallet.name, icon: wallet.icon, capability, wallet });
  }

  return usable;
}
