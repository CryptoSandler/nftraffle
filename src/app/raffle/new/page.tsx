import Link from "next/link";
import { ListRaffle } from "../../../components/ListRaffle";
import { classifyEndpoints } from "../../../lib/chain/solana/cluster";
import { solanaRpcUrls } from "../../../lib/payments/config";
import { adapterFor } from "../../../lib/chain/registry";
import { houseFeeBps, raffleListingFee } from "../../../lib/payments/config";
import { surfaceRefusal } from "../../../lib/surfaces";

export const dynamic = "force-dynamic";

/**
 * Listing a raffle.
 *
 * Closed until this deployment has an escrow wallet, a payment wallet, an RPC
 * and both fees — see `lib/surfaces.ts`. The listing surface needs strictly
 * more than the launch surface, because it is the only leg where this project
 * holds somebody else's property.
 */
export default function NewRafflePage() {
  // See /launch: the refusal helper is what puts the missing-variable list in
  // the server log, where configuration faults belong.
  // Solana only while the Robinhood surface is closed (docs/decisions.md).
  const chain = adapterFor("solana");
  const closed = surfaceRefusal("list_raffle", "solana", "GET /raffle/new");
  const listing = raffleListingFee("solana");
  const house = houseFeeBps("solana");

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <Link className="text-sm underline underline-offset-4" href="/">
        Home
      </Link>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">List a raffle</h1>

      {closed ? (
        <p className="mt-6 rounded border border-rule bg-panel p-4 text-quiet">
          {closed.message}
        </p>
      ) : (
        <>
          <p className="mt-4 text-quiet">
            You send the NFT to this site&apos;s escrow wallet, and it stays there until the draw.
            Payouts are made by hand — the prize to the winner, the proceeds to you — and both
            transactions are published on the raffle&apos;s page.
          </p>
          <dl className="mt-8 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-quiet">Listing fee</dt>
            <dd className="figure">
              {listing.ok ? `${chain.formatNative(listing.amount)} ${chain.nativeSymbol}` : "—"}
            </dd>
            <dt className="text-quiet">Platform share of ticket sales</dt>
            <dd className="figure">{house.ok ? `${house.bps} bps` : "—"}</dd>
          </dl>
          <p className="mt-4 text-sm text-quiet">
            There is no minimum. The draw runs on whatever sold, so a raffle that sells one ticket
            transfers the prize for one ticket&apos;s price. Decide the price on that basis, not on
            a sell-out.
          </p>
          <div className="mt-8">
            {/*
              * The cluster is CLASSIFIED SERVER-SIDE and passed down as a name.
              * Never the endpoint: `/api/rpc` exists so a paid provider's URL
              * stays server-side, and handing it to the browser to label a
              * screen would undo that from the other direction. `isProduction`
              * comes from VERCEL_ENV for the same reason.
              *
              * This matters more here than on the buy panel: a listing signs a
              * transaction that moves an NFT into escrow, and a prize sent to a
              * devnet escrow because the proxy was pointed there is not
              * refundable (CLAUDE.md).
              */}
            {listing.ok && house.ok ? (
              <ListRaffle
                proxyCluster={classifyEndpoints(solanaRpcUrls())}
                isProduction={process.env.VERCEL_ENV === "production"}
                listingFeeDisplay={chain.formatNative(listing.amount)}
                houseFeeBps={house.bps}
                nativeSymbol={chain.nativeSymbol}
              />
            ) : (
              /* Unreachable while the surface is open — it requires both — and
                 written as a refusal rather than a `!` so it stays that way. */
              <p className="text-quiet">
                Listing is not available right now. Nothing has been charged.
              </p>
            )}
          </div>
        </>
      )}
    </main>
  );
}
