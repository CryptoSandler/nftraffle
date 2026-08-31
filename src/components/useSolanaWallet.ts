"use client";

import { useCallback, useState } from "react";
import type { UsableWallet } from "../lib/wallet/solana-standard";
import { SOLANA_SIGN_AND_SEND, SOLANA_SIGN_TRANSACTION, STANDARD_CONNECT } from "../lib/wallet/solana-standard";

/**
 * Connecting to a Wallet Standard wallet and getting a transaction signed.
 *
 * **The whole replacement for `@solana/wallet-adapter-react`'s connection
 * handling**, in about eighty lines. See `lib/wallet/solana-standard.ts` for why
 * the adapter was dropped — the short version is that it pulled `react-native`
 * and every advisory `npm audit` reported.
 *
 * Two paths, because wallets offer two features and neither is universal:
 *
 *  - `solana:signAndSendTransaction` — the wallet submits. Preferred: one fewer
 *    round trip through our proxy, and the wallet owns preflight and retries.
 *  - `solana:signTransaction` — the wallet signs and WE submit, through
 *    `/api/rpc`. The endpoint still never reaches the browser.
 *
 * WHO CALLS THIS: `src/components/BuyTickets.tsx`.
 */

/** The subset of a Wallet Standard account this component uses. */
type WalletAccount = { address: string; features?: readonly string[] };

type ConnectFeature = { connect: () => Promise<{ accounts: readonly WalletAccount[] }> };
type SignAndSendFeature = {
  signAndSendTransaction: (
    ...inputs: { account: WalletAccount; transaction: Uint8Array; chain: string }[]
  ) => Promise<readonly { signature: Uint8Array }[]>;
};
type SignFeature = {
  signTransaction: (
    ...inputs: { account: WalletAccount; transaction: Uint8Array }[]
  ) => Promise<readonly { signedTransaction: Uint8Array }[]>;
};

export type Connection = { wallet: UsableWallet; account: WalletAccount };

export function useSolanaWallet() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async (wallet: UsableWallet) => {
    setConnecting(true);
    try {
      const feature = wallet.wallet.features[STANDARD_CONNECT] as ConnectFeature | undefined;
      if (!feature?.connect) throw new Error("This wallet cannot be connected.");

      const { accounts } = await feature.connect();
      const account = accounts[0];
      // A wallet can connect and grant no account — the person dismissed the
      // account picker. That is not an error to shout about, but it is not a
      // connection either.
      if (!account) throw new Error("No account was shared.");

      setConnection({ wallet, account });
      return { wallet, account };
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => setConnection(null), []);

  /**
   * Signs, submits, and returns the base58 signature.
   *
   * The `sign_only` path posts the signed bytes to `/api/rpc`'s
   * `sendTransaction`, which is on the whitelist. `base64` because that is what
   * the method takes and what `getBase64EncodedWireTransaction` produces.
   */
  const signAndSendWire = useCallback(
    async (base64Transaction: string, chain: string): Promise<string> => {
      if (!connection) throw new Error("No wallet is connected.");
      const { wallet, account } = connection;
      /**
       * The bytes come from the SERVER, already compiled and already simulated
       * there. Nothing is assembled in the browser any more — see
       * `lib/chain/solana/payment-intent.ts` and `docs/wallet-warnings.md`.
       *
       * `chain` is passed explicitly on every call. A Wallet Standard wallet
       * that is not told which chain may pick one, and the one it picks is
       * whatever it was last set to.
       */
      const bytes = Uint8Array.from(atob(base64Transaction), (c) => c.charCodeAt(0));

      if (wallet.capability === "sign_and_send") {
        const feature = wallet.wallet.features[SOLANA_SIGN_AND_SEND] as SignAndSendFeature;
        const [{ signature }] = await feature.signAndSendTransaction({
          account,
          transaction: bytes,
          chain,
        });
        return base58(signature);
      }

      const feature = wallet.wallet.features[SOLANA_SIGN_TRANSACTION] as SignFeature;
      const [{ signedTransaction }] = await feature.signTransaction({ account, transaction: bytes });

      const response = await fetch("/api/rpc/solana", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "sendTransaction",
          params: [toBase64(signedTransaction), { encoding: "base64" }],
        }),
      });
      const body = (await response.json()) as { result?: string; error?: { message?: string } };
      if (!body.result) {
        // The proxy never relays an upstream body, so whatever comes back is a
        // message we wrote. Showing it is safe.
        throw new Error(body.error?.message ?? "The network did not accept this transaction.");
      }
      return body.result;
    },
    [connection],
  );

  return { connection, connecting, connect, disconnect, signAndSendWire };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Signature bytes to base58.
 *
 * `solana:signAndSendTransaction` returns raw bytes; every server route and
 * every explorer wants base58. Encoding it here keeps `base58.ts` as the one
 * implementation in the project — see that file's header for what happened the
 * last time this codebase had two.
 */
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(bytes: Uint8Array): string {
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let leading = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    leading += ALPHABET[0];
  }
  return leading + digits.reverse().map((d) => ALPHABET[d]).join("");
}
