import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Progress } from "../Progress";

/**
 * THE PROGRESS RAIL, ASSERTED ON RENDERED HTML.
 *
 * `docs/benchmark-nft.md` list A1 and A4. Two rules, and the second is the one
 * that is easy to lose: **a total we do not know renders an em dash, never a bar
 * at 0%.** "Nothing has been minted" and "we could not ask the chain" are
 * different sentences, and a bar cannot tell them apart — it says the first one
 * either way, which is the more damaging of the two to say wrongly about
 * somebody's collection.
 *
 * Rendered rather than inspected, because the rule is about what reaches a
 * reader — including a reader using a screen reader, which is why the absence of
 * `role="progressbar"` in the unknown case is asserted too: `aria-valuemax={0}`
 * is not a range, and "0 percent" is a number nobody wrote.
 */
const html = (props: Parameters<typeof Progress>[0]) =>
  renderToStaticMarkup(createElement(Progress, props));

describe("a known total renders a rail", () => {
  const markup = html({ done: 70, total: 1111, label: "Minted from Mast", unit: "minted" });

  it("fills the rail to the rounded percentage", () => {
    expect(markup).toContain("width:6%");
  });

  it("shows the percent and the fraction, both tabular", () => {
    expect(markup).toContain("6%");
    expect(markup).toContain("70 / 1111 minted");
    expect(markup.match(/class="figure"/g) ?? []).toHaveLength(2);
  });

  it("announces itself as a progressbar with a real range", () => {
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuemax="1111"');
    expect(markup).toContain('aria-valuenow="70"');
    expect(markup).toContain('aria-valuetext="70 of 1111 minted"');
  });

  it("is 0% at zero done, which is a fact and not an absence", () => {
    const zero = html({ done: 0, total: 1000, label: "Minted", unit: "minted" });
    expect(zero).toContain('role="progressbar"');
    expect(zero).toContain("width:0%");
    expect(zero).toContain("0 / 1000 minted");
  });
});

describe("an unknown total renders an em dash, not a bar", () => {
  const unknown = html({ done: 0, total: 0, label: "Minted from Mast", unit: "minted" });

  it("emits no rail at all", () => {
    expect(unknown).not.toContain("rail");
  });

  it("emits no progressbar role, because zero is not a range", () => {
    expect(unknown).not.toContain("progressbar");
  });

  it("shows the em dash, and says what is unknown for a screen reader", () => {
    expect(unknown).toContain("—");
    expect(unknown).toContain("Minted from Mast unknown");
  });

  it("treats a negative or non-finite total the same way", () => {
    expect(html({ done: 1, total: -5, label: "x", unit: "u" })).toContain("—");
    expect(html({ done: 1, total: Number.NaN, label: "x", unit: "u" })).toContain("—");
  });
});

describe("the two numbers can disagree, and the rail does not hide it", () => {
  /**
   * `done` and `total` come from different places — a candy machine read from
   * the chain and a supply recorded at launch. A bar wider than its track would
   * render as full and look correct, which is the worst way to show a
   * disagreement.
   */
  it("clamps a done that exceeds the total, and reports the clamped figure", () => {
    const over = html({ done: 12, total: 10, label: "Minted", unit: "minted" });
    expect(over).toContain("width:100%");
    expect(over).toContain("10 / 10 minted");
    expect(over).toContain('aria-valuenow="10"');
  });

  it("clamps a negative done rather than inverting the bar", () => {
    expect(html({ done: -3, total: 10, label: "Minted", unit: "minted" })).toContain("width:0%");
  });
});
