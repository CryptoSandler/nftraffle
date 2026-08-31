import { beforeEach, describe, expect, it, vi } from "vitest";
import { assetDisplay, assetDisplays, resetAssetDisplayCache } from "../asset-display";
import * as registry from "../registry";

/**
 * What a person sees for an asset.
 *
 * **The product was illegible without this** — every listing titled a raffle by
 * its slug and rendered the prize as a base58 string
 * (`docs/design-state-2026-08-31.md` §3). The tests are about the FALLBACKS,
 * because those are what a visitor actually meets when a metadata host is slow,
 * an image is on an unlisted host, or a collection never set a name.
 */

function adapterWith(metadata: unknown, display = "#7 · 0xabcd…ef01") {
  return {
    parseAsset: () => ({ raw: "raw", display }),
    assetMetadata: vi.fn().mockResolvedValue(metadata),
  } as never;
}

describe("assetDisplay", () => {
  beforeEach(() => resetAssetDisplayCache());

  it("uses the asset's name and an allowed image", async () => {
    vi.spyOn(registry, "adapterFor").mockReturnValue(
      adapterWith({ name: "GMCards #1", image: "https://arweave.net/pic.png" }),
    );
    expect(await assetDisplay("solana", "raw")).toEqual({
      name: "GMCards #1",
      imageUrl: "https://arweave.net/pic.png",
      reference: "#7 · 0xabcd…ef01",
    });
  });

  it("falls back to the chain reference, NEVER to a slug", async () => {
    // The whole point. A slug is a machine token and belongs in the URL; a
    // truncated address at least identifies the thing.
    vi.spyOn(registry, "adapterFor").mockReturnValue(adapterWith(null));
    const display = await assetDisplay("solana", "raw");
    expect(display.name).toBe("#7 · 0xabcd…ef01");
    expect(display.imageUrl).toBeNull();
  });

  it("falls back when the name is present but blank", async () => {
    vi.spyOn(registry, "adapterFor").mockReturnValue(adapterWith({ name: "   ", image: null }));
    expect((await assetDisplay("solana", "raw")).name).toBe("#7 · 0xabcd…ef01");
  });

  it("drops an image on a host the browser would refuse", async () => {
    // Emitting it would render a broken frame rather than a placeholder — the
    // CSP blocks it and the page looks faulty instead of honest.
    vi.spyOn(registry, "adapterFor").mockReturnValue(
      adapterWith({ name: "X", image: "https://attacker.test/pic.png" }),
    );
    expect((await assetDisplay("solana", "raw")).imageUrl).toBeNull();
  });

  it("does not throw when metadata lookup fails", async () => {
    // A listing page that 500s because one collection's host is down is worse
    // than one with a placeholder in it.
    vi.spyOn(registry, "adapterFor").mockReturnValue({
      parseAsset: () => ({ raw: "raw", display: "ref" }),
      assetMetadata: vi.fn().mockRejectedValue(new Error("host down")),
    } as never);
    expect(await assetDisplay("solana", "raw")).toMatchObject({ name: "ref", imageUrl: null });
  });

  it("falls back when the asset reference itself does not parse", async () => {
    vi.spyOn(registry, "adapterFor").mockReturnValue({
      parseAsset: () => null,
      assetMetadata: vi.fn(),
    } as never);
    expect(await assetDisplay("solana", "garbage")).toEqual({
      name: "garbage",
      imageUrl: null,
      reference: "garbage",
    });
  });

  it("caches, so a listing page does not re-resolve every row", async () => {
    const adapter = adapterWith({ name: "Cached", image: null });
    vi.spyOn(registry, "adapterFor").mockReturnValue(adapter);
    await assetDisplay("solana", "raw");
    await assetDisplay("solana", "raw");
    expect((adapter as unknown as { assetMetadata: { mock: { calls: unknown[] } } }).assetMetadata.mock.calls)
      .toHaveLength(1);
  });
});

describe("assetDisplays", () => {
  beforeEach(() => resetAssetDisplayCache());

  it("resolves each distinct asset once, however many rows name it", async () => {
    // Two raffles for the same collection item is ordinary; two lookups is not.
    const adapter = adapterWith({ name: "Once", image: null });
    vi.spyOn(registry, "adapterFor").mockReturnValue(adapter);
    const map = await assetDisplays([
      { chain: "solana", prizeAsset: "a" },
      { chain: "solana", prizeAsset: "a" },
      { chain: "solana", prizeAsset: "b" },
    ]);
    expect(map.size).toBe(2);
    expect((adapter as unknown as { assetMetadata: { mock: { calls: unknown[] } } }).assetMetadata.mock.calls)
      .toHaveLength(2);
  });

  it("keys by chain AND asset, so two chains cannot collide", async () => {
    vi.spyOn(registry, "adapterFor").mockReturnValue(adapterWith({ name: "N", image: null }));
    const map = await assetDisplays([
      { chain: "solana", prizeAsset: "same" },
      { chain: "robinhood", prizeAsset: "same" },
    ]);
    expect(map.has("solana:same")).toBe(true);
    expect(map.has("robinhood:same")).toBe(true);
  });
});
