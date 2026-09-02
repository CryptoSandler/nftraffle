/**
 * The working wordmark.
 *
 * Set in the display face at a weight where the letters read as a shape, which
 * is the whole of this direction's brand argument. Still TYPE and not a drawing
 * — the name is undecided (`DESIGN.md` §11) and nothing here has to be redrawn
 * when it changes. `docs/design-popmint.md` lists the candidates whose `.fun`
 * domain was verified free.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={`display text-xl ${className}`}>popmint</span>;
}
