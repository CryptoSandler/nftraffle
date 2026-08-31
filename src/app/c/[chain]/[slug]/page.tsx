import Link from "next/link";
import { notFound } from "next/navigation";
import { isChainId } from "../../../../lib/chain/adapter";
import { adapterFor } from "../../../../lib/chain/registry";
import { rpcConfigured } from "../../../../lib/payments/config";
import {
  collectionBySlug,
  rafflesForOutsideCollection,
  rafflesForCollection,
  type RaffleSummary,
} from "../../../../lib/raffles/listing";

export const dynamic = "force-dynamic";

/**
 * A collection's page — leg 3, and the whole of what this product means by
 * "the market lives here".
 *
 * Its mints, its raffles, and the history of every draw. **Not an orderbook, no
 * floor price, no rarity, no volume chart** (DESIGN.md §1). The absence is the
 * design: this page answers "what happened with this collection", where a floor
 * price answers "what is it worth right now" — a question that needs depth this
 * product does not have and would be dishonest to imply.
 *
 * **TWO KINDS OF COLLECTION REACH THIS PAGE**, which is the owner's answer to
 * open question Q5: a page for any collection, not only ones launched here.
 *
 *  - `slug` matches a row in `collections` → a collection we launched. It has
 *    numbers we recorded: supply, mint price, and the fee this specific candy
 *    machine charges.
 *  - `slug` is an address on `chain` → a collection we did not launch. There
 *    is no row, so **everything shown is derived from the chain** and nothing
 *    else. No
 *    supply we did not verify, no price, no fee — because we have none of those
 *    facts and inventing them would make an outside collection look like one we
 *    stand behind.
 *
 * That asymmetry is deliberate and visible. A page with fewer facts on it is
 * the honest rendering of a collection we know less about.
 */
export default async function CollectionPage({ params }: PageProps<"/c/[chain]/[slug]">) {
  const { chain: chainParam, slug } = await params;

  // The chain is in the URL, so an unknown one is a 404 rather than a guess
  // (docs/decisions.md Q10). A collection lives on exactly one chain, and a
  // Solana mint is not distinguishable from an EVM contract by shape alone in
  // every case — naming the chain is what stops the route having to guess.
  if (!isChainId(chainParam)) notFound();
  const chain = adapterFor(chainParam);

  const launched = await collectionBySlug(chainParam, slug);
  if (launched) {
    const raffles = await rafflesForCollection(launched.id);
    return (
      <Shell title={launched.name} subtitle={launched.symbol}>
        <dl className="mt-8 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-neutral-500">Supply</dt>
          <dd className="figure">{launched.itemsAvailable}</dd>

          <dt className="text-neutral-500">Mint price</dt>
          <dd className="figure">{chain.formatNative(launched.priceNative)} {chain.nativeSymbol}</dd>

          <dt className="text-neutral-500">Platform fee per mint</dt>
          {/* Read from the row, not from the current setting. The guard takes
              fixed lamports and was frozen when this machine was deployed, so
              the live value can disagree with what this collection actually
              charges (spec §0.1). */}
          <dd className="figure">
            {chain.formatNative(launched.mintFeeNative)} {chain.nativeSymbol} ({launched.mintFeeBps} bps)
          </dd>

          <dt className="text-neutral-500">Creator</dt>
          <dd className="figure break-all">{launched.creatorWallet}</dd>

          <dt className="text-neutral-500">Collection</dt>
          <dd className="figure break-all">{launched.collectionMint ?? "—"}</dd>

          <dt className="text-neutral-500">Candy machine</dt>
          <dd className="figure break-all">{launched.candyMachine ?? "—"}</dd>
        </dl>
        <Raffles raffles={raffles} />
      </Shell>
    );
  }

  // Not one of ours. The only other thing this slug can be is a collection
  // address, and the only source for it is the chain.
  if (!chain.isAddress(slug) || !rpcConfigured(chainParam)) notFound();

  const ref = chain.parseAsset(slug);
  const metadata = ref ? await chain.assetMetadata(ref).catch(() => null) : null;
  if (!metadata) notFound();

  // Raffles here whose prize belongs to this collection. Bounded on purpose:
  // an unbounded walk is a public page that one large collection can hold open
  // indefinitely.
  const raffles = await rafflesForOutsideCollection(chainParam, slug);

  return (
    <Shell title={metadata.name || slug} subtitle="Not launched here">
      <p className="mt-4 max-w-xl text-sm text-neutral-600">
        {/* Says what it is rather than implying an endorsement. The mint address
            is the only identity claim this page makes, and it is checkable. */}
        This collection was not launched on this site. Everything below is read from the chain
        directly — there is no supply, price or fee here because we have no part in it.
      </p>
      <dl className="mt-8 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-neutral-500">Collection</dt>
        <dd className="figure break-all">{slug}</dd>
        <dt className="text-neutral-500">Chain</dt>
        <dd className="figure">{chain.id}</dd>
      </dl>
      <Raffles raffles={raffles} />
    </Shell>
  );
}

function Shell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <Link className="text-sm underline underline-offset-4" href="/">
        Home
      </Link>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="figure mt-1 text-neutral-600">{subtitle}</p>
      {children}
    </main>
  );
}

function Raffles({ raffles }: { raffles: RaffleSummary[] }) {
  return (
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
                    {adapterFor(raffle.chain).formatNative(raffle.ticketPriceNative)}{" "}
                    {adapterFor(raffle.chain).nativeSymbol}
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
  );
}
