import Link from "next/link";
import { notFound } from "next/navigation";
import { adapterFor } from "../../../lib/chain/registry";
import { classifyEndpoints } from "../../../lib/chain/solana/cluster";
import { solanaRpcUrls } from "../../../lib/payments/config";
import { BuyTickets } from "../../../components/BuyTickets";
import { BuyTicketsRobinhood } from "../../../components/BuyTicketsRobinhood";
import { chainIdFor, robinhoodNetwork } from "../../../lib/chain/robinhood/network";
import { assetDisplay } from "../../../lib/chain/asset-display";
import { AssetImage } from "../../../components/AssetImage";
import { Countdown } from "../../../components/Countdown";
import { Progress } from "../../../components/Progress";
import { utcInstant } from "../../../lib/countdown";
import { advanceRaffle, raffleBySlug } from "../../../lib/raffles/lifecycle";
import { payoutSplit } from "../../../lib/raffles/payout";
import { ticketsSold } from "../../../lib/raffles/tickets";
import { surfaceRefusal } from "../../../lib/surfaces";

export const dynamic = "force-dynamic";

/**
 * One raffle.
 *
 * `advanceRaffle` runs BEFORE anything is rendered, which is how a raffle whose
 * clock has run out is never shown as still selling. This project has no cron
 * (see `lifecycle.ts`), so reads are what drive transitions — and a page that
 * rendered first and advanced second would show a stale status to the one
 * person guaranteed to be looking.
 */
