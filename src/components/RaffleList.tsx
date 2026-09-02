"use client";

import Link from "next/link";
import { AssetImage } from "./AssetImage";
import { Countdown } from "./Countdown";
import { Progress } from "./Progress";
import { DensityToggle, useDensity } from "./DensityToggle";

/**
 * A collection's raffles, with the density toggle over them.
 *
 * `docs/benchmark-nft.md` list A8. It is a client component for one reason —
 * the toggle's state — and it takes plain data rather than doing its own
 * fetching, so every chain and database read stays on the server where the
 * page's other reads are.
 *
 * **Compact changes the row, never the facts.** Both settings show the name, the
 * ticket price, the progress rail and the way to check the draw. Compact makes
 * the image smaller and the padding tighter; it does not hide a column, because
 * a density control that removes information is a filter wearing the wrong name.
 * The countdown is the one thing only comfortable shows, and only because it is
 * a live element rather than a fact — the closing instant is in the row either
 * way, on the raffle's own page.
 *
 * **This is the listing row of DESIGN.md §5, not a card.** Cards are the home
 * page only; every surface past it uses the row.
 *
 * WHO CALLS THIS: `src/app/c/[chain]/[slug]/page.tsx`.
 */
export type RaffleRow = {
  slug: string;
  name: string;
  imageUrl: string | null;
  priceText: string;
  sold: number;
  max: number;
  status: string;
  endsAtMs: number;
};

export function RaffleList({ items }: { items: RaffleRow[] }) {
  const [density, setDensity] = useDensity();
  const compact = density === "compact";

  return (
    <section className="mt-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="display text-xl">Raffles for this collection</h2>
        {items.length > 1 && <DensityToggle density={density} onChange={setDensity} />}
      </div>

      {items.length === 0 ? (
        <p className="mt-4 text-quiet">No raffles for this collection yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-rule border-y border-rule">
          {items.map((raffle) => (
            <li key={raffle.slug} className={compact ? "py-2" : "py-4"}>
              <Link className="flex gap-4" href={`/r/${raffle.slug}`}>
                <AssetImage
                  src={raffle.imageUrl}
                  name={raffle.name}
                  className={compact ? "h-10 w-10 shrink-0" : "h-16 w-16 shrink-0"}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-4">
                    {/* The asset's name, never the slug — the slug is the URL. */}
                    <span className="truncate font-medium">{raffle.name}</span>
                    <span className="figure shrink-0 text-sm text-quiet">{raffle.priceText}</span>
                  </div>
                  <div className="mt-2">
                    <Progress
                      done={raffle.sold}
                      total={raffle.max}
                      label={`Tickets sold for ${raffle.name}`}
                      unit="tickets"
                    />
                  </div>
                  {!compact && raffle.status === "open" && (
                    <p className="mt-2">
                      <Countdown targetMs={raffle.endsAtMs} label="closes in" />
                    </p>
                  )}
                </div>
              </Link>
              {/* A11: reachable from the row, not only from the page behind it. */}
              <p className="mt-1 pl-14 text-xs">
                <Link
                  className="text-quiet underline underline-offset-4"
                  href={`/r/${raffle.slug}/verify`}
                >
                  Check the draw
                </Link>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
