import { describe, expect, it } from "vitest";
import { LAUNCH_LIMITS, checkLaunchChoices } from "../limits";

/**
 * What a creator may ask for, decided on the server.
 *
 * **"Self-serve" is not "unbounded"** (spec §5.3). The browser refuses these
 * too, and that refusal is a courtesy: this is the one that counts, because the
 * browser is the half an attacker writes.
 */

const NOW = Date.parse("2026-09-02T12:00:00Z");

function choices(over: Partial<Parameters<typeof checkLaunchChoices>[0]> = {}) {
  return checkLaunchChoices({
    name: "A collection",
    symbol: "COLL",
    uri: "https://gateway.irys.xyz/9hoWXMvFPBYrLiwovEkHrL7d1854fPTHpdqguRQxYQTM",
    itemsAvailable: 100,
    priceLamports: 50_000_000n,
    mintLimit: 5,
    startsAtMs: NOW + 60_000,
    nowMs: NOW,
    ...over,
  });
}

describe("the caps a launch is held to", () => {
  it("accepts an ordinary launch", () => {
    expect(choices().ok).toBe(true);
  });

  it("refuses more items than the cap", () => {
    const verdict = choices({ itemsAvailable: LAUNCH_LIMITS.maxItems + 1 });
    expect(verdict).toMatchObject({ ok: false, reason: "too_many_items" });
  });

  it("refuses a supply of nothing", () => {
    expect(choices({ itemsAvailable: 0 })).toMatchObject({ ok: false, reason: "too_few_items" });
  });

  it("refuses a per-wallet limit outside 1..255", () => {
    // The guard stores it in a u8. A limit of 256 is not a big limit, it is a
    // number that does not fit, and the program would have taken 0.
    expect(choices({ mintLimit: 0 })).toMatchObject({ ok: false, reason: "bad_mint_limit" });
    expect(choices({ mintLimit: 256 })).toMatchObject({ ok: false, reason: "bad_mint_limit" });
  });

  it("refuses a start in the past", () => {
    expect(choices({ startsAtMs: NOW - 1 })).toMatchObject({ ok: false, reason: "starts_in_past" });
  });

  it("refuses a start further out than the cap", () => {
    const tooFar = NOW + (LAUNCH_LIMITS.maxStartDays * 24 * 60 * 60 * 1000) + 1;
    expect(choices({ startsAtMs: tooFar })).toMatchObject({ ok: false, reason: "starts_too_late" });
  });

  it("refuses a URI that is not one of the hosts this project will render", () => {
    // The mint page shows the art. A URI nobody can render is a launch that
    // produces blank cards, and `lib/image-hosts.ts` is the list that decides.
    expect(choices({ uri: "https://example.com/metadata.json" })).toMatchObject({
      ok: false,
      reason: "bad_uri",
    });
  });

  it("refuses an empty name or symbol, and one that is too long", () => {
    expect(choices({ name: "  " })).toMatchObject({ ok: false, reason: "bad_name" });
    expect(choices({ symbol: "" })).toMatchObject({ ok: false, reason: "bad_symbol" });
    expect(choices({ symbol: "TOOLONGSYMBOL" })).toMatchObject({ ok: false, reason: "bad_symbol" });
  });

  it("refuses a price that would overflow the guard", () => {
    expect(choices({ priceLamports: -1n })).toMatchObject({ ok: false, reason: "bad_price" });
  });

  it("allows a free mint, because zero is a price", () => {
    expect(choices({ priceLamports: 0n }).ok).toBe(true);
  });
});
