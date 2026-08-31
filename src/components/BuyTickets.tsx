"use client";

import { useState } from "react";
import { buildTicketPaymentMessage } from "../lib/chain/solana/payment-tx";
import { isLocalHostname, paymentSafety, type ProxyCluster } from "../lib/chain/solana/cluster";
import { checkoutOutcome, isRetryableConfirmReason, walletErrorMessage } from "../lib/checkout";
import { useSolanaWallet } from "./useSolanaWallet";
import { useSolanaWallets } from "./useSolanaWallets";

/**
 * Buying tickets.
 *
 * The only client-side money path in this product. Everything it decides that
 * matters lives in `lib/checkout.ts`, which is testable from Node; this file is
 * the wallet plumbing and the rendering.
 *
 * **The cluster disclosure is not decoration.** The browser only ever talks to
 * `/api/rpc`, so it cannot see which cluster the proxy points at. The server
 * classifies it and passes down the ANSWER — a name, never the URL — and
 * `paymentSafety` blocks signing when it is `unknown`, when the wallet and the
 * proxy disagree, and when it is not mainnet on a production deployment.
 *
 * WHO CALLS THIS: `src/app/r/[slug]/page.tsx`, on an open raffle.
 */

type Props = {
  slug: string;
  /** Classified server-side. Never the endpoint. */
  proxyCluster: ProxyCluster;
  /** From VERCEL_ENV, server-side. The browser cannot be trusted to know. */
  isProduction: boolean;
  ticketPriceDisplay: string;
  nativeSymbol: string;
  ticketsRemaining: number;
};

type Phase =
  | { step: "idle" }
  | { step: "working"; note: string }
  | { step: "done"; tickets: number[] }
  | { step: "filed"; message: string }
  | { step: "error"; message: string };

