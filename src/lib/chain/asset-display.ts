/**
 * What a person sees for an asset: its name, and its picture.
 *
 * **This exists because the product was illegible without it.** Every listing
 * surface titled a raffle by its slug — `bx42aeje-mthrgkq9` — and rendered the
 * prize as a 44-character base58 string. A visitor could not tell what was being
 * raffled without pasting it into an explorer
 * (`docs/design-state-2026-08-31.md` §3). The adapters have returned a name and
 * an image for both chains since the Robinhood surface opened; nothing consumed
 * either.
 *
 * **One module, so the fallbacks cannot disagree.** The rule everywhere is: the
 * asset's name if the chain gave one, otherwise the adapter's short display form
 * (`#1234 · 0xabcd…ef01`), and never the slug. A page that invented its own
 * fallback would be a page where the same asset is called two things.
 *
 * WHO CALLS THIS: `src/app/page.tsx`, `src/app/r/[slug]/page.tsx`,
 * `src/app/c/[chain]/[slug]/page.tsx`.
 */

import { adapterFor } from "./registry";
import type { ChainId } from "./adapter";
import { isAllowedImageHost } from "../image-hosts";

export type AssetDisplay = {
  /** Never empty, and never the slug. */
  name: string;
  /** Only ever a URL the browser is allowed to load. Null renders a placeholder. */
  imageUrl: string | null;
  /** The short chain-native reference, for the row of facts. */
  reference: string;
};

/**
 * How long a resolved name and image are reused.
 *
 * **A listing page resolves one asset per row, and each resolution is at least
 * one network call** — a DAS lookup on Solana, an `eth_call` plus a metadata
 * fetch on Robinhood. Without this, rendering the home page twice in a second
 * makes the same dozen calls twice.
 *
 * Five minutes because the underlying facts barely move: an asset's name never
 * changes, and its image changes only if the metadata is mutable and somebody
 * edits it. The one field that DOES move — the owner — is deliberately not
 * cached here; `assetOwner` is read fresh wherever a decision depends on it, and
 * nothing in this module is used for a decision.
 *
 * // ponytail: in-process map, so it is per-instance and lost on a cold start.
 * // If listing pages get slow across many instances, this wants a shared cache
 * // rather than a longer TTL.
 */
const TTL_MS = 5 * 60_000;

const cache = new Map<string, { at: number; value: AssetDisplay }>();

/** Bounds the map rather than letting it grow with every asset ever viewed. */
function prune(now: number): void {
  if (cache.size < 500) return;
  for (const [key, entry] of cache) if (now - entry.at >= TTL_MS) cache.delete(key);
}

/**
 * The name and image for one asset, or an honest fallback.
 *
 * **Never throws and never returns an empty name.** It runs during a page
 * render, on a value read from a stranger's metadata, and a listing page that
 * 500s because one collection's host is down is worse than a listing page with
 * one placeholder in it.
 */
export async function assetDisplay(chain: ChainId, raw: string): Promise<AssetDisplay> {
  const adapter = adapterFor(chain);
  const parsed = adapter.parseAsset(raw);
  // The stored reference is the last resort, and it is still better than a slug.
  const reference = parsed?.display ?? raw;

  const key = `${chain}:${raw}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value;

  let value: AssetDisplay = { name: reference, imageUrl: null, reference };
  if (parsed) {
    try {
      const metadata = await adapter.assetMetadata(parsed);
      const name = metadata?.name?.trim();
      const image = metadata?.image?.trim();
      value = {
        name: name && name.length > 0 ? name : reference,
        // Checked against the same list the CSP enforces, so we never emit a
        // URL the browser will refuse — a blocked image is a broken frame, and a
        // placeholder is an honest one.
        imageUrl: image && isAllowedImageHost(image) ? image : null,
        reference,
      };
    } catch {
      // A metadata host that is down must not take a listing page with it.
      console.warn(`assetDisplay: could not resolve metadata for ${chain}`);
    }
  }

  prune(now);
  cache.set(key, { at: now, value });
  return value;
}

/**
 * Resolves a page's worth of assets at once.
 *
 * **In parallel, deliberately.** A listing page resolving ten assets in series
 * is ten round trips deep; in parallel it is one round trip wide. Nothing here
 * depends on anything else here.
 */
export async function assetDisplays(
  assets: readonly { chain: ChainId; prizeAsset: string }[],
): Promise<Map<string, AssetDisplay>> {
  const unique = new Map<string, { chain: ChainId; raw: string }>();
  for (const a of assets) unique.set(`${a.chain}:${a.prizeAsset}`, { chain: a.chain, raw: a.prizeAsset });

  const resolved = await Promise.all(
    [...unique.values()].map(async (a) => [`${a.chain}:${a.raw}`, await assetDisplay(a.chain, a.raw)] as const),
  );
  return new Map(resolved);
}

/** Test seam. Nothing in the application calls this. */
export function resetAssetDisplayCache(): void {
  cache.clear();
}
