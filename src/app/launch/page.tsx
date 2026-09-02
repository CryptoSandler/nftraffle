import Link from "next/link";
import { LaunchCollection } from "../../components/LaunchCollection";
import { classifyEndpoints } from "../../lib/chain/solana/cluster";
import { solanaRpcUrls } from "../../lib/payments/config";
import { adapterFor } from "../../lib/chain/registry";
import { launchFee, mintFeeBps } from "../../lib/payments/config";
import { surfaceRefusal } from "../../lib/surfaces";

export const dynamic = "force-dynamic";

/**
 * Launching a collection.
 *
 * Closed until this deployment is configured, with its own screen — never a
 * placeholder wallet and never a crash (see `lib/surfaces.ts` for why each of
 * those is worse). The screen does not name the missing variable; that goes to
 * the server log.
 *
 * Every fee quoted below is read from the same function the money path reads
 * (DESIGN.md §8.2). There is no hardcoded number in this file, which is why the
 * page cannot open at all without them: a fee in a sentence that nothing
 * enforces is the defect that rule exists to prevent.
 */
export default function LaunchPage() {
  // `surfaceRefusal` rather than `surfaceState`: it logs the specific reason
  // beside the route name, which is the only place an operator can find out
  // WHICH variable is missing. A page that closes silently leaves them with a
  // blank screen and nothing to diagnose.
  // Solana only while the Robinhood surface is closed (docs/decisions.md).
  const chain = adapterFor("solana");
  const closed = surfaceRefusal("launch_collection", "solana", "GET /launch");
  const fee = launchFee("solana");
  const share = mintFeeBps("solana");

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <Link className="text-sm underline underline-offset-4" href="/">
        Home
      </Link>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Launch a collection</h1>

      {closed ? (
        <p className="mt-6 rounded border border-rule bg-panel p-4 text-quiet">
          {closed.message}
        </p>
      ) : (
        <>
          <p className="mt-4 text-quiet">
            You sign everything from your own wallet. This site never holds your art, your
            collection authority, or your mint proceeds — buyers pay you directly.
          </p>
          <dl className="mt-8 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-quiet">Launch fee</dt>
            <dd className="figure">{fee.ok ? `${chain.formatNative(fee.amount)} ${chain.nativeSymbol}` : "—"}</dd>
            <dt className="text-quiet">Platform share of each mint</dt>
            {/*
              * A RATE, said to be a rate, because the amount does not exist
              * until a price does. `solFixedFee` takes fixed lamports, so the
              * rate is applied once when the machine is created and the AMOUNT
              * is what gets charged forever after (spec §0.1). Quoting the bps
              * as if it were charged per mint would describe a mechanism this
              * product does not have.
              */}
            <dd className="figure">{share.ok ? `${share.bps} bps of your price` : "—"}</dd>
          </dl>
          <p className="mt-4 text-sm text-quiet">
            That share is worked out once, when you launch, and frozen into the mint machine as a
            fixed amount in {chain.nativeSymbol}. Changing the rate later does not touch a
            collection that already exists, and every mint page shows the amount its own machine
            charges rather than the rate it came from. It is our fee, not a network fee —
            Solana&apos;s own fee is a fraction of a cent.
          </p>
          <p className="mt-4 text-sm text-quiet">
            The machine charges it, not this site: it is a guard on the mint instruction, so a
            minter who assembles their own transaction pays it too.
          </p>
          <div className="mt-8">
            {fee.ok && share.ok ? (
              <LaunchCollection
                proxyCluster={classifyEndpoints(solanaRpcUrls())}
                isProduction={process.env.VERCEL_ENV === "production"}
                launchFeeDisplay={chain.formatNative(fee.amount)}
                mintFeeBps={share.bps}
                nativeSymbol={chain.nativeSymbol}
              />
            ) : (
              <p className="text-quiet">
                Launching is not available right now. Nothing has been charged.
              </p>
            )}
          </div>
        </>
      )}
    </main>
  );
}
