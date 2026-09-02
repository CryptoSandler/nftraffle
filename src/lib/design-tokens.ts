/**
 * The palette, as data.
 *
 * **These values are duplicated in `DESIGN.md` §2 on purpose, and a test asserts
 * the two agree** (`__tests__/design-tokens.test.ts`). The document is where the
 * reasoning lives and the code is where the rendering comes from; a palette that
 * exists only in CSS is one nobody can argue with, and a palette that exists only
 * in prose is one nobody applies. The guardian reads the document, so a hex
 * changed in one place fails the suite rather than drifting quietly.
 *
 * **The design is settled by `docs/decisions.md` Q19 as amended by Q22**, and
 * every rule below is one of those answers rather than taste:
 *
 *  - **One accent with exactly two jobs: the action and the clock.** `.pop-action`
 *    and `.clock`, and nothing else — not a heading, not body text, not a border,
 *    not a state, not an error. This REVERSES Q19's first answer, which gave the
 *    accent one job and priced it at a black-on-white primary action; the owner
 *    reopened and re-answered it 2026-09-02 as Q22. Do not widen it further here:
 *    the next widening is the one with no argument behind it.
 *  - **Zero casino, unchanged.** No gold, no red urgency, no green success. Q22
 *    reopened the accent's job and nothing else; the register did not move.
 *
 * **The accent is violet, and the hue is a decision.** Red and gold are the casino
 * register outright. Green reads as "go" and as money. Blue reads as a hyperlink,
 * and neither a countdown nor a button is one. Magenta and pink are Magic Eden's,
 * and this palette's whole risk is being mistaken for them. Violet is the nearest
 * loud hue that is none of those, and these two darknesses are the ones that still
 * clear 8:1 on ground AND panel in both modes — a lighter violet does not.
 *
 * WHO CALLS THIS: `src/app/globals.css` carries the same values as CSS custom
 * properties (the guardian checks those too); nothing imports this at runtime
 * except the test that defends it.
 */

export type Mode = "light" | "dark";

export type TokenName = "ground" | "panel" | "ink" | "quiet" | "rule" | "edge" | "accent";

/**
 * What each token is for. Written here rather than in a comment because the
 * guardian asserts the document says the same thing.
 */
export const TOKEN_ROLES: Record<TokenName, string> = {
  ground: "the page",
  panel: "a raised block: cards, the three doors",
  ink: "body text and headings",
  quiet: "labels and secondary text",
  rule: "hairlines between rows",
  edge: "the border of a control a person can act on",
  accent: "the brand and the action: it is what you press, and the clock",
};

export const TOKENS: Record<Mode, Record<TokenName, string>> = {
  light: {
    ground: "#FEFCF8",
    panel: "#F2EDFF",
    ink: "#120C22",
    quiet: "#494060",
    rule: "#DBD3EF",
    edge: "#786D95",
    accent: "#431BBB",
  },
  dark: {
    ground: "#0B0714",
    panel: "#161028",
    ink: "#F2ECFF",
    quiet: "#ABA1C6",
    rule: "#2B2145",
    edge: "#6E6490",
    accent: "#B79DFF",
  },
};

/**
 * The floors every pair has to clear, and where each number comes from.
 *
 * `DESIGN.md` §7 sets them, and they are stricter than WCAG AA (4.5:1) on
 * purpose: this product asks people to make money decisions from figures on a
 * screen, and AA is the floor for reading, not for that.
 *
 * `rule` is exempt and is the only exemption: a hairline between two rows is
 * decoration, not information, and nothing is lost by a reader who cannot see
 * it. `edge` is NOT exempt — it is the boundary of something a person clicks,
 * which WCAG 1.4.11 puts at 3:1.
 */
export const FLOORS = {
  /** Body text and headings. DESIGN.md §7. */
  ink: 7,
  /** Labels and secondary text. Read as body, so held to the same floor. */
  quiet: 7,
  /** A figure somebody is about to make a money decision on. DESIGN.md §7. */
  accent: 8,
  /** The border of an actionable control. WCAG 1.4.11. */
  edge: 3,
} as const;

/** sRGB relative luminance, per WCAG 2.x. */
function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** The WCAG contrast ratio between two colours, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/** Rounded the way the document writes it, so the two can be compared exactly. */
export function ratioText(a: string, b: string): string {
  return contrastRatio(a, b).toFixed(2);
}
