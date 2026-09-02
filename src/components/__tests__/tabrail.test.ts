import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * THE BOTTOM RAIL MARKS THE DOOR YOU ARE BEHIND, AND NOTHING ELSE.
 *
 * `docs/benchmark-nft.md` list A6. This test exists because the first version of
 * the rail was wrong in a way no other guard could see: it derived "current"
 * from each link's own href, and Mint points at `/`. So the **home page marked
 * Mint as current** — and the home is not a door, it is where the doors are.
 *
 * It was caught by opening a screenshot, which is the slowest instrument this
 * project has. Hence this one.
 *
 * The rule stated as an absence: **nothing is current on the home page.** A rail
 * that always highlights something teaches a reader that the highlight means
 * nothing.
 */
let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const { TabRail } = await import("../TabRail");

function at(path: string): string {
  pathname = path;
  return renderToStaticMarkup(createElement(TabRail));
}

/** `aria-current="page"` is the only way the rail says "here". */
const currents = (html: string) =>
  [...html.matchAll(/aria-current="page"[\s\S]{0,220}?<\/a>/g)].map((m) =>
    (m[0].match(/>([A-Za-z]+)<\/span><\/a>/) ?? [])[1],
  );

describe("the rail marks exactly one door, and only when behind one", () => {
  it("marks nothing on the home page", () => {
    expect(currents(at("/"))).toEqual([]);
  });

  it("marks Launch on the launch form", () => {
    expect(currents(at("/launch"))).toEqual(["Launch"]);
  });

  it("marks Mint on a collection page", () => {
    expect(currents(at("/c/solana/field-studies-mtjkwv2g"))).toEqual(["Mint"]);
  });

  it("marks Raffle on the listing form AND on a raffle's own page", () => {
    expect(currents(at("/raffle/new"))).toEqual(["Raffle"]);
    expect(currents(at("/r/pzadxphh-mtjkzdrp"))).toEqual(["Raffle"]);
  });

  it("never marks two doors at once", () => {
    for (const path of ["/", "/launch", "/c/solana/x", "/raffle/new", "/r/abc", "/admin"]) {
      expect(currents(at(path)).length, path).toBeLessThanOrEqual(1);
    }
  });
});

describe("the rail is the three doors, under the doors' names", () => {
  it("renders exactly three, in the doors' order", () => {
    const html = at("/");
    expect(html.match(/>(Launch|Mint|Raffle)</g)).toEqual([">Launch<", ">Mint<", ">Raffle<"]);
  });

  it("is hidden on anything wider than a phone", () => {
    // On a desktop the doors are on the page; a bar repeating them is chrome.
    expect(at("/")).toContain("sm:hidden");
  });
});
