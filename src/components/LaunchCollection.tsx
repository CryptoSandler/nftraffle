"use client";

import { useState } from "react";
import { isLocalHostname, paymentSafety, type ProxyCluster } from "../lib/chain/solana/cluster";
import { walletErrorMessage } from "../lib/checkout";
import { bindingFieldsFor, startsAtFromNow } from "../lib/listing";
import { sellerBindingMessage } from "../lib/wallet/solana-binding";
import { useSolanaWallet } from "./useSolanaWallet";
import { useSolanaWallets } from "./useSolanaWallets";

/**
 * Launching a collection: the creator's side.
 *
 * **Two server calls and two wallet prompts**, the same shape as the listing
 * form:
 *
 *  1. `POST /api/collections` with a signed message naming the metadata. It
 *     returns ONE transaction that pays the launch fee, creates the Core
 *     collection, and creates the candy machine with its guards.
 *  2. `POST /api/collections/[slug]/publish` after that settles. The server
 *     verifies the fee on chain and — the check that matters — reads the
 *     deployed machine back to confirm its `solFixedFee` names this
 *     deployment's payment wallet (spec §5.3).
 *
 * **No umi here, and that is enforced rather than remembered**
 * (`docs/decisions.md` Q21, `src/lib/__tests__/client-bundle.test.ts`). This
 * file signs and posts; the server builds.
 *
 * WHO CALLS THIS: `src/app/launch/page.tsx`, when the surface is open.
 */

type Props = {
  proxyCluster: ProxyCluster;
  isProduction: boolean;
  launchFeeDisplay: string;
  mintFeeBps: number;
  nativeSymbol: string;
};

type Phase =
  | { step: "idle" }
  | { step: "working"; note: string }
  | { step: "live"; slug: string }
  /** Deployed and not published: the machine exists and the page does not. */
  | { step: "deployed"; slug: string; message: string }
  | { step: "error"; message: string };

