"use client";

import { useState } from "react";
import { checkoutOutcome, isRetryableConfirmReason, walletErrorMessage } from "../lib/checkout";
import {
  robinhoodNetworkLabel,
  robinhoodPaymentSafety,
  type RobinhoodNetwork,
} from "../lib/chain/robinhood/network";
import { useEvmWallet, useEvmWallets } from "./useEvmWallet";

/**
 * Buying tickets on Robinhood Chain.
 *
 * **A sibling of `BuyTickets.tsx`, not a rewrite of it.** The two chains
 * genuinely differ in what the browser has to do — Solana's wallet hands back
 * signed bytes that we submit, an EIP-1193 wallet submits for itself — and the
 * shared parts are already shared: `lib/checkout.ts` decides every outcome, and
 * both panels import it rather than each deciding what a failure means.
 *
 * Two things happen here that have no Solana equivalent:
 *
 *  1. **The payer signs a binding before the order is opened.** It proves the
 *     address on the order belongs to whoever opened it — see
 *     `lib/wallet/evm-binding.ts` for why that matters more here.
 *  2. **The wallet's chain is checked against the server's.** The browser only
 *     ever talks to `/api/rpc/robinhood`, so it cannot see which network the
 *     proxy points at; the server classifies and passes down a NAME.
 *
 * WHO CALLS THIS: `src/app/r/[slug]/page.tsx`, on an open Robinhood raffle.
 */

type Props = {
  slug: string;
  /** Classified server-side by asking the chain. Never the endpoint. */
  serverNetwork: RobinhoodNetwork;
  /** The id the binding must name. Null when the network is unknown. */
  expectedChainId: number | null;
  isProduction: boolean;
  ticketPriceDisplay: string;
  nativeSymbol: string;
  ticketPriceWei: string;
  ticketsRemaining: number;
};

type Phase =
  | { step: "idle" }
  | { step: "working"; note: string }
  | { step: "done"; tickets: number[] }
  | { step: "filed"; message: string }
  | { step: "error"; message: string };

export function BuyTicketsRobinhood({
  slug,
  serverNetwork,
  expectedChainId,
  isProduction,
  ticketPriceDisplay,
  nativeSymbol,
  ticketsRemaining,
}: Props) {
  const [quantity, setQuantity] = useState(1);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const wallets = useEvmWallets();
  const { connection, connecting, connect, signBinding, sendPayment } = useEvmWallet();

  const safety = robinhoodPaymentSafety({
    serverNetwork,
    walletChainId: connection?.chainId ?? null,
    isProduction,
  });

  if (!safety.ok) return <Notice>{safety.message}</Notice>;

  async function buy() {
    if (!connection || expectedChainId === null) return;

    try {
      // The signature comes FIRST, before any order exists. An order opened and
      // then abandoned because the person declined to sign is a row nobody
      // needed.
      setPhase({ step: "working", note: "Waiting for you to prove the wallet is yours…" });
      let binding: Record<string, unknown>;
      try {
        binding = await signBinding({
          connection,
          // The server checks this against the request's own host, so a
          // mismatch here fails closed rather than being accepted.
          domain: window.location.host,
          slug,
          chainId: expectedChainId,
        });
      } catch (error) {
        setPhase({ step: "error", message: walletErrorMessage(error) });
        return;
      }

      setPhase({ step: "working", note: "Opening the order…" });
      const orderResponse = await fetch(`/api/raffles/${slug}/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quantity, payerPubkey: connection.address, binding }),
      });
      const order = await orderResponse.json();
      if (!orderResponse.ok) {
        setPhase({ step: "error", message: order.error ?? "That order could not be opened." });
        return;
      }

      setPhase({ step: "working", note: "Waiting for your wallet…" });
      let hash: string;
      try {
        hash = await sendPayment({
          connection,
          to: order.payTo,
          // The SERVER'S quote, never a figure recomputed in the browser.
          valueWei: BigInt(order.amountNative),
        });
      } catch (error) {
        setPhase({ step: "error", message: walletErrorMessage(error) });
        return;
      }

      setPhase({ step: "working", note: "Confirming your payment…" });
      await confirm(order.orderId, hash);
    } catch {
      setPhase({ step: "error", message: "Something went wrong. Your wallet may not have been charged." });
    }
  }

  /** Identical policy to the Solana panel, and it comes from the same module. */
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
      {serverNetwork === "robinhood:testnet" && (
        /* The page SAYS it is a test network, for the same reason the Solana
           panel says devnet: a screen that quietly accepts test payments is one
           somebody will mistake for the real thing. */
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          This is {robinhoodNetworkLabel(serverNetwork)}. Nothing here is worth anything.
        </p>
      )}

      {phase.step === "done" ? (
        <p className="rounded border border-neutral-300 bg-neutral-50 p-4">
          {phase.tickets.length > 0
            ? `Paid. Your ticket numbers: ${phase.tickets.join(", ")}.`
            : "Paid. Your tickets are recorded."}
        </p>
      ) : phase.step === "filed" ? (
        <p className="rounded border border-amber-300 bg-amber-50 p-4 text-amber-900">{phase.message}</p>
      ) : (
        <>
          <label className="block text-sm">
            <span className="text-neutral-600">How many tickets</span>
            <input
              type="number"
              min={1}
              max={Math.max(1, ticketsRemaining)}
              value={quantity}
              onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
              className="figure mt-1 w-28 rounded border border-neutral-300 px-2 py-1"
            />
          </label>

          <p className="text-sm text-neutral-600">
            {quantity} × {ticketPriceDisplay} {nativeSymbol}
          </p>

          {!connection ? (
            wallets.length === 0 ? (
              <p className="text-sm text-neutral-600">
                No EVM wallet was found in this browser. Install one that supports Robinhood Chain,
                then reload.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {wallets.map((wallet) => (
                  <button
                    key={wallet.info.rdns}
                    type="button"
                    disabled={connecting}
                    onClick={() => connect(wallet).catch(() => undefined)}
                    className="rounded border border-neutral-400 px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
                  >
                    Connect {wallet.info.name}
                  </button>
                ))}
              </div>
            )
          ) : (
            <button
              type="button"
              disabled={phase.step === "working" || ticketsRemaining < 1}
              onClick={buy}
              className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {phase.step === "working" ? phase.note : `Buy ${quantity}`}
            </button>
          )}

          {phase.step === "error" && <p className="text-sm text-red-700">{phase.message}</p>}
        </>
      )}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded border border-neutral-300 bg-neutral-50 p-4 text-neutral-700">{children}</p>
  );
}