export default async function RafflePage({ params }: PageProps<"/r/[slug]">) {
  const { slug } = await params;
  const found = await raffleBySlug(slug);
  if (!found) notFound();

  const raffle = (await advanceRaffle(found.id)) ?? found;
  const sold = await ticketsSold(raffle.id);
  const split = payoutSplit({
    ticketPriceNative: raffle.ticketPriceNative,
    ticketsSold: sold,
    houseFeeBps: raffle.houseFeeBps,
  });
  const chain = adapterFor(raffle.chain);
  const buyingClosed = surfaceRefusal("buy_tickets", raffle.chain, `GET /r/${slug}`);
  // One classification per render, and only for the chain that needs it. A
  // Solana raffle must not pay for an EVM round trip.
  const robinhoodNet = raffle.chain === "robinhood" ? await robinhoodNetwork() : "unknown";
  // The raffle is titled by WHAT IS BEING RAFFLED. The slug lives in the URL and
  // nowhere else (`docs/design-state-2026-08-31.md` §3).
  const asset = await assetDisplay(raffle.chain, raffle.prizeAsset);

  const buyable = raffle.status === "open" && !buyingClosed;

  return (
    <>
    <main className="mx-auto w-full max-w-2xl px-6 pb-28 pt-8">
      <Link className="text-sm text-quiet underline underline-offset-4" href="/">
        All raffles
      </Link>

      {/*
        * ART AS THE PANEL (`docs/benchmark-nft.md` list A3). It was a 128px
        * thumbnail beside the title; the thing being raffled is the reason
        * anybody is on this page, and Scatter, OpenSea's hero and every
        * collection site in the benchmark give it the full width.
        */}
      <AssetImage
        src={asset.imageUrl}
        name={asset.name}
        className="mt-6 aspect-square w-full rounded-2xl"
      />

      <h1 className="display mt-6 text-[clamp(1.75rem,6vw,3rem)]">{asset.name}</h1>

      {/* The status is a word in the document, not a colour and not a timer
          reaching zero (DESIGN.md §9). */}
      <p className="mt-2 text-quiet">
        This raffle is <strong className="text-ink">{raffle.status}</strong>.
      </p>

      {/*
        * THE COUNTDOWN IS THE LOUDEST FACT ON THE PAGE (list A2), and it is the
        * one number this product owns: a clock is true on day zero, where a
        * floor price needs a market. `size="lead"` changes the type scale and
        * nothing else — same accent, same tabular face, same absolute instant
        * beside it for checking.
        */}
      {raffle.status === "open" && (
        <p className="mt-4">
          <Countdown targetMs={raffle.endsAt.getTime()} label="Closes in" size="lead" />
        </p>
      )}

      {/* Supply, not demand (list A1). `sold of max` is exact from the first
          ticket, which is what makes it the one marketplace pattern that
          survives here. */}
      <div className="mt-6">
        <Progress
          done={sold}
          total={raffle.maxTickets}
          label={`Tickets sold for ${asset.name}`}
          unit="tickets"
        />
      </div>

      {raffle.status === "cancelled" && (
        <p className="mt-4 rounded border border-rule bg-panel p-4">
          {/* The reason is mandatory in the schema precisely so this can never
              be an empty box shown to people who paid for tickets. */}
          This raffle was cancelled: {raffle.cancelledReason}
        </p>
      )}

      <dl className="mt-8 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-quiet">Prize</dt>
        {/* The name is the heading; this is the chain-native reference, which is
            what somebody looking it up in an explorer needs. */}
        <dd className="figure break-all">{asset.reference}</dd>

        <dt className="text-quiet">Ticket price</dt>
        <dd className="figure">
          {chain.formatNative(raffle.ticketPriceNative)} {chain.nativeSymbol}
        </dd>

        <dt className="text-quiet">Tickets</dt>
        {/* The ONLY odds figure any copy here may quote: a count of what sold,
            never a phrased chance (DESIGN.md §8.1). */}
        <dd className="figure">
          {sold} of {raffle.maxTickets} sold
        </dd>

        <dt className="text-quiet">Closes</dt>
        {/* Seconds, no milliseconds. The countdown above is for deciding; this
            is for checking, and both are on the page deliberately. */}
        <dd className="figure">{utcInstant(raffle.endsAt)}</dd>

        <dt className="text-quiet">Seller</dt>
        <dd className="figure break-all">{raffle.sellerWallet}</dd>
      </dl>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-quiet">
          The draw
        </h2>
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-quiet">Commitment</dt>
          <dd className="figure break-all">{raffle.seedHash}</dd>

          <dt className="text-quiet">Entropy anchored to</dt>
          <dd>
            {raffle.status === "closed" ? (
              <Countdown
                targetMs={raffle.drawAt.getTime()}
                label="drawable in"
              />
            ) : (
              <span className="figure">{utcInstant(raffle.drawAt)}</span>
            )}
          </dd>

          {raffle.winnerWallet && (
            <>
              <dt className="text-quiet">Winner</dt>
              <dd className="figure break-all">{raffle.winnerWallet}</dd>
              <dt className="text-quiet">Winning ticket</dt>
              <dd className="figure">{raffle.winningTicket}</dd>
            </>
          )}
        </dl>
        <p className="mt-3 text-sm">
          <Link className="underline underline-offset-4" href={`/r/${raffle.slug}/verify`}>
            How this draw is computed, and how to check it
          </Link>
        </p>
      </section>

      {raffle.status === "paid" && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-quiet">
            Payout
          </h2>
          {/* Both signatures were verified on chain before this row could say
              "paid" (spec §0.5). The page shows them so a reader can check the
              same thing the server did rather than take our word. */}
          <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-quiet">Prize sent</dt>
            <dd className="figure break-all">{raffle.prizeSignature}</dd>
            <dt className="text-quiet">Proceeds sent</dt>
            <dd className="figure break-all">{raffle.proceedsSignature}</dd>
          </dl>
        </section>
      )}

      <section id="buy" className="mt-10 border-t border-rule pt-6">
        {raffle.status !== "open" ? (
          <p className="text-quiet">Tickets are no longer on sale for this raffle.</p>
        ) : !buyingClosed ? (
          /*
           * THE CLUSTER IS CLASSIFIED HERE, ON THE SERVER, AND ONLY ITS ANSWER
           * GOES DOWN. Never the endpoint: `/api/rpc` exists so a paid
           * provider's URL stays server-side, and passing it to the browser to
           * label a screen would undo that from the other direction.
           *
           * `isProduction` comes from VERCEL_ENV for the same reason — a
           * hostname is not proof of anything, and the browser cannot be
           * trusted to say which deployment it is.
           */
          raffle.chain === "robinhood" ? (
            /*
             * Classified by ASKING the chain (`eth_chainId`), not by reading
             * the endpoint's shape: EVM nodes state which chain they are, and a
             * URL pattern is a guess about a provider's naming. Only the answer
             * goes down.
             */
            <BuyTicketsRobinhood
              slug={raffle.slug}
              serverNetwork={robinhoodNet}
              expectedChainId={chainIdFor(robinhoodNet)}
              isProduction={process.env.VERCEL_ENV === "production"}
              ticketPriceDisplay={chain.formatNative(raffle.ticketPriceNative)}
              ticketPriceWei={raffle.ticketPriceNative.toString()}
              nativeSymbol={chain.nativeSymbol}
              ticketsRemaining={raffle.maxTickets - sold}
            />
          ) : (
            <BuyTickets
              slug={raffle.slug}
              proxyCluster={classifyEndpoints(solanaRpcUrls())}
              isProduction={process.env.VERCEL_ENV === "production"}
              ticketPriceDisplay={chain.formatNative(raffle.ticketPriceNative)}
              nativeSymbol={chain.nativeSymbol}
              ticketsRemaining={raffle.maxTickets - sold}
            />
          )
        ) : (
          <p className="rounded border border-rule bg-panel p-4 text-quiet">
            {buyingClosed.message}
          </p>
        )}
      </section>

      {sold > 0 && (
        <p className="figure mt-8 text-xs text-quiet">
          Sold to date {chain.formatNative(split.grossNative)} {chain.nativeSymbol} · seller receives{" "}
          {chain.formatNative(split.sellerNetNative)} {chain.nativeSymbol} after a{" "}
          {raffle.houseFeeBps} bps platform fee
        </p>
      )}
    </main>

    {/*
      * THE ONE ACTION, PINNED, ON A PHONE ONLY (list A5, from Tensor and Magic
      * Eden). A link to the control rather than a second copy of it: the buy
      * panel carries wallet state, and two instances would be two wallet
      * sessions disagreeing about which one the person is using.
      *
      * It is rendered only when tickets can actually be bought. A pinned button
      * that cannot work is the one thing worse than no pinned button — which is
      * why the benchmark refused Magic Eden's Instant Sell tile (list B7).
      */}
    {buyable && (
      <div className="actionbar fixed inset-x-0 bottom-16 z-10 px-4 py-3 sm:hidden">
        <a className="pop-action flex items-center justify-center px-6 py-3 text-base" href="#buy">
          Buy a ticket · {chain.formatNative(raffle.ticketPriceNative)} {chain.nativeSymbol}
        </a>
      </div>
    )}
    </>
  );
}
