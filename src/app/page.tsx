import Link from "next/link";
import { adapterFor } from "../lib/chain/registry";
import { assetDisplays } from "../lib/chain/asset-display";
import { liveRaffles, recentCollections } from "../lib/raffles/listing";
import { readDeployedLaunch } from "../lib/launch/candy";
import { AssetImage } from "../components/AssetImage";
import { Countdown } from "../components/Countdown";
import { Progress } from "../components/Progress";
import { Wordmark } from "../components/Wordmark";

export const dynamic = "force-dynamic";

/**
 * The home page — POPMINT.
 *
 * **The bet.** A creator with art and no wallet is the person arrow one of the
 * loop is aimed at, and neither a gallery nor a terminal invites them. This one
 * does: one loud colour, a promise stated as a NUMBER rather than an adjective
 * (Gumroad's move — `docs/references-design.md` §6), and type heavy enough to
 * read as a shape.
 *
 * **Zero casino still holds, and this is where it costs something.** No
 * confetti, no gold, no flashing, no "you won" register, nothing that spins.
 * The motion budget is two pixels of press (`docs/decisions.md` Q19, unchanged
 * by Q22).
 *
 * **What `docs/benchmark-nft.md` added here**, and nothing from its list B: the
 * progress rail on every card (A1), the countdown left as the loudest fact (A2),
 * art as the panel (A3), the em dash where a fact does not exist (A4), the peek
 * carousel on a phone (A7), and "check the draw" on the card rather than only on
 * the page (A11). No floor, no volume, no rarity, no trending.
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

  /*
   * HOW MANY OF EACH COLLECTION ARE MINTED, READ FROM THE CHAIN.
   *
   * There is no counter for this here and there must not be: a candy machine is
   * a public account and anybody holding its address can mint from it, so a
   * number this site kept would be wrong the first time somebody did — the same
   * argument the collection page already carries.
   *
   * A read that fails resolves to `null` and the card renders an em dash rather
   * than `0%` (benchmark list A4). "Nothing minted" and "we could not ask" are
   * different sentences and a bar cannot tell them apart.
   *
   * ponytail: two RPC round trips per collection, in parallel. Fine at the sizes
   * `recentCollections` returns; if this list ever runs long, batch the machine
   * accounts through one `getMultipleAccounts` instead of one call each.
   */
  const minted = new Map<string, number | null>(
    await Promise.all(
      collections.map(async (c) => {
        if (!c.candyMachine || c.chain !== "solana") return [c.id, null] as const;
        const deployed = await readDeployedLaunch(c.candyMachine).catch(() => null);
        return [c.id, deployed ? Number(deployed.itemsRedeemed) : null] as const;
      }),
    ),
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
        *
        * The same three, in the same order and under the same names, are the
        * bottom tab rail on a phone (`TabRail`, benchmark list A6 and A10).
        */}
      <nav className="mt-20 grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3">
        <Door glyph="◆" name="Launch" href="/launch">
          Your art, a mint page, minutes.
        </Door>
        <Door
          glyph="●"
          name="Mint"
          href={firstMintable ? `/c/${firstMintable.chain}/${firstMintable.slug}` : "/launch"}
        >
          Buy from a collection made here.
        </Door>
        <Door glyph="▲" name="Raffle" href="/raffle/new">
          One asset, one clock, one draw.
        </Door>
      </nav>

      <section className="mt-20">
        <h2 className="display text-2xl">Running now</h2>
        {running.length === 0 ? (
          <p className="mt-4 text-quiet">Nothing running. Yours could be.</p>
        ) : (
          /*
           * THE PEEK CAROUSEL, on a phone only (benchmark list A7, from
           * Scatter). The neighbouring card is visible at the edge, which is
           * what makes the swipe discoverable — a row that ends flush at the
           * viewport reads as the end of the list, and no dots or arrow can
           * undo that as cheaply as showing the next card.
           *
           * Scroll snapping is CSS. There is no carousel library, no autoplay
           * and no timer: something that moves on its own is the one thing §6
           * refuses outright.
           */
          <ul className="mt-6 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 sm:grid sm:grid-cols-2 sm:gap-6 sm:overflow-x-visible">
            {running.map((raffle) => {
              const display = displays.get(`${raffle.chain}:${raffle.prizeAsset}`);
              const chain = adapterFor(raffle.chain);
              return (
                <li
                  key={raffle.id}
                  className="door w-[82%] shrink-0 snap-center sm:w-auto sm:shrink"
                >
                  <Link className="block" href={`/r/${raffle.slug}`}>
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
                    <div className="mt-3">
                      <Progress
                        done={raffle.ticketsSold}
                        total={raffle.maxTickets}
                        label={`Tickets sold for ${display?.name ?? "this raffle"}`}
                        unit="tickets"
                      />
                    </div>
                    <p className="mt-3">
                      <Countdown targetMs={raffle.endsAt.getTime()} label="closes in" />
                    </p>
                  </Link>
                  {/*
                    * A11: the honest bit is reachable from the CARD, not only
                    * from the page behind it. It is a sibling of the card link
                    * rather than inside it because an anchor inside an anchor is
                    * invalid and browsers resolve it by dropping one.
                    */}
                  <p className="mt-2 text-xs">
                    <Link
                      className="text-quiet underline underline-offset-4"
                      href={`/r/${raffle.slug}/verify`}
                    >
                      Check the draw
                    </Link>
                  </p>
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
              const done = minted.get(collection.id) ?? null;
              return (
                <li key={collection.id} className="door">
                  <Link className="block" href={`/c/${collection.chain}/${collection.slug}`}>
                    <AssetImage
                      src={cover?.imageUrl ?? null}
                      name={collection.name}
                      className="aspect-square w-full rounded-2xl"
                    />
                    <h3 className="display mt-3 truncate text-base">{collection.name}</h3>
                    <p className="text-sm text-quiet">
                      <span className="figure">
                        {chain.formatNative(collection.priceNative)} {chain.nativeSymbol}
                      </span>{" "}
                      each
                    </p>
                    <div className="mt-3">
                      <Progress
                        done={done ?? 0}
                        total={done === null ? 0 : collection.itemsAvailable}
                        label={`Minted from ${collection.name}`}
                        unit="minted"
                      />
                    </div>
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
  glyph,
  name,
  href,
  children,
}: {
  glyph: string;
  name: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link className="door block rounded-2xl bg-panel p-6" href={href}>
      <span className="text-xl" aria-hidden="true">
        {glyph}
      </span>
      <h2 className="display mt-2 text-2xl">{name}</h2>
      <p className="mt-2 text-sm text-quiet">{children}</p>
    </Link>
  );
}
