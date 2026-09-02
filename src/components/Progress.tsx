/**
 * The progress rail — supply, and nothing else.
 *
 * `docs/benchmark-nft.md` list A1. Scatter's execution is the reference: a track,
 * a fill, a percent at one end and a fraction at the other. It is the one pattern
 * borrowed from a marketplace that stays true with **no liquidity**, because it
 * reports supply — which this product knows exactly — rather than demand, which
 * it does not. `0 / 1000` is as honest a sentence as `70 / 1111`.
 *
 * **A total of zero renders an em dash, not a bar.** A rail of 0% is a claim that
 * nothing has sold; "we do not know the supply" is a different statement and the
 * page must not collapse them (DESIGN.md §8.5). It is also why `role=progressbar`
 * is not emitted in that case: `aria-valuemax={0}` is not a valid range, and a
 * screen reader announcing "0 percent" would be reading a number nobody wrote.
 *
 * **Nothing here moves.** The width is a server-rendered style and the fill has
 * no easing of any kind: DESIGN.md §6 forbids animating a number, and a bar that
 * glides toward its value reads as live when the page will not change until it
 * is reloaded.
 *
 * WHO CALLS THIS: the home page's raffle and collection cards, the collection
 * page's mint panel, and the raffle page.
 */
export function Progress({
  done,
  total,
  label,
  unit,
}: {
  done: number;
  total: number;
  label: string;
  unit: string;
}) {
  if (!Number.isFinite(total) || total <= 0) {
    return (
      <p className="figure text-xs text-quiet">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{label} unknown</span>
      </p>
    );
  }

  // Clamped because the two numbers come from different places — a candy machine
  // read from the chain and a supply recorded at launch — and a page that renders
  // a bar wider than its track over a disagreement hides the disagreement.
  const shown = Math.max(0, Math.min(done, total));
  const pct = Math.round((shown / total) * 100);

  return (
    <div>
      <div
        className="rail"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={shown}
        aria-valuetext={`${shown} of ${total} ${unit}`}
        aria-label={label}
      >
        <div className="rail-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 flex items-baseline justify-between gap-3 text-xs text-quiet">
        <span className="figure">{pct}%</span>
        <span className="figure">
          {shown} / {total} {unit}
        </span>
      </p>
    </div>
  );
}
