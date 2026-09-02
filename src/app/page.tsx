import Link from "next/link";
import { adapterFor } from "../lib/chain/registry";
import { assetDisplays } from "../lib/chain/asset-display";
import { liveRaffles, recentCollections } from "../lib/raffles/listing";
import { AssetImage } from "../components/AssetImage";
import { Countdown } from "../components/Countdown";
import { Wordmark } from "../components/Wordmark";

export const dynamic = "force-dynamic";

/**
 * The home page — POPMINT, the toy direction.
 *
 * **The bet.** A creator with art and no wallet is the person arrow one of the
 * loop is aimed at, and neither a gallery nor a terminal invites them. This one
 * does: one loud colour, a promise stated as a NUMBER rather than an adjective
 * (Gumroad's move — `docs/references-design.md` §6), and type heavy enough to
 * read as a shape.
 *
 * **Zero casino still holds, and this is where it costs something.** No
 * confetti, no gold, no flashing, no "you won" register, nothing that spins.
 * The motion budget is two pixels of press. A page can be loud and still not be
 * a table you play at, and keeping those apart is this direction's whole
 * discipline (`docs/decisions.md` Q19).
 *
 * **It is also the direction that reverses Q19's accent rule**: here the accent
 * is the thing you press. If this one is chosen, that decision gets reopened
 * rather than inherited.
 */
export default async function Home() {
  const [allRaffles, collections] = await Promise.all([liveRaffles(), recentCollections()]);
  const running = allRaffles.filter((raffle) => raffle.status === "open");
  const displays = await assetDisplays(running);
  const covers = await assetDisplays(
    collections
      .filter((c) => c.collectionMint)
      .map((c) => ({ chain: c.chain, prizeAsset: c.collectionMint! })),
  );
  const firstMintable = collections[0];

  return (
    <main className="mx-auto w-full max-w-3xl px-6 pb-24 pt-8">
      <header className="flex items-center justify-between">
        <Wordmark />
        <Link className="text-sm text-quiet underline underline-offset-4" href="/admin">
          Operator
        </Link>
      </header>

      <section className="mt-16">
        <h1 className="display text-[clamp(2.5rem,9vw,4.5rem)]">
          0 → live
          <br />
          in 3 minutes
        </h1>
        <p className="mt-6 max-w-xl text-lg text-quiet">
          Put your art on Solana with nobody&apos;s permission, sell it by mint or by raffle, and
          keep the proceeds. No application. No review. No allowlist.
        </p>
        <Link className="pop-action mt-8 inline-block px-7 py-3 text-lg" href="/launch">
          Start a collection
        </Link>
      </section>

      {/*
        * THREE DOORS, ONE WEIGHT. Same component, same size, same press. The
        * big button above is the same destination as door one — a hierarchy of
        * emphasis, not of importance, because a person who already knows what
        * they want should not have to read a hero to get to it.
        */}
      <nav className="mt-20 grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3">
        <Door emoji="◆" name="Launch" href="/launch">
          Your art, a mint page, minutes.
        </Door>
        <Door
          emoji="●"
          name="Mint"
          href={firstMintable ? `/c/${firstMintable.chain}/${firstMintable.slug}` : "/launch"}
        >
          Buy from a collection made here.
        </Door>
        <Door emoji="▲" name="Raffle" href="/raffle/new">
          One asset, one clock, one draw.
        </Door>
      </nav>

      <section className="mt-20">
        <h2 className="display text-2xl">Running now</h2>
        {running.length === 0 ? (
          <p className="mt-4 text-quiet">Nothing running. Yours could be.</p>
        ) : (
          <ul className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 sm:grid-cols-2">
            {running.map((raffle) => {
              const display = displays.get(`${raffle.chain}:${raffle.prizeAsset}`);
              const chain = adapterFor(raffle.chain);
              return (
                <li key={raffle.id}>
                  <Link className="door block" href={`/r/${raffle.slug}`}>
                    <AssetImage
                      src={display?.imageUrl ?? null}
                      name={display?.name ?? raffle.prizeAsset}
                      className="aspect-square w-full rounded-2xl"
                    />
                    <div className="mt-3 flex items-baseline justify-between gap-3">
                      <h3 className="display truncate text-lg">
                        {display?.name ?? raffle.prizeAsset}
                      </h3>
                      <span className="figure shrink-0 text-sm">
                        {chain.formatNative(raffle.ticketPriceNative)} {chain.nativeSymbol}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-quiet">
                      <span className="figure">{raffle.maxTickets - raffle.ticketsSold}</span> of{" "}
                      <span className="figure">{raffle.maxTickets}</span> tickets left
                    </p>
                    <p className="mt-2">
                      <Countdown targetMs={raffle.endsAt.getTime()} label="closes in" />
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-20">
        <h2 className="display text-2xl">Made here</h2>
        {collections.length === 0 ? (
          <p className="mt-4 text-quiet">Nothing yet.</p>
        ) : (
          <ul className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 sm:grid-cols-3">
            {collections.map((collection) => {
              const cover = collection.collectionMint
                ? covers.get(`${collection.chain}:${collection.collectionMint}`)
                : undefined;
              const chain = adapterFor(collection.chain);
              return (
                <li key={collection.id}>
                  <Link className="door block" href={`/c/${collection.chain}/${collection.slug}`}>
                    <AssetImage
                      src={cover?.imageUrl ?? null}
                      name={collection.name}
                      className="aspect-square w-full rounded-2xl"
                    />
                    <h3 className="display mt-3 truncate text-base">{collection.name}</h3>
                    <p className="text-sm text-quiet">
                      <span className="figure">{collection.itemsAvailable}</span> items ·{" "}
                      <span className="figure">
                        {chain.formatNative(collection.priceNative)} {chain.nativeSymbol}
                      </span>
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <footer className="mt-20 rounded-2xl bg-panel p-6 text-sm text-quiet">
        <p className="max-w-xl">
          <strong className="text-ink">Every draw can be checked.</strong> The winning number is
          committed to before the raffle closes and published afterwards with the block it used, so
          anyone can recompute it. Open any raffle and follow{" "}
          <span className="text-ink">how this draw is computed</span>.
        </p>
      </footer>
    </main>
  );
}

/** One of the three doors. Identical in weight by construction. */
function Door({
  emoji,
  name,
  href,
  children,
}: {
  emoji: string;
  name: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link className="door block rounded-2xl bg-panel p-6" href={href}>
      <span className="text-xl" aria-hidden="true">
        {emoji}
      </span>
      <h2 className="display mt-2 text-2xl">{name}</h2>
      <p className="mt-2 text-sm text-quiet">{children}</p>
    </Link>
  );
}
