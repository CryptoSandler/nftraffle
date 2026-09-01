import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CountdownView } from "../Countdown";
import { remaining } from "../../lib/countdown";

/**
 * THE ACCENT IS RENDERED ONLY WHILE A COUNTDOWN IS STILL RUNNING.
 *
 * `docs/decisions.md` Q19 gave the accent exactly one job — the clock. This is
 * the sharper version of that rule, and it is asserted on the HTML rather than
 * on the intention: a colour meaning "time is running out" must not appear on a
 * raffle where it already has, or it stops meaning that and starts meaning
 * "this row is about time", which is every row.
 *
 * So a closed or drawn raffle emits NO element carrying the accent. The elapsed
 * label is not recoloured; it is not emitted at all. What is left is the status
 * word in the row, in `ink`, and the absolute instant in `quiet` — the half a
 * reader can check.
 *
 * **Rendered, not inspected.** `CountdownView` exists as a separate component
 * precisely so this can run `renderToStaticMarkup` on it: the hook version
 * returns null from its server snapshot, so a server render of it never
 * contains a clock and a test would pass whatever the rule said.
 */

const TARGET = Date.parse("2026-09-01T12:00:00Z");

function html(nowMs: number): string {
  return renderToStaticMarkup(
    createElement(CountdownView, {
      targetMs: TARGET,
      label: "Closes in",
      value: remaining(TARGET, nowMs),
    }),
  );
}

/** Every way the accent can reach the page. */
const ACCENT = /class="[^"]*\bclock\b|--accent|text-accent|bg-accent|border-accent/;

describe("a LIVE countdown carries the accent", () => {
  const live = html(TARGET - 90 * 60_000);

  it("emits the clock element", () => {
    expect(live).toMatch(ACCENT);
  });

  it("shows the remaining time and the label", () => {
    expect(live).toContain("Closes in 1h 30m 00s");
  });

  it("still shows the absolute instant beside it", () => {
    // Both halves, always: one to decide with, one to check against.
    expect(live).toContain("2026-09-01T12:00:00Z");
  });
});

describe("an ELAPSED countdown carries no accent at all", () => {
  const closed = html(TARGET + 5 * 60_000);

  it("emits NO element carrying the accent", () => {
    // The rule, stated as the absence it is.
    expect(closed).not.toMatch(ACCENT);
  });

  it("emits no elapsed label — the word is gone, not recoloured", () => {
    expect(closed).not.toContain("Closes in");
    expect(closed.toLowerCase()).not.toContain("closed");
  });

  it("keeps the absolute instant, which is the half worth keeping", () => {
    expect(closed).toContain("2026-09-01T12:00:00Z");
  });

  it("is elapsed at the target instant itself, not a second later", () => {
    expect(html(TARGET)).not.toMatch(ACCENT);
    expect(html(TARGET - 1)).toMatch(ACCENT);
  });
});

describe("before hydration there is no clock either", () => {
  it("renders only the instant when the browser has not told us the time", () => {
    // The server has no clock: a component that called Date.now() during render
    // would produce markup the client then disagrees with.
    const server = renderToStaticMarkup(
      createElement(CountdownView, { targetMs: TARGET, label: "Closes in", value: null }),
    );
    expect(server).not.toMatch(ACCENT);
    expect(server).toContain("2026-09-01T12:00:00Z");
  });
});
