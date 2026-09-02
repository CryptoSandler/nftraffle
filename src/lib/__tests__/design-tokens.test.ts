import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, FLOORS, TOKENS, TOKEN_ROLES, type Mode, type TokenName } from "../design-tokens";

/**
 * THE GUARDIAN FOR THE PALETTE, and it reads the document.
 *
 * `DESIGN.md` §2 is normative. The same hexes exist in three places — that
 * document, `lib/design-tokens.ts`, and `app/globals.css` — because each one is
 * needed where it is: the reasoning belongs in prose, the rendering comes from
 * CSS, and a test can only check values it can import. Three copies is two
 * chances to drift, so this reads all three and fails if any two disagree.
 *
 * **It also recomputes every ratio the document claims.** A contrast table
 * written by hand is a table that is wrong the first time a hex is nudged, and
 * the wrongness is invisible — the numbers still look like numbers. So the
 * document's figures are parsed and checked against `contrastRatio`, not
 * trusted.
 *
 * **And it defends the one rule the whole palette rests on**: the accent is the
 * action and the countdown, and nothing else (docs/decisions.md Q22, which
 * reopened Q19's first answer). That is a rule about where a colour may appear,
 * so the test greps the source for where it appears.
 */

const DESIGN = readFileSync(join(process.cwd(), "DESIGN.md"), "utf8");
const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const NAMES: TokenName[] = ["ground", "panel", "ink", "quiet", "rule", "edge", "accent"];

/** `| `ink` | `#101413` | `#E9EEED` | body text and headings |` */
function documentedTokens(): Record<TokenName, { light: string; dark: string; role: string }> {
  const out = {} as Record<TokenName, { light: string; dark: string; role: string }>;
  for (const line of DESIGN.split("\n")) {
    const m = /^\|\s*`(\w+)`\s*\|\s*`(#[0-9A-Fa-f]{6})`\s*\|\s*`(#[0-9A-Fa-f]{6})`\s*\|\s*([^|]+?)\s*\|$/.exec(line);
    if (m && (NAMES as string[]).includes(m[1])) {
      out[m[1] as TokenName] = { light: m[2], dark: m[3], role: m[4] };
    }
  }
  return out;
}

describe("DESIGN.md §2 and the code say the same thing", () => {
  it("documents every token, and no others", () => {
    // A token in the code but not the document is a colour with no argument
    // behind it; one in the document but not the code is a promise nothing keeps.
    expect(Object.keys(documentedTokens()).sort()).toEqual([...NAMES].sort());
  });

  it("agrees on every hex, in both modes", () => {
    const documented = documentedTokens();
    for (const name of NAMES) {
      expect(documented[name].light.toUpperCase(), `${name} light`).toBe(TOKENS.light[name]);
      expect(documented[name].dark.toUpperCase(), `${name} dark`).toBe(TOKENS.dark[name]);
    }
  });

  it("agrees on what each token is FOR", () => {
    // The role is the part that stops a token being reused for something it was
    // never measured against.
    const documented = documentedTokens();
    for (const name of NAMES) {
      expect(documented[name].role, name).toBe(TOKEN_ROLES[name]);
    }
  });

  it("the stylesheet carries the same values, in both modes", () => {
    // The third copy, and the only one that actually paints anything.
    const light = CSS.slice(0, CSS.indexOf("@media (prefers-color-scheme: dark)"));
    const dark = CSS.slice(CSS.indexOf("@media (prefers-color-scheme: dark)"));
    for (const name of NAMES) {
      expect(light, `${name} light in CSS`).toContain(`--${name}: ${TOKENS.light[name]};`);
      expect(dark, `${name} dark in CSS`).toContain(`--${name}: ${TOKENS.dark[name]};`);
    }
  });
});

