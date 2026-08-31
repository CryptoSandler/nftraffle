import Link from "next/link";
import { notFound } from "next/navigation";
import { adapterFor } from "../../../lib/chain/registry";
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

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <Link className="text-sm underline underline-offset-4" href="/">
        All raffles
      </Link>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight">{raffle.slug}</h1>

      {/* The status is a word in the document, not a colour and not a timer
          reaching zero (DESIGN.md §9). */}
      <p className="mt-1 text-neutral-600">
        This raffle is <strong>{raffle.status}</strong>.
      </p>

      {raffle.status === "cancelled" && (
        <p className="mt-4 rounded border border-neutral-300 bg-neutral-50 p-4">
          {/* The reason is mandatory in the schema precisely so this can never
              be an empty box shown to people who paid for tickets. */}
          This raffle was cancelled: {raffle.cancelledReason}
        </p>
      )}

      <dl className="mt-8 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-neutral-500">Prize</dt>
        <dd className="figure break-all">{chain.parseAsset(raffle.prizeAsset)?.display ?? raffle.prizeAsset}</dd>

        <dt className="text-neutral-500">Ticket price</dt>
        <dd className="figure">
          {chain.formatNative(raffle.ticketPriceNative)} {chain.nativeSymbol}
        </dd>

        <dt className="text-neutral-500">Tickets</dt>
        {/* The ONLY odds figure any copy here may quote: a count of what sold,
            never a phrased chance (DESIGN.md §8.1). */}
        <dd className="figure">
          {sold} of {raffle.maxTickets} sold
        </dd>

        <dt className="text-neutral-500">Closes</dt>
        <dd className="figure">{raffle.endsAt.toISOString()}</dd>

        <dt className="text-neutral-500">Seller</dt>
        <dd className="figure break-all">{raffle.sellerWallet}</dd>
      </dl>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          The draw
        </h2>
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-neutral-500">Commitment</dt>
          <dd className="figure break-all">{raffle.seedHash}</dd>

          <dt className="text-neutral-500">Announced slot</dt>
          <dd className="figure">{raffle.drawSlot.toString()}</dd>

          {raffle.winnerWallet && (
            <>
              <dt className="text-neutral-500">Winner</dt>
              <dd className="figure break-all">{raffle.winnerWallet}</dd>
              <dt className="text-neutral-500">Winning ticket</dt>
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
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Payout
          </h2>
          {/* Both signatures were verified on chain before this row could say
              "paid" (spec §0.5). The page shows them so a reader can check the
              same thing the server did rather than take our word. */}
          <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-neutral-500">Prize sent</dt>
            <dd className="figure break-all">{raffle.prizeSignature}</dd>
            <dt className="text-neutral-500">Proceeds sent</dt>
            <dd className="figure break-all">{raffle.proceedsSignature}</dd>
          </dl>
        </section>
      )}

      <section className="mt-10 border-t border-neutral-200 pt-6">
        {raffle.status !== "open" ? (
          <p className="text-neutral-600">Tickets are no longer on sale for this raffle.</p>
        ) : !buyingClosed ? (
          <p className="text-neutral-600">
            {/* The buy panel needs a wallet connection and is the next batch.
                Saying so plainly beats a button that cannot work. */}
            Connect a wallet to buy tickets. Payment is a single SOL transfer, verified on chain
            before any ticket is issued.
          </p>
        ) : (
          <p className="rounded border border-neutral-300 bg-neutral-50 p-4 text-neutral-700">
            {buyingClosed.message}
          </p>
        )}
      </section>

      {sold > 0 && (
        <p className="figure mt-8 text-xs text-neutral-500">
          Sold to date {chain.formatNative(split.grossNative)} {chain.nativeSymbol} · seller receives{" "}
          {chain.formatNative(split.sellerNetNative)} {chain.nativeSymbol} after a{" "}
          {raffle.houseFeeBps} bps platform fee
        </p>
      )}
    </main>
  );
}
