"use client";

import { getWallets } from "@wallet-standard/app";
import { useSyncExternalStore } from "react";
import { usableWallets, type ReadableWallet, type UsableWallet } from "../lib/wallet/solana-standard";

/**
 * The live Wallet Standard registry, as a React value.
 *
 * **This is the entire replacement for `@solana/wallet-adapter-react`'s
 * discovery**, and it is deliberately this small. See
 * `src/lib/wallet/solana-standard.ts` for why the adapter was dropped and what
 * is given up with it.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`, because the
 * registry is exactly what that hook is for: an external mutable source with a
 * subscribe function. It also gets the server snapshot right, which matters
 * here — the registry does not exist during SSR, and a component that assumed
 * it did would hydrate against a different list than it rendered.
 *
 * WHO CALLS THIS: nothing yet. The buy panel is Batch C task C2 in
 * `docs/superpowers/plans/2026-08-28-remaining-batches.md`, and this hook is
 * what it will read. Stated out loud rather than implied, because this repo's
 * siblings have shipped finished, tested modules that nothing ever called.
 */

const EMPTY: readonly ReadableWallet[] = [];

/**
 * Subscribes to registrations and unregistrations.
 *
 * Both events matter: a wallet extension that is disabled or updated mid-session
 * unregisters, and a list still offering it produces a Connect button that
 * silently does nothing.
 */
function subscribe(onChange: () => void): () => void {
  const { on } = getWallets();
  const offRegister = on("register", onChange);
  const offUnregister = on("unregister", onChange);
  return () => {
    offRegister();
    offUnregister();
  };
}

/**
 * The registry's current contents.
 *
 * `getWallets().get()` returns a new array identity only when the set actually
 * changes, which is what `useSyncExternalStore` needs to avoid an infinite
 * render loop. The cast is the one place this file leans on the registry's own
 * types matching `ReadableWallet`, which it does structurally.
 */
function getSnapshot(): readonly ReadableWallet[] {
  return getWallets().get() as readonly ReadableWallet[];
}

/**
 * On the server there is no registry, and there is no honest guess to make.
 *
 * A constant empty array rather than a fresh one, so the identity is stable
 * across renders — returning `[]` here is a classic `useSyncExternalStore`
 * infinite loop.
 */
function getServerSnapshot(): readonly ReadableWallet[] {
  return EMPTY;
}

/**
 * The wallets that can sign on `chain`, or an empty list.
 *
 * `chain` is passed in rather than read from configuration, because the caller
 * gets it from the server — classified there and passed down as a NAME, never
 * as the RPC URL (CLAUDE.md, "Showing the network before a signature"). A hook
 * that read the endpoint itself would undo that from the other direction.
 */
export function useSolanaWallets(chain: string): UsableWallet[] {
  const registered = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return usableWallets(registered, chain);
}
