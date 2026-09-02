import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE GUARDIAN FOR DESIGN.md §3–§6, and like §2's it reads the document.
 *
 * These are rules about WHERE things appear in the source — which token borders
 * a control, whether a focus style exists, whether a number is animated. No type
 * can express any of them, so this greps, and it quotes the document so the rule
 * and its enforcement cannot drift apart.
 *
 * Every one of these caught something real when it was written. That is the bar
 * for adding one: a guard that has never failed is a guard nobody has tested.
 */

const ROOT = process.cwd();
const DESIGN = readFileSync(join(ROOT, "DESIGN.md"), "utf8");
const CSS = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");

function sourceFiles(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "__tests__" ? [] : sourceFiles(full, ext);
    return ext.test(entry) ? [full] : [];
  });
}

const TSX = [...sourceFiles(join(ROOT, "src/app"), /\.tsx$/), ...sourceFiles(join(ROOT, "src/components"), /\.tsx$/)];
const rel = (f: string) => f.replace(ROOT + "/", "");

/**
 * Every interactive element and the classes it carries.
 *
 * **The opening tag is found by tracking brace depth, not by regex**, because
 * `onChange={(event) => ...}` contains a `>` and a lazy match stops there. The
 * first version of this did, reported four controls as having no className at
 * all, and would have been "fixed" by adding classes that were already present.
 */
function controls(): { file: string; tag: string; classes: string }[] {
  const found: { file: string; tag: string; classes: string }[] = [];
  for (const file of TSX) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/<(button|input|select|textarea)\b/g)) {
      let depth = 0;
      let end = m.index! + m[0].length;
      for (; end < text.length; end++) {
        const c = text[end];
        if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) break;
      }
      const tag = text.slice(m.index!, end);
      found.push({ file, tag: m[1], classes: /className="([^"]*)"/.exec(tag)?.[1] ?? "" });
    }
  }
  return found;
}

describe("§3 Typography — three families, and the display face has two doors", () => {
  const LAYOUT = readFileSync(join(ROOT, "src/app/layout.tsx"), "utf8");

  /** `| `Inter` | `--font-sans` | sentences |` */
  function documentedFamilies(): { family: string; variable: string }[] {
    return DESIGN.split("\n")
      .map((line) => /^\|\s*`([\w ]+)`\s*\|\s*`(--font-[a-z]+)`\s*\|/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ family: m[1], variable: m[2] }));
  }

  it("loads exactly the families the document names, under the variables it names", () => {
    // A fourth face is the change nobody argues about, because each one arrives
    // for a single heading that "needed" it.
    const documented = documentedFamilies();
    expect(documented.map((f) => f.variable).sort()).toEqual(["--font-display", "--font-mono", "--font-sans"]);
    for (const { family, variable } of documented) {
      expect(LAYOUT, `${family} imported`).toContain(family.replace(/ /g, "_"));
      expect(LAYOUT, `${family} bound to ${variable}`).toContain(`variable: "${variable}"`);
    }
    const imported = /import\s*\{([^}]+)\}\s*from\s*"next\/font\/google"/.exec(LAYOUT);
    expect(imported, "the google-font import").not.toBeNull();
    expect(imported![1].split(",").map((s) => s.trim()).filter(Boolean)).toHaveLength(documented.length);
  });

  it("the display face reaches type through exactly two rules", () => {
    // DESIGN.md §3: `.display` for the wordmark and every heading, `.pop-action`
    // for the button. A third rule is a change to §3, not a styling choice — the
    // same shape as the accent's two selectors in design-tokens.test.ts.
    const uses = CSS.split("\n").filter((l) => l.includes("var(--font-display)") && !l.includes("--font-display:"));
    expect(uses).toHaveLength(2);
    for (const selector of [".display {", ".pop-action {"]) {
      const block = CSS.slice(CSS.indexOf(selector), CSS.indexOf("}", CSS.indexOf(selector)));
      expect(block, selector).toContain("var(--font-display)");
    }
  });
});

describe("§4 Form — two shapes and no others", () => {
  it("finds the controls at all", () => {
    // The control for every assertion below: a regex that matched nothing would
    // make all of them pass.
    expect(controls().length).toBeGreaterThan(5);
  });

  it("every control carries .control or .control-primary", () => {
    const offenders = controls().filter(
      (c) => !/\bcontrol(-primary|-link)?\b/.test(c.classes),
    );
    expect(offenders.map((c) => `${rel(c.file)} <${c.tag}> "${c.classes}"`)).toEqual([]);
  });

  it("NO control borders with `rule`", () => {
    /**
     * The defect this pass found. Every input and secondary button carried
     * `border-rule` — the 1.50:1 hairline meant for the gaps between rows —
     * under the 3:1 WCAG 1.4.11 asks of a control's boundary. `edge` exists for
     * this and was measured for it.
     */
    const offenders = controls().filter((c) => /\bborder-rule\b/.test(c.classes));
    expect(offenders.map((c) => `${rel(c.file)} <${c.tag}>`)).toEqual([]);
  });

  it("controls do not each invent their own padding", () => {
    // A screen with three button heights reads as three different products.
    const offenders = controls().filter((c) => /\bp[xy]?-\d/.test(c.classes));
    expect(offenders.map((c) => `${rel(c.file)} <${c.tag}> "${c.classes}"`)).toEqual([]);
  });

  it("the stylesheet defines all three shapes, as documented", () => {
    expect(CSS).toMatch(/\.control\s*\{[^}]*border:\s*1px solid var\(--edge\)/);
    expect(CSS).toMatch(/\.control-primary\s*\{[^}]*background:\s*var\(--ink\)/);
    expect(CSS).toMatch(/\.control-link\s*\{[^}]*text-decoration:\s*underline/);
  });

  it("the document lists exactly the shapes the stylesheet defines", () => {
    // The mismatch this caught: the document said two, the source had three.
    const documented = [...DESIGN.matchAll(/^\| `(\.control[\w-]*)` \|/gm)].map((m) => m[1]);
    expect(documented.sort()).toEqual([".control", ".control-link", ".control-primary"]);
  });
});