export function LaunchCollection({
  proxyCluster,
  isProduction,
  launchFeeDisplay,
  mintFeeBps,
  nativeSymbol,
}: Props) {
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [uri, setUri] = useState("");
  const [itemsAvailable, setItems] = useState(100);
  const [price, setPrice] = useState("");
  const [mintLimit, setMintLimit] = useState(5);
  const [minutesFromNow, setMinutesFromNow] = useState(10);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
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

  async function launch() {
    if (!connection) return;
    try {
      setPhase({ step: "working", note: "Waiting for your wallet to sign…" });
      /**
       * The metadata URI stands where an asset would: it is what identifies
       * this launch, so it is what the signature covers.
       */
      const fields = bindingFieldsFor({
        domain: window.location.host,
        address: connection.account.address,
        prizeAsset: uri.trim(),
      });
      let signature: string;
      try {
        signature = await signMessageText(sellerBindingMessage(fields));
      } catch (error) {
        console.error(error);
        setPhase({ step: "error", message: walletErrorMessage(error) });
        return;
      }

      setPhase({ step: "working", note: "Preparing the launch…" });
      const response = await fetch("/api/collections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          symbol: symbol.trim(),
          description: "",
          uri: uri.trim(),
          itemsAvailable,
          price: price.trim(),
          mintLimit,
          startsAt: startsAtFromNow(minutesFromNow),
          binding: { signature, fields },
        }),
      });
      const created = await response.json();
      if (!response.ok || !created.transaction) {
        setPhase({ step: "error", message: created.error ?? "That launch could not be prepared." });
        return;
      }

      setPhase({
        step: "working",
        note: "Waiting for your wallet — the fee, the collection and the mint machine, together…",
      });
      let launchSignature: string;
      try {
        // Sign-only: the server already put the two new accounts' signatures on
        // this transaction, and a wallet that submits for us may not carry them.
        launchSignature = await signAndSendWire(created.transaction, signingChain, {
          forceSignOnly: true,
        });
      } catch (error) {
        console.error(error);
        setPhase({ step: "error", message: walletErrorMessage(error) });
        return;
      }

      setDraft({ slug: created.slug, signature: launchSignature });
      await publish(created.slug, launchSignature);
    } catch (error) {
      console.error(error);
      setPhase({
        step: "error",
        message: "Something went wrong. Nothing has been charged unless your wallet says otherwise.",
      });
    }
  }

  async function publish(slug: string, launchFeeSignature: string) {
    setPhase({ step: "working", note: "Checking what actually landed on chain…" });
    const response = await fetch(`/api/collections/${slug}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ launchFeeSignature }),
    });
    const body = await response.json();
    if (response.ok) {
      setPhase({ step: "live", slug });
      return;
    }
    setPhase({
      step: "deployed",
      slug,
      message:
        `${body.error ?? "This launch could not be published."} Your collection and mint machine ` +
        `exist on chain and you are their authority — this page just does not list them.`,
    });
  }

  const working = phase.step === "working";

  return (
    <div className="space-y-4">
      {safety.devnet && (
        <p className="rounded border border-edge bg-panel p-3 text-sm">
          <strong>Devnet.</strong> This deployment settles on Solana devnet. Nothing launched here
          is a real collection and nothing signed here moves real SOL.
        </p>
      )}

      {!connection ? (
        <div>
          <p className="text-quiet">
            Connect the wallet that will own the collection. You sign twice: once to prove the
            wallet is yours, which moves nothing, and once for the launch itself.
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
          This wallet cannot sign messages, which is how a launch proves the wallet is yours.
          Nothing has been charged. Connect a different wallet to launch.
        </Notice>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void launch();
          }}
        >
          <Field label="Name" hint="Shown on the mint page and stamped into every item.">
            <input className="control w-full" value={name} onChange={(e) => setName(e.target.value)} required maxLength={32} />
          </Field>
          <Field label="Symbol" hint="Short, up to ten characters.">
            <input className="control w-40" value={symbol} onChange={(e) => setSymbol(e.target.value)} required maxLength={10} />
          </Field>
          <Field
            label="Metadata address"
            hint="The permanent address of your metadata JSON, on Irys or Arweave. Every item shares it."
          >
            <input className="control figure w-full" value={uri} onChange={(e) => setUri(e.target.value)} required spellCheck={false} />
          </Field>
          <Field label="Supply" hint="How many can be minted, at most 1,000.">
            <input className="control figure w-32" type="number" min={1} max={1000} value={itemsAvailable} onChange={(e) => setItems(Math.max(1, Number(e.target.value) || 1))} required />
          </Field>
          <Field label={`Mint price, in ${nativeSymbol}`} hint="Paid to you directly by each minter. Zero is allowed.">
            <input className="control figure w-40" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" required spellCheck={false} />
          </Field>
          <Field label="Per-wallet limit" hint="How many one wallet may mint. Between 1 and 255.">
            <input className="control figure w-32" type="number" min={1} max={255} value={mintLimit} onChange={(e) => setMintLimit(Math.max(1, Number(e.target.value) || 1))} required />
          </Field>
          <Field label="Starts in, minutes" hint="The mint opens this many minutes from now.">
            <input className="control figure w-32" type="number" min={0} value={minutesFromNow} onChange={(e) => setMinutesFromNow(Math.max(0, Number(e.target.value) || 0))} required />
          </Field>

          <p className="text-sm text-quiet">
            Launching costs <span className="figure">{launchFeeDisplay} {nativeSymbol}</span>, paid
            once in the transaction you sign. The platform&apos;s share of each mint is{" "}
            <span className="figure">{mintFeeBps} bps</span> of your price, worked out now and
            frozen into the mint machine as a fixed amount — the mint page shows that amount.
          </p>

          <button type="submit" className="control-primary" disabled={working}>
            {working ? "Working…" : "Launch this collection"}
          </button>
        </form>
      )}

      {phase.step === "working" && <p className="text-sm text-quiet">{phase.note}</p>}
      {phase.step === "error" && <Notice>{phase.message}</Notice>}
      {phase.step === "deployed" && (
        <div className="space-y-3">
          <Notice>{phase.message}</Notice>
          {draft && (
            <button type="button" className="control" onClick={() => void publish(draft.slug, draft.signature)}>
              Try publishing again
            </button>
          )}
        </div>
      )}
      {phase.step === "live" && (
        <p className="rounded border border-edge bg-panel p-3">
          Your collection is live.{" "}
          <a className="underline underline-offset-4" href={`/c/solana/${phase.slug}`}>
            Open its mint page
          </a>
          .
        </p>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
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
