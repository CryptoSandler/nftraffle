import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

/**
 * Full-page screenshots at an EXACT viewport width.
 *
 * **Why this exists, measured 2026-09-02.** `--screenshot --window-size=390,…`
 * produces a 390-pixel-wide PNG and a 500-pixel-wide LAYOUT: Chrome floors a
 * window at 500 on macOS, so the image is the left 390px of a wider page. Every
 * element looked clipped down its right edge and the page looked broken at
 * mobile. It was not — the instrument was. The page reported
 * `SCROLLW=500 CLIENTW=500` when asked, which is how it was caught.
 *
 * So the viewport is set through the DevTools protocol —
 * `Emulation.setDeviceMetricsOverride` — which is not bounded by a window, and
 * the screenshot is taken with `captureBeyondViewport` so the whole page comes
 * back rather than one fold.
 *
 * No dependency: Node's built-in `WebSocket` speaks CDP.
 *
 *   npx tsx scripts/screenshot.mts <url> <out.png> <width> [height]
 *
 * WHO CALLS THIS: whoever is capturing design evidence. Nothing in `src/`.
 */

const [url, out, widthArg, heightArg] = process.argv.slice(2);
if (!url || !out || !widthArg) {
  console.error("usage: screenshot.mts <url> <out.png> <width> [height]");
  process.exit(2);
}
const width = Number(widthArg);
const height = Number(heightArg ?? 900);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9222 + Math.floor(Math.random() * 400);

const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  `--remote-debugging-port=${port}`,
  "--user-data-dir=" + `/tmp/chrome-shot-${port}`,
  "about:blank",
]);

async function target(): Promise<string> {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
      const j = (await r.json()) as { webSocketDebuggerUrl: string };
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting. The loop is the wait.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("chrome did not open a debugging port");
}

const ws = new WebSocket(await target());
await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));

let id = 0;
const pending = new Map<number, (value: Record<string, unknown>) => void>();
ws.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data)) as { id?: number; result?: Record<string, unknown> };
  if (message.id && pending.has(message.id)) pending.get(message.id)!(message.result ?? {});
});
function send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const messageId = ++id;
  ws.send(JSON.stringify({ id: messageId, method, params }));
  return new Promise((resolve) => pending.set(messageId, resolve));
}

await send("Page.enable");
// `mobile: true` so media queries and the viewport meta behave the way a phone
// does, not the way a narrow desktop window does.
await send("Emulation.setDeviceMetricsOverride", {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: width < 700,
});
/**
 * The colour scheme is FORCED when asked, because the default is the machine's.
 *
 * A capture that inherits whatever the laptop is set to is a capture nobody can
 * compare: two shots of the same page, taken an hour apart, can differ by a
 * system setting rather than by a change. `SCHEME=light` or `SCHEME=dark`.
 */
const scheme = process.env.SCHEME;
if (scheme) {
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: scheme }],
  });
}

await send("Page.navigate", { url });
// Long enough for the art to arrive from a CDN. A capture taken before the
// images land shows empty frames and reads as a layout bug: the first 390
// capture of the toy direction had four blank tiles for exactly this reason.
await new Promise((r) => setTimeout(r, Number(process.env.WAIT ?? 6500)));

const metrics = (await send("Runtime.evaluate", {
  expression: "JSON.stringify({ w: document.documentElement.clientWidth, s: document.documentElement.scrollWidth })",
  returnByValue: true,
})) as { result?: { value?: string } };
const measured = JSON.parse(metrics.result?.value ?? "{}") as { w: number; s: number };
console.log(`viewport ${measured.w}px, page ${measured.s}px${measured.s > measured.w ? "  <-- OVERFLOW" : ""}`);

const shot = (await send("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: true,
})) as { data?: string };
writeFileSync(out, Buffer.from(shot.data ?? "", "base64"));
console.log(`${out}  ${width}px${scheme ? `  ${scheme}` : ""}`);

ws.close();
chrome.kill();
process.exit(0);
