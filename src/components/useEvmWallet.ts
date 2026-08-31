"use client";

import { useCallback, useEffect, useState } from "react";
import {
  addEntry,
  firstAccount,
  hexToNumber,
  isUsableEntry,
  makeNonce,
  type EvmWalletEntry,
} from "../lib/wallet/evm-discovery";
import { payerBindingMessage } from "../lib/wallet/evm-binding";

/**
 * The live EIP-6963 registry, and the three calls this product makes of a
 * wallet.
 *
 * **The only file that touches `window`.** Every decision it makes lives in
 * `lib/wallet/evm-discovery.ts` and `lib/wallet/evm-binding.ts`, both pure and
 * both tested in Node. This is the plumbing.
 *
 * The three calls: connect (`eth_requestAccounts`), prove the address is yours
 * (`personal_sign`), and pay (`eth_sendTransaction`). Nothing else — no
 * approvals, no contract writes, no chain-switch prompt. A page that asks a
 * wallet for more than it needs teaches people to approve things.
 *
 * WHO CALLS THIS: `components/BuyTickets.tsx`, on a Robinhood raffle.
 */

export type EvmConnection = { address: string; chainId: number | null; entry: EvmWalletEntry };

export function useEvmWallets(): EvmWalletEntry[] {
  const [wallets, setWallets] = useState<EvmWalletEntry[]>([]);

  useEffect(() => {
    /**
     * EIP-6963 is announce-and-request: wallets announce when they load, and
     * re-announce when asked. Listening BEFORE requesting is what avoids the
     * race where a wallet announced during the render that set up the listener.
     */
    function onAnnounce(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (isUsableEntry(detail)) setWallets((list) => addEntry(list, detail));
    }
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, []);

  return wallets;
}

export function useEvmWallet() {
  const [connection, setConnection] = useState<EvmConnection | null>(null);
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async (entry: EvmWalletEntry) => {
    setConnecting(true);
    try {
      const accounts = await entry.provider.request({ method: "eth_requestAccounts" });
      const address = firstAccount(accounts);
      if (!address) throw new Error("That wallet did not return a usable account.");
      // Read rather than switch. Whether the wallet is on the right chain is
      // `robinhoodPaymentSafety`'s verdict to state, and a site that silently
      // switches somebody's network is a site doing something they did not ask
      // for on a screen about money.
      const chainId = hexToNumber(await entry.provider.request({ method: "eth_chainId" }).catch(() => null));
      setConnection({ address, chainId, entry });
      return { address, chainId, entry };
    } finally {
      setConnecting(false);
    }
  }, []);

  /**
   * Signs the payer binding.
   *
   * The message is built from the SAME function the server verifies against, so
   * there is one definition of the text rather than two that must agree. A
   * mismatch would surface as "that signature does not prove you control this
   * wallet", which is exactly the wrong thing to debug in production.
   */
  const signBinding = useCallback(
    async (input: { connection: EvmConnection; domain: string; slug: string; chainId: number }) => {
      const fields = {
        domain: input.domain,
        address: input.connection.address,
        slug: input.slug,
        chainId: input.chainId,
        nonce: makeNonce(window.crypto),
        issuedAt: new Date().toISOString(),
      };
      const signature = await input.connection.entry.provider.request({
        method: "personal_sign",
        // `personal_sign` takes [message, address] — the reverse of `eth_sign`.
        // Getting the order wrong fails in a way that looks like a bad wallet.
        params: [payerBindingMessage(fields), input.connection.address],
      });
      if (typeof signature !== "string") throw new Error("That wallet did not return a signature.");
      return { signature, ...fields };
    },
    [],
  );

  /**
   * Sends the payment: a plain value transfer, nothing else.
   *
   * No `data`, no contract call. The server verifies the receipt afterwards and
   * derives the payer from the chain, so this transaction carries no claim of
   * its own — which is why there is nothing here to get wrong beyond the
   * recipient and the amount, both quoted by the server.
   */
  const sendPayment = useCallback(
    async (input: { connection: EvmConnection; to: string; valueWei: bigint }) => {
      const hash = await input.connection.entry.provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: input.connection.address,
            to: input.to,
            value: `0x${input.valueWei.toString(16)}`,
          },
        ],
      });
      if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
        throw new Error("That wallet did not return a transaction hash.");
      }
      return hash;
    },
    [],
  );

  return { connection, connecting, connect, signBinding, sendPayment };
}
