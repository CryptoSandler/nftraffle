import Link from "next/link";
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
            transfers the prize for one ticket&apos;s price. The next screen shows what you would
            receive at one ticket and at a sell-out before you commit to anything.
          </p>
          <p className="mt-8 text-quiet">
            The listing flow is not built yet. Nothing on this page charges anything, and no asset
            has been asked for.
          </p>
        </>
      )}
    </main>
  );
}
