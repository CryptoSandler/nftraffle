/**
 * The wordmark.
 *
 * Set in the display face at a size where the letters read as a shape, which is
 * the whole of this direction's brand argument. **TYPE, never a drawing** — and
 * that stays true after the domain is bought (`DESIGN.md` §11). The name was
 * decided on 2026-09-02 (`docs/decisions.md` Q22); what is still pending is the
 * domain, and `SITE_URL` and `package.json` wait for it.
 *
 * A logo file would be a fourth place the name lives and the one place a rename
 * cannot reach with an edit. Do not add one.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={`display text-xl ${className}`}>popmint</span>;
}
