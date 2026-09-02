"use client";

import { useState } from "react";
import { isLocalHostname, paymentSafety, type ProxyCluster } from "../lib/chain/solana/cluster";
import { walletErrorMessage } from "../lib/checkout";
import { bindingFieldsFor, publishOutcome } from "../lib/listing";
import { sellerBindingMessage } from "../lib/wallet/solana-binding";
import { useSolanaWallet } from "./useSolanaWallet";
import { useSolanaWallets } from "./useSolanaWallets";

/**
 * Listing a raffle: the seller's side of the product.
 *
 * **Three server calls and two wallet prompts, in a fixed order**, and the
 * order is the design:
 *
 *  1. `POST /api/raffles` with a SIGNED MESSAGE. The draft takes the
 *     `(chain, prize_asset)` slot, so it is opened by proof rather than by a
 *     name (`docs/decisions.md` Q20). Prompt one signs text and moves nothing.
 *  2. `POST /api/raffles/[slug]/deposit` returns ONE transaction carrying the
 *     listing fee and the prize. The server built it and already simulated it;
 *     its absence is what stops the wallet opening. Prompt two.
 *  3. `POST /api/raffles/[slug]/publish` with that signature for both legs —
 *     they are the same transaction, and `publish` verifies each independently
 *     off the chain.
 *
 * **Nothing here computes anything the server will act on.** The fee, the
 * escrow address, the schedule and the seller are all decided server-side; this
 * file collects four fields, carries signatures, and renders sentences.
 *
 * **After step 2 settles, no message may say nothing has been charged**, which
 * is why the copy for that branch lives in `lib/listing.ts` under a test.
 *
 * WHO CALLS THIS: `src/app/raffle/new/page.tsx`, when the listing surface is
 * open on this deployment.
 */

type Props = {
  /** Classified server-side. Never the endpoint. */
  proxyCluster: ProxyCluster;
  /** From VERCEL_ENV, server-side. The browser cannot be trusted to know. */
  isProduction: boolean;
  listingFeeDisplay: string;
  houseFeeBps: number;
  nativeSymbol: string;
};

type Phase =
  | { step: "idle" }
  | { step: "working"; note: string }
  | { step: "published"; slug: string }
  /** The deposit settled and the raffle did not open. The seller's asset is in escrow. */
  | { step: "held"; slug: string; message: string; retryable: boolean }
  | { step: "error"; message: string };

