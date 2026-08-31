import Link from "next/link";
import { notFound } from "next/navigation";
import {
  checkDrawAnchor,
  deriveWinner,
  drawMaterial,
  verifyCommitment,
} from "../../../../lib/raffles/draw";
import { raffleBySlug } from "../../../../lib/raffles/lifecycle";
import { assetDisplay } from "../../../../lib/chain/asset-display";
import { utcInstant } from "../../../../lib/countdown";
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
  const asset = await assetDisplay(raffle.chain, raffle.prizeAsset);
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

  /**
   * THE SECOND CHECK ON THIS PAGE, and it is new
   * (docs/decisions.md Q14, docs/findings-2026-08-31-draw-margin.md).
   *
   * Recomputing the winner proves the arithmetic. It says nothing about whether
   * the block feeding that arithmetic was allowed to — and under the previous
   * design it frequently was not, because the announced block arrived before
   * the sale closed and its hash was public while tickets were still on sale.
   *
   * So this re-runs the same rule the draw route enforced, from the published
   * values, rather than asserting the server followed it. The reader can go
   * further and confirm the timestamp itself against the chain — the
   * instructions below say how, and that is the version that trusts nobody.
   */
  const anchorCheck =
    raffle.drawBlockTime !== null
      ? checkDrawAnchor({
          blockTimeMs: raffle.drawBlockTime.getTime(),
          endsAtMs: raffle.endsAt.getTime(),
          drawAtMs: raffle.drawAt.getTime(),
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
      {/* Named, so a reader arriving from a link knows which raffle they are
          checking without decoding a slug. */}
      <p className="mt-1 text-neutral-600">{asset.name}</p>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          The method
        </h2>
        <p className="mt-3 text-neutral-700">
          When this raffle was created, the server generated a random 32-byte seed, published{" "}
          <code className="figure">sha256(seed)</code>, and published an{" "}
          <strong>instant</strong> — ten minutes after the sale closes — that the draw&apos;s
          entropy would be anchored to. The draw uses the first{" "}
          {raffle.chain === "solana" ? "Solana block" : "Robinhood Chain block"} produced at or
          after that instant. No such block existed when the raffle was created, so its hash could
          not be known by us; and none can exist before the sale closes, so it cannot be known by a
          buyer either.
        </p>
        {raffle.chain === "robinhood" && (
          /*
           * THE NARROWER CLAIM, SAID HERE AND NOT ONLY IN THE CAVEATS BELOW
           * (docs/decisions.md Q7, and Q17 on why it moved up).
           *
           * It was already at the bottom of this page, under "what this does
           * not prove", which was the right place while Solana was the chain
           * people met first. Robinhood is now the chain people meet first, so
           * the limit belongs where somebody reads how the draw works — not
           * several screens below it, after they have decided to trust it.
           *
           * The sentence is deliberately about WHO, because that is the whole
           * difference. On Solana a future slot's hash is unknowable to
           * everyone. Here it is unknowable to us, which is what makes bias by
           * us impossible, and not provably unknowable to the party that orders
           * the blocks.
           */
          <p className="mt-3 rounded border border-neutral-300 bg-neutral-50 p-3 text-neutral-700">
            <strong>One thing to be clear about on this chain.</strong> Robinhood Chain orders its
            blocks through a single sequencer. So &ldquo;the hash could not be known in
            advance&rdquo; is a statement about <em>us</em>: we commit to the seed before that
            block exists, and we cannot influence which hash it gets. It is not a proof about the
            sequencer, which is the party deciding the order. On Solana no one can know a future
            slot&apos;s hash; here, we cannot, and that is a smaller claim. It is stated rather than
            left for you to work out.
          </p>
        )}
        <p className="mt-3 text-neutral-700">
          It is an instant rather than a block number deliberately. A block number has to be
          predicted from how fast the chain is running, and that prediction is wrong by however much
          the real rate differs from the assumed one — early, if the chain is faster than assumed.
          A time is not a prediction: a chain running at any speed still resolves the same instant.
        </p>
        <p className="mt-3 text-neutral-700">
          When the raffle closed, the seed was published and that block&apos;s hash was read. The
          winner is:
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

          <dt className="text-neutral-500">anchored to (published at creation)</dt>
          <dd className="figure">{utcInstant(raffle.drawAt)}</dd>

          <dt className="text-neutral-500">closed at</dt>
          <dd className="figure">{utcInstant(raffle.endsAt)}</dd>

          <dt className="text-neutral-500">block used</dt>
          <dd className="figure">{raffle.drawHeight?.toString() ?? "not resolved yet"}</dd>

          <dt className="text-neutral-500">that block&apos;s time</dt>
          <dd className="figure">
            {raffle.drawBlockTime ? utcInstant(raffle.drawBlockTime) : "not resolved yet"}
          </dd>

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
              The block the draw used came after the sale closed:{" "}
              <strong>
                {anchorCheck === null
                  ? "not recorded — this raffle predates the anchored draw, so this cannot be checked here"
                  : anchorCheck.ok
                    ? "yes"
                    : "NO — this block existed while tickets were on sale"}
              </strong>
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

      {revealed && raffle.drawHeight !== null && (
        /**
         * THE PART THAT TRUSTS NOBODY, INCLUDING US.
         *
         * Everything above recomputes from values this server published. That
         * catches a server whose arithmetic disagrees with its own inputs, which
         * is worth catching, and it does not catch a server that published a
         * timestamp the chain never reported.
         *
         * These two lookups do. They go to the chain directly and establish the
         * only two facts the anchor rule needs: the block used is at or after
         * the published instant, and the block before it is not. Together those
         * make it THE FIRST such block — which is what makes the draw
         * deterministic, and what stops us having chosen among several.
         */
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Checking the block against the chain yourself
          </h2>
          <p className="mt-3 text-neutral-700">
            The values above are ours. These two lookups are not — they ask{" "}
            {raffle.chain === "solana" ? "Solana" : "Robinhood Chain"} directly, through any node
            you like, and are what turns the section above from our claim into your check.
          </p>
          <pre className="figure mt-3 overflow-x-auto rounded border border-neutral-300 bg-neutral-50 p-4 text-xs">
{raffle.chain === "solana"
  ? `# 1. The block we used. Its blockhash and blockTime must match the values above.
solana block ${raffle.drawHeight.toString()} --url mainnet-beta

# 2. Every produced slot before it, back to the close, must be EARLIER than
#    the anchored instant. If one is not, we did not use the first block.
solana block <that slot> --url mainnet-beta`
  : `# 1. The block we used. Its hash and timestamp must match the values above.
cast block ${raffle.drawHeight.toString()} --rpc-url <a Robinhood Chain node>

# 2. The block before it must be EARLIER than the anchored instant.
#    If it is not, we did not use the first block.
cast block ${(raffle.drawHeight - 1n).toString()} --rpc-url <a Robinhood Chain node>`}
          </pre>
          <p className="mt-3 text-neutral-700">
            Two things have to hold. The block we used is{" "}
            <strong>at or after the anchored instant</strong>, and the one before it is{" "}
            <strong>before</strong> it. The first is what makes the draw unknowable during the
            sale; the second is what makes it the only block we could have used.
          </p>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          What this does not prove
        </h2>
        {/*
          TWO TEXTS, ONE PER CHAIN, AND THE ROBINHOOD ONE IS NARROWER
          (docs/decisions.md Q7).

          On Solana a future slot's hash is unknowable to everyone. On an
          Arbitrum Orbit chain the sequencer is a single operator, so a future
          block hash is unknowable to US — which is what makes bias impossible —
          but is not provably unknowable to the party ordering the blocks.

          Reusing the Solana wording there would be a claim this product cannot
          support, and DESIGN.md §8.4 forbids exactly that.
        */}
        <p className="mt-3 text-neutral-700">
          {raffle.chain === "solana" ? (
            <>
              It proves the winner was not chosen after the fact: the commitment was published
              before the announced slot existed, so no seed could have been picked to suit a
              result. It does not prove the seed will be published at all — nothing here can force
              that.
            </>
          ) : (
            <>
              It proves <strong>we</strong> did not choose the winner after the fact: the
              commitment was published before the announced block existed, so no seed could have
              been picked to suit a result. It does not prove that <em>nobody</em> could have known
              that block in advance — Robinhood Chain orders its blocks through a single sequencer,
              and this raffle trusts that sequencer not to have influenced the hash. It also does
              not prove the seed will be published at all; nothing here can force that.
            </>
          )}{" "}
          Payouts are made by hand, and the raffle page shows the transaction ids for both, which
          you can look up yourself.
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