describe("§4 Form — focus is visible and measured", () => {
  it("a focus-visible style exists", () => {
    // There was none at all before 2026-09-01: the surfaces looked considered
    // and a keyboard user could not tell where they were.
    expect(CSS).toContain(":focus-visible");
  });

  it("the ring is ink with an offset, not the accent", () => {
    const block = CSS.slice(CSS.indexOf(":focus-visible"), CSS.indexOf("}", CSS.indexOf(":focus-visible")));
    expect(block).toContain("outline: 2px solid var(--ink)");
    expect(block).toContain("outline-offset");
    // The most tempting exception to §2's one-job rule, refused.
    expect(block).not.toContain("--accent");
  });

  it("no source file disables an outline", () => {
    const offenders = TSX.filter((f) => /outline-none|outline:\s*none/.test(readFileSync(f, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("the document says why the ring is not the accent", () => {
    const collapsed = DESIGN.replace(/\s+/g, " ");
    expect(collapsed).toContain("The ring is `ink` and not the accent");
  });
});

describe("§5 Layout — two widths, and nothing centred but the page", () => {
  it("pages use only the two documented widths", () => {
    const widths = new Set<string>();
    for (const file of TSX) {
      for (const m of readFileSync(file, "utf8").matchAll(/\bmax-w-(\w+)\b/g)) widths.add(m[1]);
    }
    // `xl` and `full` are inline constraints on prose and images, not page widths.
    expect([...widths].filter((w) => ["2xl", "3xl", "4xl", "5xl", "6xl", "7xl"].includes(w)).sort())
      .toEqual(["2xl", "3xl"]);
  });

  it("no text is centred", () => {
    // A centred column of figures cannot be scanned, and every screen here is
    // ultimately a column of figures. The image placeholder is the exception:
    // it centres two words inside a fixed square, not a column.
    const offenders = TSX.filter(
      (f) => /\btext-center\b/.test(readFileSync(f, "utf8")) && !f.endsWith("AssetImage.tsx"),
    );
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("§6 Motion — almost none, and the exceptions are named", () => {
  it("nothing animates", () => {
    // No skeletons, no shimmer, no spinners on data that is already there.
    const offenders = TSX.filter((f) => /\banimate-\w|@keyframes/.test(readFileSync(f, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("no component declares its own transition", () => {
    // The one transition in the product is defined once, in the stylesheet, on
    // interaction affordances. A component that adds its own is how a number
    // ends up easing toward its value.
    const offenders = TSX.filter((f) => /\btransition\b|\bduration-\d/.test(readFileSync(f, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("the only transitions are the documented two, at the documented durations", () => {
    expect(CSS).toContain("120ms ease-out");
    // DESIGN.md §6: this direction adds `transform` at 90ms, and nothing else.
    // `width`, `height` and `opacity` stay forbidden — those are the ones that
    // read as loading, and a page that fakes loading is lying about a cadence.
    expect(CSS).not.toMatch(/transition:[^;]*\b(width|height|opacity)\b/);
    for (const line of CSS.split("\n").filter((l) => /transition:[^;]*transform/.test(l))) {
      expect(line, "a transform transition must be the documented 90ms").toContain("90ms ease-out");
    }
  });

  it("the transform is limited to the two classes the document names", () => {
    // The rule that keeps "loud" from becoming "casino": a press, and no
    // celebration. Anything else transforming is a new argument to be made.
    const movers = CSS.split("\n")
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /transform:\s*translateY/.test(line))
      .map(({ i }) => CSS.split("\n").slice(0, i).reverse().find((l) => l.trim().startsWith(".")))
      .map((selector) => (selector ?? "").trim().replace(/[{ ].*$/, ""));
    expect([...new Set(movers)].sort()).toEqual([".door:hover", ".pop-action:active", ".pop-action:hover"]);
  });

  it("prefers-reduced-motion is honoured globally", () => {
    expect(CSS).toContain("@media (prefers-reduced-motion: reduce)");
    const block = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toContain("animation-duration: 0.01ms !important");
    expect(block).toContain("transition-duration: 0.01ms !important");
  });
});

describe("nothing regressed to a machine token or a raw timestamp", () => {
  /**
   * The legibility rules, as standing checks rather than a one-time sweep.
   * `docs/design-state-2026-08-31.md` §3 recorded both as defects; they were
   * fixed, and a fix with no guard is a defect with a delay.
   */
  it("no surface renders a raw ISO timestamp", () => {
    // `utcInstant()` drops milliseconds and always says Z. `.toISOString()` in a
    // template is how `2026-08-31T21:55:05.841Z` got onto a page.
    const offenders = TSX.filter((f) => /toISOString\(\)/.test(readFileSync(f, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("no surface titles anything by slug", () => {
    /**
     * A slug is a machine token and belongs in the URL. It is allowed in exactly
     * one place — a small secondary line in the admin queues, where an operator
     * matches a row to a record — and as a fallback when a chain gives no name.
     */
    const offenders: string[] = [];
    for (const file of TSX) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!/\.slug\}/.test(line)) continue;
        if (/href=|slug=\{|text-xs|\?\?\s*raffle\.slug/.test(line)) continue;
        offenders.push(`${rel(file)}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