export function BuyTickets({
  slug,
  proxyCluster,
  isProduction,
  ticketPriceDisplay,
  nativeSymbol,
  ticketsRemaining,
}: Props) {
  const [quantity, setQuantity] = useState(1);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });

  // The chain the wallet will be asked to sign on. It must match the proxy's,
  // and `paymentSafety` is what refuses when it does not.
  const signingChain = proxyCluster === "unknown" ? "unknown" : proxyCluster;
  const wallets = useSolanaWallets(signingChain);
  const { connection, connecting, connect, signAndSend } = useSolanaWallet();

  const safety = paymentSafety({
    localOrigin: typeof window !== "undefined" && isLocalHostname(window.location.hostname),
    signingChain,
    proxyCluster,
    isProduction,
  });

  if (!safety.ok) {
    return <Notice>{safety.message}</Notice>;
  }

  async function buy() {
    if (!connection) return;
    setPhase({ step: "working", note: "Opening the order…" });

    try {
      const orderResponse = await fetch(`/api/raffles/${slug}/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quantity, payerPubkey: connection.account.address }),
      });
      const order = await orderResponse.json();
      if (!orderResponse.ok) {
        setPhase({ step: "error", message: order.error ?? "That order could not be opened." });
        return;
      }

      setPhase({ step: "working", note: "Waiting for your wallet…" });

      // The blockhash comes through our proxy, like every other chain read.
      const blockhashResponse = await fetch("/api/rpc/solana", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestBlockhash", params: [] }),
      });
      const blockhashBody = await blockhashResponse.json();
      const lifetime = blockhashBody?.result?.value;
      if (!lifetime?.blockhash) {
        setPhase({ step: "error", message: "The network could not be reached. Try again." });
        return;
      }

      const message = buildTicketPaymentMessage({
        payer: connection.account.address,
        payTo: order.payTo,
        // The server's quote, not a figure recomputed here.
        amountLamports: BigInt(order.amountNative),
        reference: order.reference ?? null,
        blockhash: lifetime.blockhash,
        lastValidBlockHeight: BigInt(lifetime.lastValidBlockHeight ?? 0),
      });

      let signature: string;
      try {
        signature = await signAndSend(message, signingChain);
      } catch (error) {
        console.error(error);
        setPhase({ step: "error", message: walletErrorMessage(error) });
        return;
      }

      setPhase({ step: "working", note: "Confirming your payment…" });
      await confirm(order.orderId, signature);
    } catch (error) {
      console.error(error);
      setPhase({ step: "error", message: "Something went wrong. Your wallet may not have been charged." });
    }
  }

  /**
   * Retries only the reasons that can change on their own, and at most a few
   * times. Every attempt spends the order's verification quota, so a loop on a
   * permanent failure burns the budget the payer needs for the attempt that
   * would have worked.
   */
  async function confirm(orderId: string, signature: string, attempt = 0): Promise<void> {
    const response = await fetch(`/api/orders/${orderId}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signature }),
    });
    const body = await response.json();

    if (response.ok) {
      setPhase({ step: "done", tickets: body.ticketNumbers ?? [] });
      return;
    }

    if (isRetryableConfirmReason(body.reason) && attempt < 4) {
      setPhase({ step: "working", note: "Waiting for the network to confirm…" });
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      return confirm(orderId, signature, attempt + 1);
    }

    // The order's own status decides whether a reused signature is good news.
    const status = await fetch(`/api/orders/${orderId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((o) => o?.status ?? null)
      .catch(() => null);

    const outcome = checkoutOutcome({ failure: body, orderStatus: status });
    if (outcome.kind === "paid") setPhase({ step: "done", tickets: [] });
    else if (outcome.kind === "filed") setPhase({ step: "filed", message: outcome.message });
    else setPhase({ step: "error", message: outcome.message });
  }

  return (
    <div className="space-y-4">
      {safety.devnet && (
        /*
         * The page SAYS it is devnet. A screen that quietly accepts devnet
         * signatures is a screen somebody will mistake for the real one — which
         * is why the flag travels with the verdict rather than being inferred
         * here.
         */
        <p className="rounded border border-neutral-400 bg-neutral-100 p-3 text-sm">
          <strong>Devnet.</strong> This deployment settles on Solana devnet. Nothing signed here
          moves real SOL, and nothing bought here is a real ticket.
        </p>
      )}

      {!connection ? (
        <div>
          <p className="text-neutral-700">
            Connect a wallet to buy tickets. Payment is a single {nativeSymbol} transfer, verified
            on chain before any ticket is issued.
          </p>
          {wallets.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-600">
              No Solana wallet was detected in this browser.
            </p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {wallets.map((wallet) => (
                <li key={wallet.name}>
                  <button
                    type="button"
                    disabled={connecting}
                    onClick={() => connect(wallet).catch((e) => setPhase({ step: "error", message: walletErrorMessage(e) }))}
                    className="rounded border border-neutral-300 px-3 py-1 text-sm disabled:opacity-60"
                  >
                    {wallet.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block text-sm" htmlFor="quantity">
            Tickets — <span className="figure">{ticketPriceDisplay} {nativeSymbol}</span> each
          </label>
          <input
            id="quantity"
            type="number"
            min={1}
            max={ticketsRemaining}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
            className="figure w-24 rounded border border-neutral-300 px-3 py-2"
          />
          <button
            type="button"
            onClick={buy}
            disabled={phase.step === "working"}
            className="ml-3 rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-60"
          >
            {phase.step === "working" ? "Working…" : "Buy"}
          </button>
          <p className="figure text-xs text-neutral-500">{connection.account.address}</p>
        </div>
      )}

      {phase.step === "working" && <p className="text-sm text-neutral-600">{phase.note}</p>}
      {phase.step === "done" && (
        <Notice>
          Paid.{" "}
          {phase.tickets.length > 0 ? (
            <>
              Your ticket{phase.tickets.length === 1 ? "" : "s"}:{" "}
              <span className="figure">{phase.tickets.join(", ")}</span>.
            </>
          ) : (
            "This order was already settled."
          )}
        </Notice>
      )}
      {phase.step === "filed" && <Notice>{phase.message}</Notice>}
      {phase.step === "error" && <Notice>{phase.message}</Notice>}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded border border-neutral-300 bg-neutral-50 p-4 text-neutral-700">{children}</p>
  );
}
