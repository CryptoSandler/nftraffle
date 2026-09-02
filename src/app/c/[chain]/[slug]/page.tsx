import Link from "next/link";
import { notFound } from "next/navigation";
import { assetDisplay, assetDisplays } from "../../../../lib/chain/asset-display";
import { AssetImage } from "../../../../components/AssetImage";
import { MintCollection } from "../../../../components/MintCollection";
import { Progress } from "../../../../components/Progress";
import { RaffleList, type RaffleRow } from "../../../../components/RaffleList";
import { readDeployedLaunch } from "../../../../lib/launch/candy";
import { classifyEndpoints } from "../../../../lib/chain/solana/cluster";
import { Countdown } from "../../../../components/Countdown";
import { utcInstant } from "../../../../lib/countdown";
import { isChainId } from "../../../../lib/chain/adapter";
import { adapterFor } from "../../../../lib/chain/registry";
import { rpcConfigured, solanaRpcUrls } from "../../../../lib/payments/config";
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
 * **`docs/benchmark-nft.md` is what this page was rebuilt against, and its list
 * B is why it looks nothing like Magic Eden's.** Magic Eden's collection page
 * opens with Floor Price, Top Offer, 7d Vol, Market Cap and Listed/Supply, and
 * that header is excellent — as the front end of an orderbook. Rebuilt over one
 * seller and no bids it is a row of blanks and zeroes, and every blank argues
 * that the collection is dead. What replaces it here is list A: the art as the
 * panel (A3), a progress rail that reports supply rather than demand (A1), the
 * countdown (A2), and an em dash wherever a fact does not exist (A4).
 *
 * **TWO KINDS OF COLLECTION REACH THIS PAGE**, which is the owner's answer to
 * open question Q5: a page for any collection, not only ones launched here.
 *
 *  - `slug` matches a row in `collections` → a collection we launched. It has
 *    numbers we recorded: supply, mint price, and the fee this specific candy
 *    machine charges.
 *  - `slug` is an address on `chain` → a collection we did not launch. There
 *    is no row, so **everything shown is derived from the chain** and nothing
 *    else. No supply we did not verify, no price, no fee — because we have none
 *    of those facts and inventing them would make an outside collection look
 *    like one we stand behind.
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
    const [raffles, cover, deployed] = await Promise.all([
      rafflesForCollection(launched.id),
      launched.collectionMint
        ? assetDisplay(chainParam, launched.collectionMint).catch(() => null)
        : Promise.resolve(null),
      /*
       * READ FROM THE CHAIN, not from a counter here. A candy machine is a
       * public account and anybody holding its address can mint from it, so a
       * number this site kept would be wrong the first time somebody did.
       *
       * A failed read is `null`, and every figure derived from it then renders
       * as an em dash rather than as zero (benchmark list A4).
       */
      launched.candyMachine && chainParam === "solana"
        ? readDeployedLaunch(launched.candyMachine).catch(() => null)
        : Promise.resolve(null),
    ]);

    const rows = await raffleRows(raffles);
    const priceText = `${chain.formatNative(launched.priceNative)} ${chain.nativeSymbol}`;

    return (
      <Shell
        title={launched.name}
        subtitle={launched.symbol}
        imageUrl={cover?.imageUrl ?? null}
        action={
          launched.candyMachine && chainParam === "solana"
            ? { href: "#mint", label: `Mint · ${priceText}` }
            : null
        }
      >
        {launched.candyMachine && chainParam === "solana" ? (
          <Mint chain={chainParam} launched={launched} deployed={deployed} />
        ) : null}

        <dl className="mt-10 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-quiet">Supply</dt>
          <dd className="figure">{launched.itemsAvailable}</dd>

          <dt className="text-quiet">Mint price</dt>
          <dd className="figure">{priceText}</dd>

          <dt className="text-quiet">Platform fee per mint</dt>
          {/* Read from the row, not from the current setting. The guard takes
              fixed lamports and was frozen when this machine was deployed, so
              the live value can disagree with what this collection actually
              charges (spec §0.1). */}
          <dd className="figure">
            {chain.formatNative(launched.mintFeeNative)} {chain.nativeSymbol} ({launched.mintFeeBps} bps)
          </dd>

          <dt className="text-quiet">Creator</dt>
          <dd className="figure break-all">{launched.creatorWallet}</dd>

          <dt className="text-quiet">Collection</dt>
          <dd className="figure break-all">{launched.collectionMint ?? "—"}</dd>

          <dt className="text-quiet">Candy machine</dt>
          <dd className="figure break-all">{launched.candyMachine ?? "—"}</dd>
        </dl>

        <RaffleList items={rows} />
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
  const [raffles, display] = await Promise.all([
    rafflesForOutsideCollection(chainParam, slug),
    assetDisplay(chainParam, slug).catch(() => null),
  ]);
  const rows = await raffleRows(raffles);

  return (
    <Shell
      title={metadata.name || slug}
      subtitle="Not launched here"
      imageUrl={display?.imageUrl ?? null}
      action={null}
    >
      <p className="mt-6 max-w-xl text-sm text-quiet">
        {/* Says what it is rather than implying an endorsement. The mint address
            is the only identity claim this page makes, and it is checkable. */}
        This collection was not launched on this site. Everything below is read from the chain
        directly — there is no supply, price or fee here because we have no part in it.
      </p>
      <dl className="mt-8 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-quiet">Collection</dt>
        <dd className="figure break-all">{slug}</dd>
        <dt className="text-quiet">Chain</dt>
        <dd className="figure">{chain.id}</dd>
        {/* The three facts a launched collection has and this one does not. The
            em dash is the point (benchmark list A4): a page that simply omitted
            the rows would look like a collection with no supply rather than one
            we know nothing about. */}
        <dt className="text-quiet">Supply</dt>
        <dd className="figure">—</dd>
        <dt className="text-quiet">Mint price</dt>
        <dd className="figure">—</dd>
        <dt className="text-quiet">Platform fee per mint</dt>
        <dd className="figure">—</dd>
      </dl>
      <RaffleList items={rows} />
    </Shell>
  );
}

