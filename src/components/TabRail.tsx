"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The three doors, at the thumb. Mobile only.
 *
 * `docs/benchmark-nft.md` list A6, from Zora and Tensor: both put navigation in a
 * bottom rail on a phone and neither hides the create action in a hamburger. The
 * owner approved it as a navigation change rather than a styling one, which is
 * what it is — it makes **launch** a permanent target on every screen.
 *
 * **Three items, in the doors' order, and named the way the doors are named**
 * (list A10). Zora puts create in the middle; this does not, because the doors
 * are already this product's vocabulary and a rail that reorders them teaches a
 * second one. Launch is leftmost and reachable, which was the point of the
 * pattern.
 *
 * **`sm:hidden`**, because on a desktop the doors are on the page and a bar that
 * repeats what is already visible is chrome.
 *
 * It is a client component for exactly one reason: `usePathname`, so the current
 * door is marked. A rail with no current state is a rail a person has to read
 * every time.
 *
 * WHO CALLS THIS: `src/app/layout.tsx`, once, for every page.
 */
/**
 * **`match` is not `startsWith(href)`, and the difference was a real defect.**
 *
 * The first version derived "current" from the link's own href. Mint points at
 * `/`, which is the index of what can be minted rather than a mint page — so the
 * home page marked Mint as the current door, and the home is not a door. It is
 * where the three doors are.
 *
 * So each item says separately where it GOES and what it is CURRENT FOR. Nothing
 * is current on the home page, which is correct: a rail that always highlights
 * something teaches a person that the highlight means nothing.
 */
const DOORS = [
  { href: "/launch", name: "Launch", glyph: "◆", match: (p: string) => p.startsWith("/launch") },
  { href: "/", name: "Mint", glyph: "●", match: (p: string) => p.startsWith("/c/") },
  {
    href: "/raffle/new",
    name: "Raffle",
    glyph: "▲",
    // Both the listing form and a raffle's own page: `/r/<slug>` is a raffle,
    // and a rail that went blank there would be wrong in the opposite direction.
    match: (p: string) => p.startsWith("/raffle") || p.startsWith("/r/"),
  },
] as const;

export function TabRail() {
  const pathname = usePathname();

  return (
    <nav className="tabrail fixed inset-x-0 bottom-0 z-20 sm:hidden" aria-label="Main">
      <ul className="mx-auto flex max-w-3xl">
        {DOORS.map((door) => {
          const current = door.match(pathname);
          return (
            <li key={door.href} className="flex-1">
              <Link
                className="flex flex-col items-center justify-center gap-0.5 py-2"
                href={door.href}
                /*
                 * `aria-current` rather than colour alone. DESIGN.md §9: a state
                 * a person cannot see is a state that has to be announced, and
                 * the accent is not available to mark this one (Q22).
                 */
                aria-current={current ? "page" : undefined}
              >
                <span aria-hidden="true">{door.glyph}</span>
                <span className={current ? "text-xs text-ink" : "text-xs text-quiet"}>
                  {door.name}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
