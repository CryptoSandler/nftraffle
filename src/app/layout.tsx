import type { Metadata } from "next";
import { Archivo_Black, IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";

/**
 * Three families, all through `next/font/google`, with no system stack anywhere:
 * a face that resolves differently per machine is a design that does not exist
 * (DESIGN.md §3).
 *
 * The mono is not decoration. This product is dense with figures that get
 * compared down a column — ticket prices, lamport amounts, basis points, ticket
 * counts, slot numbers, hashes — and proportional digits make that a chore. It
 * is used for EVERY figure without exception, including inside sentences.
 *
 * Inter carries sentences and nothing else. Archivo Black is the display face and
 * reaches type through exactly two CSS rules — `.display`, which the wordmark and
 * every heading carry, and `.pop-action`, which is the button. It never carries a
 * sentence and never carries a figure. DESIGN.md §10 records that the interface
 * stayed plain until the mechanism stopped moving; it stopped on 2026-08-31, the
 * direction was chosen on 2026-09-02, and this is the face that came with it. A
 * THIRD rule using `var(--font-display)` is a change to §3, not a styling choice,
 * and `design-form.test.ts` fails on it.
 */
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

/**
 * The display face, and this direction's argument in one import.
 *
 * A single very heavy weight, used at sizes where it stops being type and
 * becomes a shape. Gumroad's page is built on exactly this move
 * (docs/references-design.md §6) and it is what makes a page read as a product
 * with a personality rather than a dashboard. Used ONLY for the headline, the
 * wordmark and the three doors.
 */
const archivoBlack = Archivo_Black({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "nftraffle",
  /**
   * Deliberately promises nothing this product cannot walk back.
   *
   * No "provably fair", no odds, no claim about legality, no "guaranteed" —
   * DESIGN.md §8.1 makes all four prohibitions normative, and a page
   * description is exactly the kind of copy that gets written once and quoted
   * forever. It says what the mechanism is and stops.
   */
  description:
    "Launch an NFT collection on Solana, and sell it by raffle. Every draw publishes the "
    + "inputs it was computed from.",
  /**
   * Layer 2 of the pre-launch noindex. See `src/app/robots.ts` for why there
   * are three of these and what each one covers; the short version is that this
   * is the only layer that reaches a crawler which fetched the page anyway, and
   * it reaches HTML documents only.
   *
   * `nofollow` alongside `noindex` because the raffle, launch and admin paths
   * are reachable from here, and there is no reason to hand a crawler the map
   * while asking it not to read the destination.
   *
   * Remove this block, `robots.ts`, and the `X-Robots-Tag` header in
   * `next.config.ts` together at launch.
   */
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable} ${archivoBlack.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-ground text-ink">{children}</body>
    </html>
  );
}
