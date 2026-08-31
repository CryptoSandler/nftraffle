import Link from "next/link";
import { adapterFor } from "../lib/chain/registry";
import { assetDisplays } from "../lib/chain/asset-display";
import { liveRaffles, recentCollections } from "../lib/raffles/listing";
import { surfaceState } from "../lib/surfaces";
import { AssetImage } from "../components/AssetImage";
import { Countdown } from "../components/Countdown";

export const dynamic = "force-dynamic";

/**
 * The home page: live raffles, then recent launches. Newest and soonest-closing
 * first, and nothing else.
 *
 * **There is no explore surface here on purpose** — no sorts, no filters, no
 * floor prices, no "trending" (DESIGN.md §1, spec §0.8). Every one of those
 * serves discovery among high volume, which this product does not have, and
 * building the machinery to manage volume before there is volume is the
 * clearest way to spend a year building somebody else's product.
 *
 * The two "start something" links stay VISIBLE when their surface is closed and
 * lead to a page that explains. Hiding them would make a deployment that cannot
 * yet take money look like a product that does not do those things.
 */
export default async function Home() {
  const [raffles, collections] = await Promise.all([liveRaffles(), recentCollections()]);
  /**
   * Resolved once for the whole page and in parallel. A raffle is titled by what
   * is being raffled — never by its slug, which is a machine token and belongs
   * in the URL (`docs/design-state-2026-08-31.md` §3).
   */
  const displays = await assetDisplays(raffles);
  // The home page links to the Solana surfaces; Robinhood is closed.
  const listing = surfaceState("list_raffle", "solana");
  const launching = surfaceState("launch_collection", "solana");

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <header className="mb-12">
        <h1 className="text-2xl font-semibold tracking-tight">nftraffle</h1>
        <p className="mt-2 max-w-xl text-neutral-600">
          Launch a collection on Solana, and sell it by raffle. Every draw publishes the values
          it was computed from, so anyone can recompute the winner.
        </p>
        <nav className="mt-6 flex gap-4 text-sm">
          <Link className="underline underline-offset-4" href="/launch">
            Launch a collection{launching.open ? "" : " (not open yet)"}
          </Link>
          <Link className="underline underline-offset-4" href="/raffle/new">
            List a raffle{listing.open ? "" : " (not open yet)"}
          </Link>
        </nav>
      </header>

      <section className="mb-14">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Raffles
        </h2>
        {raffles.length === 0 ? (
          <p className="text-neutral-600">No raffles yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
            {raffles.map((raffle) => (
              <li key={raffle.id} className="py-4">
                <Link className="flex gap-4 hover:bg-neutral-50" href={`/r/${raffle.slug}`}>
                  <AssetImage
                    src={displays.get(`${raffle.chain}:${raffle.prizeAsset}`)?.imageUrl ?? null}
                    name={displays.get(`${raffle.chain}:${raffle.prizeAsset}`)?.name ?? raffle.prizeAsset}
                    className="h-16 w-16 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="truncate font-medium">
                        {displays.get(`${raffle.chain}:${raffle.prizeAsset}`)?.name ?? raffle.prizeAsset}
                      </span>
                      <span className="figure shrink-0 text-sm text-neutral-600">
                        {adapterFor(raffle.chain).formatNative(raffle.ticketPriceNative)}{" "}
                        {adapterFor(raffle.chain).nativeSymbol}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-neutral-600">
                      <span className="figure">{raffle.ticketsSold}</span> of{" "}
                      <span className="figure">{raffle.maxTickets}</span> tickets sold ·{" "}
                      {/* The status is a word, never only a countdown reaching zero —
                          DESIGN.md §9: a countdown is not a status. */}
                      {raffle.status}
                    </p>
                    {raffle.status === "open" && (
                      <p className="mt-1">
                        <Countdown
                          targetMs={raffle.endsAt.getTime()}
                          label="closes in"
                          elapsedLabel="closed"
                        />
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Collections launched here
        </h2>
        {collections.length === 0 ? (
          <p className="text-neutral-600">No collections yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
            {collections.map((collection) => (
              <li key={collection.id} className="py-4">
                <Link className="block hover:bg-neutral-50" href={`/c/${collection.chain}/${collection.slug}`}>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="font-medium">{collection.name}</span>
                    <span className="figure text-sm text-neutral-600">
                      {adapterFor(collection.chain).formatNative(collection.priceNative)}{" "}
                      {adapterFor(collection.chain).nativeSymbol}
                    </span>
                  </div>
                  <p className="figure mt-1 text-sm text-neutral-600">
                    {collection.itemsAvailable} items
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