/** The rows `RaffleList` needs, resolved once and in parallel like the home page. */
async function raffleRows(raffles: RaffleSummary[]): Promise<RaffleRow[]> {
  const displays = await assetDisplays(raffles);
  return raffles.map((raffle) => {
    const display = displays.get(`${raffle.chain}:${raffle.prizeAsset}`);
    const chain = adapterFor(raffle.chain);
    return {
      slug: raffle.slug,
      name: display?.name ?? raffle.prizeAsset,
      imageUrl: display?.imageUrl ?? null,
      priceText: `${chain.formatNative(raffle.ticketPriceNative)} ${chain.nativeSymbol}`,
      sold: raffle.ticketsSold,
      max: raffle.maxTickets,
      status: raffle.status,
      endsAtMs: raffle.endsAt.getTime(),
    };
  });
}

/**
 * The page's frame: the art as the panel, the name under it, and — on a phone —
 * the one action pinned to the bottom.
 *
 * `docs/benchmark-nft.md` list A3 and A5. The sticky bar is a LINK to the mint
 * control rather than a second copy of it: the control carries wallet state, and
 * two instances of it on one page would be two wallet sessions disagreeing about
 * which one the person is using. It carries the price so it is a fact and not
 * only a scroll button.
 */
function Shell({
  title,
  subtitle,
  imageUrl,
  action,
  children,
}: {
  title: string;
  subtitle: string;
  imageUrl: string | null;
  action: { href: string; label: string } | null;
  children: React.ReactNode;
}) {
  return (
    <>
      <main className="mx-auto w-full max-w-2xl px-6 pb-28 pt-8">
        <Link className="text-sm text-quiet underline underline-offset-4" href="/">
          Home
        </Link>

        <AssetImage
          src={imageUrl}
          name={title}
          className="mt-6 aspect-square w-full rounded-2xl"
        />

        <h1 className="display mt-6 text-[clamp(1.75rem,6vw,3rem)]">{title}</h1>
        <p className="figure mt-1 text-quiet">{subtitle}</p>
        {children}
      </main>

      {action && (
        <div className="actionbar fixed inset-x-0 bottom-16 z-10 px-4 py-3 sm:hidden">
          <a
            className="pop-action flex items-center justify-center px-6 py-3 text-base"
            href={action.href}
          >
            {action.label}
          </a>
        </div>
      )}
    </>
  );
}

/**
 * The mint panel, with what is left read off the chain.
 *
 * Separate so the page's own body stays a list of facts. The cluster is
 * classified server-side and passed down as a NAME — never the endpoint, which
 * is the whole reason `/api/rpc` exists.
 */
function Mint({
  chain,
  launched,
  deployed,
}: {
  chain: "solana";
  launched: {
    slug: string;
    name: string;
    candyMachine: string | null;
    itemsAvailable: number;
    priceNative: bigint;
    mintFeeNative: bigint;
  };
  deployed: Awaited<ReturnType<typeof readDeployedLaunch>>;
}) {
  const adapter = adapterFor(chain);
  const remaining = deployed
    ? Number(deployed.itemsAvailable - deployed.itemsRedeemed)
    : launched.itemsAvailable;

  return (
    <section id="mint" className="mt-10">
      <h2 className="display text-xl">Mint</h2>

      {/*
        * The rail, and the em dash when the chain could not be asked. `total: 0`
        * is how `Progress` is told "unknown" — it renders a dash rather than a
        * bar at 0%, because "nothing minted" and "we could not ask" are
        * different sentences (benchmark list A1 and A4).
        */}
      <div className="mt-4">
        <Progress
          done={deployed ? Number(deployed.itemsRedeemed) : 0}
          total={deployed ? Number(deployed.itemsAvailable) : 0}
          label={`Minted from ${launched.name}`}
          unit="minted"
        />
      </div>

      {/*
        * THE CAPTION IS NOT DECORATION. A `Countdown` drops its label once the
        * instant has passed and leaves only the absolute time — by design, so a
        * finished clock is not recoloured or relabelled. Rendered bare, that is
        * a timestamp floating under a progress bar with nothing saying what it
        * is, which is what the first capture of this page showed. The caption
        * reads correctly in both states: live, "MINT START / opens in 3h 20m";
        * elapsed, "MINT START / 2026-09-02T04:11:25Z".
        */}
      {deployed?.startsAtMs ? (
        <>
          <p className="mt-4 text-xs uppercase tracking-wide text-quiet">Mint start</p>
          <p className="mt-1">
            <Countdown targetMs={deployed.startsAtMs} label="opens in" />
          </p>
        </>
      ) : null}

      <div className="mt-4">
        <MintCollection
          slug={launched.slug}
          proxyCluster={classifyEndpoints(solanaRpcUrls())}
          isProduction={process.env.VERCEL_ENV === "production"}
          priceDisplay={adapter.formatNative(launched.priceNative)}
          mintFeeDisplay={adapter.formatNative(launched.mintFeeNative)}
          nativeSymbol={adapter.nativeSymbol}
          remaining={remaining}
          /*
           * The INSTANT, not a sentence about it. Whether it is still ahead is
           * a question about now, and now is not something a server component
           * may read during render — so the panel decides, once, on mount.
           */
          startsAtMs={deployed?.startsAtMs ?? null}
          startsAtText={deployed?.startsAtMs ? utcInstant(new Date(deployed.startsAtMs)) : null}
        />
      </div>
    </section>
  );
}
