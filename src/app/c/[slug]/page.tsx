import Link from "next/link";
import { notFound } from "next/navigation";
import { formatSol } from "../../../lib/payments/config";
import { collectionBySlug, rafflesForCollection } from "../../../lib/raffles/listing";

export const dynamic = "force-dynamic";

/**
 * A collection's page — leg 3, and the whole of what this product means by
 * "the market lives here".
 *
 * Its mints, its raffles, and the history of every draw ever run for it. **Not
 * an orderbook, no floor price, no rarity, no volume chart** (DESIGN.md §1).
 * The absence is the design: this page answers "what happened with this
 * collection", and a floor price answers "what is it worth right now", which is
 * a question that needs depth this product does not have and would be
 * dishonest to imply.
 *
 * A collection whose raffles are all finished shows a page of finished raffles.
 * That is a real answer and a useful one — it is the history a buyer uses to
 * decide whether the next raffle here is worth entering.
 */
export default async function CollectionPage({ params }: PageProps<"/c/[slug]">) {
  const { slug } = await params;
  const collection = await collectionBySlug(slug);
  if (!collection) notFound();

  const raffles = await rafflesForCollection(collection.id);

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <Link className="text-sm underline underline-offset-4" href="/">
        Home
      </Link>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight">{collection.name}</h1>
      <p className="figure mt-1 text-neutral-600">{collection.symbol}</p>

      <dl className="mt-8 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-neutral-500">Supply</dt>
        <dd className="figure">{collection.itemsAvailable}</dd>

        <dt className="text-neutral-500">Mint price</dt>
        <dd className="figure">{formatSol(collection.priceLamports)} SOL</dd>

        <dt className="text-neutral-500">Platform fee per mint</dt>
        {/* Read from the row, not from the current setting. The guard takes
            fixed lamports and was frozen when this machine was deployed, so the
            live value could disagree with what this collection actually charges
            (spec §0.1). */}
        <dd className="figure">
          {formatSol(collection.mintFeeLamports)} SOL ({collection.mintFeeBps} bps)
        </dd>

        <dt className="text-neutral-500">Creator</dt>
        <dd className="figure break-all">{collection.creatorWallet}</dd>

        <dt className="text-neutral-500">Collection</dt>
        <dd className="figure break-all">{collection.collectionMint ?? "—"}</dd>

        <dt className="text-neutral-500">Candy machine</dt>
        <dd className="figure break-all">{collection.candyMachine ?? "—"}</dd>
      </dl>

      <section className="mt-12">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Raffles for this collection
        </h2>
        {raffles.length === 0 ? (
          <p className="text-neutral-600">No raffles for this collection yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
            {raffles.map((raffle) => (
              <li key={raffle.id} className="py-4">
                <Link className="block hover:bg-neutral-50" href={`/r/${raffle.slug}`}>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="font-medium">{raffle.slug}</span>
                    <span className="figure text-sm text-neutral-600">
                      {formatSol(raffle.ticketPriceLamports)} SOL
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-neutral-600">
                    <span className="figure">{raffle.ticketsSold}</span> of{" "}
                    <span className="figure">{raffle.maxTickets}</span> tickets · {raffle.status}
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