export function ListRaffle({
  proxyCluster,
  isProduction,
  listingFeeDisplay,
  houseFeeBps,
  nativeSymbol,
}: Props) {
  const [prizeAsset, setPrizeAsset] = useState("");
  const [ticketPrice, setTicketPrice] = useState("");
  const [maxTickets, setMaxTickets] = useState(20);
  const [durationMinutes, setDurationMinutes] = useState(1440);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  /** Kept across retries: re-creating a draft would collide with its own slot. */
  const [draft, setDraft] = useState<{ slug: string; signature: string } | null>(null);

  const signingChain = proxyCluster === "unknown" ? "unknown" : proxyCluster;
  const wallets = useSolanaWallets(signingChain);
  const { connection, connecting, connect, signAndSendWire, signMessageText, canSignMessage } =
    useSolanaWallet();

  const safety = paymentSafety({
    localOrigin: typeof window !== "undefined" && isLocalHostname(window.location.hostname),
    signingChain,
    proxyCluster,
    isProduction,
  });

  if (!safety.ok) return <Notice>{safety.message}</Notice>;

  async function list() {
    if (!connection) return;

    try {
      /**
       * PROMPT ONE: text, not a transaction.
       *
       * The message is built from the same function the server rebuilds it
       * with, so there is one definition of what is being signed rather than
       * two that have to agree.
       */
      setPhase({ step: "working", note: "Waiting for your wallet to sign…" });
      const fields = bindingFieldsFor({
        domain: window.location.host,
        address: connection.account.address,
        prizeAsset: prizeAsset.trim(),
      });
      let signature: string;
      try {
        signature = await signMessageText(sellerBindingMessage(fields));
      } catch (error) {
        console.error(error);
        setPhase({ step: "error", message: walletErrorMessage(error) });
        return;
      }

      setPhase({ step: "working", note: "Opening the draft…" });
      const draftResponse = await fetch("/api/raffles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chain: "solana",
          prizeAsset: prizeAsset.trim(),
          ticketPrice: ticketPrice.trim(),
          maxTickets,
          durationMinutes,
          binding: { signature, fields },
        }),
      });
      const created = await draftResponse.json();
      if (!draftResponse.ok) {
        // The server's sentence, not one invented here: it knows which rule was
        // broken and this file does not.
        setPhase({ step: "error", message: created.error ?? "That listing could not be opened." });
        return;
      }

      await deposit(created.slug);
    } catch (error) {
      console.error(error);
      setPhase({
        step: "error",
        message: "Something went wrong. Nothing has been charged and no asset has been asked for.",
      });
    }
  }

  /** Steps 2 and 3, separately callable so a failed publish can be retried. */
  async function deposit(slug: string) {
    setPhase({ step: "working", note: "Preparing the deposit…" });
    const response = await fetch(`/api/raffles/${slug}/deposit`, { method: "POST" });
    const intent = await response.json();

    /**
     * THE SERVER BUILT THIS TRANSACTION AND ALREADY SIMULATED IT.
     *
     * Its ABSENCE is what stops a wallet opening — not a flag this code could
     * misread (`docs/wallet-warnings.md`).
     */
    if (!intent.transaction) {
      setPhase({
        step: "error",
        message:
          intent.error ??
          "This deposit could not be prepared. Nothing has been charged and your asset has not moved.",
      });
      return;
    }

    setPhase({ step: "working", note: "Waiting for your wallet — the fee and the prize, together…" });
    let signature: string;
    try {
      signature = await signAndSendWire(intent.transaction, signingChain);
    } catch (error) {
      console.error(error);
      setPhase({ step: "error", message: walletErrorMessage(error) });
      return;
    }

    setDraft({ slug, signature });
    await publish(slug, signature);
  }

  async function publish(slug: string, signature: string) {
    setPhase({ step: "working", note: "Publishing…" });
    const response = await fetch(`/api/raffles/${slug}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // One transaction carried both legs, so one signature answers both
      // questions. `publish` verifies each against the chain separately.
      body: JSON.stringify({ escrowSignature: signature, listingFeeSignature: signature }),
    });
    const body = await response.json();

    if (response.ok) {
      setPhase({ step: "published", slug });
      return;
    }

    const outcome = publishOutcome(body);
    setPhase({ step: "held", slug, message: outcome.message, retryable: outcome.kind === "retry" });
  }

  const working = phase.step === "working";

  return (
    <div className="space-y-4">
      {safety.devnet && (
        <p className="rounded border border-edge bg-panel p-3 text-sm">
          <strong>Devnet.</strong> This deployment settles on Solana devnet. Nothing listed here is
          a real raffle and nothing signed here moves real SOL.
        </p>
      )}

      {!connection ? (
        <div>
          <p className="text-quiet">
            Connect the wallet that holds the prize. You sign twice: once to prove the wallet is
            yours, which moves nothing, and once to send the fee and the prize together.
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
      ) : !canSignMessage ? (
        <Notice>
          This wallet cannot sign messages, which is how a listing proves the wallet is yours.
          Nothing has been charged. Connect a different wallet to list a raffle — buying tickets
          works with this one.
        </Notice>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void list();
          }}
        >
          <Field label="Prize" hint="The mint address of the asset you are raffling.">
            <input
              className="control figure w-full"
              value={prizeAsset}
              onChange={(e) => setPrizeAsset(e.target.value)}
              required
              spellCheck={false}
              autoComplete="off"
            />
          </Field>

          <Field label={`Ticket price, in ${nativeSymbol}`} hint="What one ticket costs.">
            <input
              className="control figure w-40"
              value={ticketPrice}
              onChange={(e) => setTicketPrice(e.target.value)}
              inputMode="decimal"
              required
              spellCheck={false}
              autoComplete="off"
            />
          </Field>

          <Field label="Tickets" hint="The most that can be sold. The draw runs on whatever sold.">
            <input
              className="control figure w-32"
              type="number"
              min={1}
              value={maxTickets}
              onChange={(e) => setMaxTickets(Math.max(1, Number(e.target.value) || 1))}
              required
            />
          </Field>

          <Field label="Open for, in minutes" hint="The clock starts when the raffle is published.">
            <input
              className="control figure w-32"
              type="number"
              min={1}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Math.max(1, Number(e.target.value) || 1))}
              required
            />
          </Field>

          <p className="text-sm text-quiet">
            Listing costs <span className="figure">{listingFeeDisplay} {nativeSymbol}</span>, and{" "}
            <span className="figure">{houseFeeBps} bps</span> of ticket sales is the platform&apos;s
            share. Both are charged in the one transaction you sign second. The draw is anchored ten
            minutes after the raffle closes.
          </p>

          <button type="submit" className="control-primary" disabled={working}>
            {working ? "Working…" : "List this raffle"}
          </button>
        </form>
      )}

      {phase.step === "working" && <p className="text-sm text-quiet">{phase.note}</p>}

      {phase.step === "error" && <Notice>{phase.message}</Notice>}

      {phase.step === "held" && (
        <div className="space-y-3">
          <Notice>{phase.message}</Notice>
          {phase.retryable && draft && (
            <button
              type="button"
              className="control"
              onClick={() => void publish(draft.slug, draft.signature)}
            >
              Try publishing again
            </button>
          )}
        </div>
      )}

      {phase.step === "published" && (
        <p className="rounded border border-edge bg-panel p-3">
          Your raffle is open.{" "}
          <a className="underline underline-offset-4" href={`/r/${phase.slug}`}>
            Read it as a stranger would
          </a>
          .
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-sm">{label}</span>
      {children}
      <span className="block text-sm text-quiet">{hint}</span>
    </label>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded border border-edge bg-panel p-3 text-sm">{children}</p>;
}
