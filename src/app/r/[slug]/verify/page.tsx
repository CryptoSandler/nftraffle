import Link from "next/link";
import { notFound } from "next/navigation";
import { deriveWinner, drawMaterial, verifyCommitment } from "../../../../lib/raffles/draw";
import { raffleBySlug } from "../../../../lib/raffles/lifecycle";
import { ticketsFor } from "../../../../lib/raffles/tickets";

export const dynamic = "force-dynamic";

/**
 * How this raffle's winner was computed, and how to check it without trusting
 * us.
 *
 * **This page is leg-one infrastructure, not a trust badge** (DESIGN.md §1). It
 * is written for somebody who does not believe the result, so it shows the
 * inputs, the arithmetic, and — the part most "provably fair" pages leave out —
 * what the mechanism cannot prove.
 *
 * The numbers on this page are recomputed here from the stored inputs rather
 * than read from the winner columns. That is the whole point: if the stored
 * winner ever disagreed with what the published inputs produce, this page says
 * so instead of quietly showing the stored value. A verification page that
 * displays a database column has verified nothing.
 */
export default async function VerifyPage({ params }: PageProps<"/r/[slug]/verify">) {
  const { slug } = await params;
  const raffle = await raffleBySlug(slug);
  if (!raffle) notFound();

  const tickets = await ticketsFor(raffle.id);
  const revealed = raffle.seed !== null && raffle.drawBlockhash !== null;

  const commitmentHolds = revealed ? verifyCommitment(raffle.seed!, raffle.seedHash) : null;

  // Recomputed, never read back. See the note above.
  const recomputed =
    revealed && tickets.length > 0
      ? deriveWinner({
          seedHash: raffle.seedHash,
          seed: raffle.seed!,
          drawBlockhash: raffle.drawBlockhash!,
          raffleId: raffle.id,
          ticketCount: tickets.length,
        })
      : null;

  const material = revealed
    ? drawMaterial({
        seedHash: raffle.seedHash,
        seed: raffle.seed!,
        drawBlockhash: raffle.drawBlockhash!,
        raffleId: raffle.id,
      })
    : null;

  const agrees =
    recomputed !== null && raffle.winningTicket !== null
      ? recomputed.winningTicket === raffle.winningTicket
      : null;

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <Link className="text-sm underline underline-offset-4" href={`/r/${slug}`}>
        Back to the raffle
      </Link>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight">How this draw was computed</h1>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          The method
        </h2>
        <p className="mt-3 text-neutral-700">
          When this raffle was created, the server generated a random 32-byte seed, published{" "}
          <code className="figure">sha256(seed)</code>, and announced the Solana slot whose
          blockhash the draw would use. That slot did not exist yet, so its blockhash could not be
          known by anyone — including us.
        </p>
        <p className="mt-3 text-neutral-700">
          When the raffle closed, the seed was published and the announced slot&apos;s blockhash
          was read. The winner is:
        </p>
        <pre className="figure mt-3 overflow-x-auto rounded border border-neutral-300 bg-neutral-50 p-4 text-xs">
{`material       = sha256(seedHash + seed + blockhash + raffleId)
winningTicket  = (material as a big-endian integer mod ticketCount) + 1`}
        </pre>
        <p className="mt-3 text-neutral-700">
          The four values are concatenated as text, in that order, with no separator. Tickets are
          numbered from 1 in the order they were sold.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          This raffle&apos;s values
        </h2>
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-neutral-500">raffleId</dt>
          <dd className="figure break-all">{raffle.id}</dd>

          <dt className="text-neutral-500">seedHash</dt>
          <dd className="figure break-all">{raffle.seedHash}</dd>

          <dt className="text-neutral-500">announced slot</dt>
          <dd className="figure">{raffle.drawSlot.toString()}</dd>

          <dt className="text-neutral-500">seed</dt>
          <dd className="figure break-all">{raffle.seed ?? "not revealed"}</dd>

          <dt className="text-neutral-500">blockhash</dt>
          <dd className="figure break-all">{raffle.drawBlockhash ?? "not read yet"}</dd>

          <dt className="text-neutral-500">ticketCount</dt>
          <dd className="figure">{tickets.length}</dd>

          {material && (
            <>
              <dt className="text-neutral-500">material</dt>
              <dd className="figure break-all">{material}</dd>
            </>
          )}
        </dl>
      </section>

      {!revealed ? (
        /**
         * THE STATE MOST SUCH PAGES RENDER AS AN EMPTY SECTION, and the one
         * this product is most obliged to name (spec §0.4). The commitment
         * makes bias impossible; it cannot make refusal impossible. So refusal
         * is shown as a state with a name rather than as a page that looks
         * unfinished.
         */
        <section className="mt-10 rounded border border-neutral-300 bg-neutral-50 p-4">
          <h2 className="font-semibold">The seed has not been revealed</h2>
          <p className="mt-2 text-neutral-700">
            {raffle.status === "open" || raffle.status === "draft"
              ? "This raffle has not closed yet. The seed is published when it does — publishing it earlier would let anyone compute the winning number and buy exactly that ticket."
              : "This raffle has closed and its seed has not been published. Until it is, this draw cannot be checked by anyone, including us. That is the one failure this method does not prevent: it makes a biased draw impossible and makes a withheld one visible, which is what this notice is."}
          </p>
        </section>
      ) : (
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            The check
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              The published seed hashes to the commitment:{" "}
              <strong>{commitmentHolds ? "yes" : "NO — this does not check out"}</strong>
            </li>
            <li>
              Recomputing from the values above gives ticket{" "}
              <span className="figure">{recomputed?.winningTicket ?? "—"}</span>, and the recorded
              winning ticket is <span className="figure">{raffle.winningTicket ?? "—"}</span>:{" "}
              <strong>{agrees ? "they agree" : "THEY DO NOT AGREE"}</strong>
            </li>
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          What this does not prove
        </h2>
        <p className="mt-3 text-neutral-700">
          It proves the winner was not chosen after the fact: the commitment was published before
          the announced slot existed, so no seed could have been picked to suit a result. It does
          not prove the seed will be published at all — nothing here can force that. Payouts are
          made by hand, and the raffle page shows the transaction signatures for both, which you
          can look up yourself.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Tickets
        </h2>
        <ul className="figure mt-3 space-y-1 text-xs">
          {tickets.map((ticket) => (
            <li key={ticket.number} className="break-all">
              {ticket.number}. {ticket.wallet}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