describe("the measured contrast table is measured, not asserted", () => {
  /** `| light | `ink` | 17.90 | 16.77 | 7:1 | AA AAA |` */
  const rows = DESIGN.split("\n")
    .map((line) => /^\|\s*(light|dark)\s*\|\s*`(\w+)`\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*(\d+):1\s*\|/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null);

  it("has a row for every token that carries meaning", () => {
    // `rule` is exempt and is the only exemption: a hairline is decoration.
    expect(rows).toHaveLength(8);
    for (const mode of ["light", "dark"]) {
      for (const token of ["ink", "quiet", "accent", "edge"]) {
        expect(rows.some((r) => r[1] === mode && r[2] === token), `${mode} ${token}`).toBe(true);
      }
    }
  });

  it("every published figure recomputes to the same number", () => {
    // The failure this catches: somebody nudges a hex and the table still reads
    // like a table. Wrong numbers look exactly like right ones.
    for (const [, mode, token, onGround, onPanel] of rows) {
      const T = TOKENS[mode as Mode];
      expect(contrastRatio(T[token as TokenName], T.ground).toFixed(2), `${mode} ${token} on ground`).toBe(onGround);
      expect(contrastRatio(T[token as TokenName], T.panel).toFixed(2), `${mode} ${token} on panel`).toBe(onPanel);
    }
  });

  it("every pair clears its floor on ground AND on panel", () => {
    for (const mode of ["light", "dark"] as const) {
      const T = TOKENS[mode];
      for (const [token, floor] of Object.entries(FLOORS)) {
        for (const surface of ["ground", "panel"] as const) {
          const ratio = contrastRatio(T[token as TokenName], T[surface]);
          expect(ratio, `${mode} ${token} on ${surface} (${ratio.toFixed(2)})`).toBeGreaterThanOrEqual(floor);
        }
      }
    }
  });

  it("the floors are stricter than WCAG AA, which is the point", () => {
    // AA is 4.5:1 and is a floor for reading. This product asks people to make
    // money decisions from figures on a screen.
    expect(FLOORS.ink).toBeGreaterThan(4.5);
    expect(FLOORS.accent).toBeGreaterThan(FLOORS.ink);
  });

  it("the document says the floors are deliberate, not inherited", () => {
    // The sentence, not the number: a floor with no argument behind it is one
    // somebody lowers when a colour will not fit.
    const collapsed = DESIGN.replace(/\s+/g, " ");
    expect(collapsed).toContain("stricter than WCAG AA on purpose");
  });
});

describe("the accent is the action and the clock, and nothing else", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return entry === "__tests__" ? [] : sourceFiles(full);
      return /\.(ts|tsx|css)$/.test(entry) ? [full] : [];
    });
  }

  const sources = sourceFiles(join(process.cwd(), "src")).filter(
    (f) => !f.endsWith("design-tokens.ts") && !f.endsWith("globals.css"),
  );

  function code(file: string): string {
    return readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*)/.test(line))
      .join("\n");
  }

  /**
   * **THIS RULE REPLACED Q19's FIRST ANSWER, AND THE REPLACEMENT WAS DECIDED.**
   *
   * `docs/decisions.md` Q19 gave the accent one job — the clock — and accepted
   * a black-on-white primary action as the price. Popmint took the opposite
   * bet: **one loud colour is the brand and the thing you press**, which is
   * what makes Gumroad's page look like a product rather than a dashboard.
   *
   * The owner chose this direction on 2026-09-02 and reopened Q19 to say so
   * (Q22), rather than letting the direction override a recorded decision
   * quietly. Q19's SECOND answer — zero casino — was not reopened and did not
   * move.
   *
   * The rule that replaced it is still a rule, and still enforced here: the
   * accent is `.pop-action` and `.clock`. It is not a heading, not body text,
   * not a border, not a state. A third selector needs a Q23, not an edit.
   */
  it("appears nowhere in the source except through .clock and .pop-action", () => {
    const offenders = sources.filter((file) =>
      /--accent|text-accent|bg-accent|border-accent/.test(code(file)),
    );
    expect(offenders.map((f) => f.replace(process.cwd() + "/", ""))).toEqual([]);
  });

  it("globals.css uses --accent only in .clock and .pop-action", () => {
    const uses = CSS.split("\n").filter((l) => l.includes("var(--accent)"));
    expect(uses).toHaveLength(2);
    for (const selector of [".clock {", ".pop-action {"]) {
      const block = CSS.slice(CSS.indexOf(selector), CSS.indexOf("}", CSS.indexOf(selector)));
      expect(block, selector).toContain("var(--accent)");
    }
  });

  it("nothing quiets text with opacity or a filter", () => {
    // Compositing turns a measured contrast into an unmeasured one, and every
    // ratio in DESIGN.md §2 would stop meaning anything.
    const offenders = sources.filter((file) =>
      /\b(opacity-[0-9]|text-opacity-|\bfilter:\s*(?!none))/.test(code(file)),
    );
    expect(offenders.map((f) => f.replace(process.cwd() + "/", ""))).toEqual([]);
  });
});
