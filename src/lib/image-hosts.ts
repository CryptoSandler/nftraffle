/**
 * Hosts a metadata image may be loaded from.
 *
 * **One list, enforced twice, and the duplication is the bug this file
 * prevents.** The browser half is `img-src` in the CSP; the server half is
 * `isAllowedImageHost`, which decides whether to emit a URL at all. Those two
 * must agree, and when the list lived only in `next.config.ts` the server had
 * no way to consult it — so it emitted URLs the browser then refused, and the
 * page showed a broken frame instead of an honest placeholder.
 *
 * **Why an allowlist at all.** Every image here comes from an asset's on-chain
 * metadata, written by whoever minted it. It is attacker-controlled by
 * construction: a hostile collection can point its image anywhere, and loading
 * it leaks every viewer's IP and user-agent to that host. An asset hosted
 * elsewhere renders as a placeholder rather than as a request we did not intend
 * to make.
 *
 * **Our SERVER never fetches an image.** It only decides whether to put a URL in
 * the markup; the browser does the loading, bounded by the CSP. That is why
 * `chain/metadata-fetch.ts`'s bounds — timeout, size cap, no redirects — apply
 * to the metadata DOCUMENT and not to this.
 *
 * WHO CALLS THIS: `next.config.ts` builds the CSP from `IMAGE_HOSTS`;
 * `chain/asset-display.ts` calls `isAllowedImageHost` before rendering.
 */

/**
 * CSP source expressions. Wildcards are the CSP kind, not globs.
 *
 * **A REDIRECTING GATEWAY NEEDS ITS DESTINATION ON THE LIST TOO.** `img-src` is
 * evaluated against every URL in a redirect chain, not just the one in the
 * markup — so allowlisting a host that answers `302` and nothing else is
 * decorative: the browser follows the redirect, hits a host that is not listed,
 * and blocks the image.
 *
 * Observed 2026-09-01 while proving the image path end to end:
 * `gateway.irys.xyz/<id>` answers `302` to
 * `<content-hash>.devnet-1.datasprite-cdn.com/<id>/`, which serves the bytes.
 * With only the gateway listed, a correctly uploaded image rendered as our
 * "no image" placeholder — the failure looked exactly like a missing asset.
 *
 * **This was found by looking at a screenshot, not by a test**, and no test in
 * this repository could have found it: it is a fact about a third party's HTTP
 * behaviour and about a CSP the browser enforces. `curl -sL -w "%{url_effective}"`
 * on one asset is the check, and it is worth re-running before mainnet — the
 * devnet CDN hostname above is unlikely to be the mainnet one.
 */
export const IMAGE_HOSTS = [
  "https://arweave.net",
  "https://*.arweave.net",
  "https://gateway.irys.xyz",
  "https://*.irys.xyz",
  // Where gateway.irys.xyz actually serves from. See the note above.
  "https://*.datasprite-cdn.com",
  "https://ipfs.io",
  "https://*.ipfs.nftstorage.link",
  "https://nftstorage.link",
  "https://cloudflare-ipfs.com",
  "https://shdw-drive.genesysgo.net",
] as const;

/** The same list as hostname matchers, derived so the two cannot drift. */
const HOST_MATCHERS = IMAGE_HOSTS.map((source) => {
  const host = source.replace(/^https:\/\//, "");
  return host.startsWith("*.")
    ? { suffix: `.${host.slice(2)}`, exact: null }
    : { suffix: null, exact: host };
});

/**
 * Whether the browser would be allowed to load this URL.
 *
 * **`https:` only.** The CSP sources are all https, so an `http:` URL would be
 * blocked by the browser anyway — refusing it here means rendering a placeholder
 * instead of a frame that fails.
 *
 * Never throws: this runs on values read from a stranger's metadata document.
 */
export function isAllowedImageHost(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return HOST_MATCHERS.some((m) => (m.exact ? host === m.exact : host.endsWith(m.suffix!)));
}
