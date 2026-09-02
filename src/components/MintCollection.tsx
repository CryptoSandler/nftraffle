"use client";

import { useState } from "react";
import { isLocalHostname, paymentSafety, type ProxyCluster } from "../lib/chain/solana/cluster";
import { walletErrorMessage } from "../lib/checkout";
import { useSolanaWallet } from "./useSolanaWallet";
import { useSolanaWallets } from "./useSolanaWallets";

/**
 * Minting from a collection launched here.
 *
 * **The same hygiene as the buy panel, for the same reason** — the server
 * builds the transaction and simulates it, and its absence is what stops the
 * wallet opening (`docs/wallet-warnings.md`). It matters more here: a candy
 * machine mint that fails a guard still takes the `botTax`, so a transaction
 * that cannot succeed costs the minter money AND shows them a red screen.
 *
 * **The two amounts are quoted from the collection row**, which was written
 * only after the deployed machine was read back and agreed with it. The fee is
 * a fixed number of SOL frozen into the machine at launch, not a percentage
 * applied at mint time (spec §0.1).
 *
 * WHO CALLS THIS: `src/app/c/[chain]/[slug]/page.tsx`, on a live collection.
 */

type Props = {
  slug: string;
  proxyCluster: ProxyCluster;
  isProduction: boolean;
  priceDisplay: string;
  mintFeeDisplay: string;
  nativeSymbol: string;
  remaining: number;
  /** When the machine opens. Null when it always was open. */
  startsAtMs: number | null;
  /** The same instant, formatted the way every other surface formats one. */
  startsAtText: string | null;
};

type Phase =
  | { step: "idle" }
  | { step: "working"; note: string }
  | { step: "minted"; asset: string }
  | { step: "error"; message: string };

export function MintCollection({
  slug,
  proxyCluster,
  isProduction,
  priceDisplay,
  mintFeeDisplay,
  nativeSymbol,
  remaining,
  startsAtMs,
  startsAtText,
}: Props) {
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  /**
   * Read once, on mount, rather than on every render: a component that asks
   * the clock while rendering gives a different answer each time React happens
   * to run it. The page is dynamic, so a minute's staleness is the cost and the
   * machine refuses an early mint anyway.
   */
  const [openedAt] = useState(() => Date.now());

  const signingChain = proxyCluster === "unknown" ? "unknown" : proxyCluster;
  const wallets = useSolanaWallets(signingChain);
  const { connection, connecting, connect, signAndSendWire } = useSolanaWallet();

  const safety = paymentSafety({
    localOrigin: typeof window !== "undefined" && isLocalHostname(window.location.hostname),
    signingChain,
    proxyCluster,
    isProduction,
  });
  if (!safety.ok) return <Notice>{safety.message}</Notice>;

  async function mint() {
    if (!connection) return;
    try {
      setPhase({ step: "working", note: "Preparing your mint…" });
      const response = await fetch(`/api/collections/${slug}/mint`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ minter: connection.account.address }),
      });
      const intent = await response.json();
      if (!intent.transaction) {
        setPhase({
          step: "error",
          message: intent.error ?? "This mint could not be prepared. Nothing has been charged.",
        });
        return;
      }

      setPhase({ step: "working", note: "Waiting for your wallet…" });
      let signature: string;
      try {
        // Partially signed: the minted asset's own account signs its creation.
        signature = await signAndSendWire(intent.transaction, signingChain, { forceSignOnly: true });
      } catch (error) {
        console.error(error);
        setPhase({ step: "error", message: walletErrorMessage(error) });
        return;
      }
      console.info(`mint submitted: ${signature}`);
      setPhase({ step: "minted", asset: intent.asset });
    } catch (error) {
      console.error(error);
      setPhase({
        step: "error",
        message: "Something went wrong. Your wallet may not have been charged.",
      });
    }
  }

  if (remaining <= 0) {
    return <Notice>Every item in this collection has been minted.</Notice>;
  }

  return (
    <div className="space-y-4">
      {safety.devnet && (
        <p className="rounded border border-edge bg-panel p-3 text-sm">
          <strong>Devnet.</strong> This deployment settles on Solana devnet. Nothing minted here is
          a real item.
        </p>
      )}

      {startsAtMs !== null && startsAtMs > openedAt && startsAtText && (
        <p className="text-sm text-quiet">
          Minting opens at <span className="figure">{startsAtText}</span>. A mint before then is
          refused by the machine itself.
        </p>
      )}

      {!connection ? (
        <div>
          <p className="text-quiet">
            Connect a wallet to mint. You pay{" "}
            <span className="figure">{priceDisplay} {nativeSymbol}</span> to the creator and{" "}
            <span className="figure">{mintFeeDisplay} {nativeSymbol}</span> to this site, both
            charged by the mint machine itself.
          </p>
          {wallets.length === 0 ? (
            <p className="mt-3 text-sm text-quiet">No Solana wallet was detected in this browser.</p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {wallets.map((wallet) => (
                <li key={wallet.name}>
                  <button
                    type="button"
                    disabled={connecting}
                    onClick={() =>
                      connect(wallet).catch((e) =>
                        setPhase({ step: "error", message: walletErrorMessage(e) }),
                      )
                    }
                    className="control text-sm"
                  >
                    {wallet.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="control-primary"
          onClick={() => void mint()}
          disabled={phase.step === "working"}
        >
          {phase.step === "working" ? "Working…" : "Mint one"}
        </button>
      )}

      {phase.step === "working" && <p className="text-sm text-quiet">{phase.note}</p>}
      {phase.step === "error" && <Notice>{phase.message}</Notice>}
      {phase.step === "minted" && (
        <p className="rounded border border-edge bg-panel p-3">
          Minted. Your item is <span className="figure break-all">{phase.asset}</span>.
        </p>
      )}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded border border-edge bg-panel p-3 text-sm">{children}</p>;
}
