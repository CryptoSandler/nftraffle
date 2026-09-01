import { describe, expect, it } from "vitest";
import { IMAGE_HOSTS, isAllowedImageHost } from "../image-hosts";

/**
 * The image allowlist, enforced in two places that must agree.
 *
 * The browser half is the CSP's `img-src`; the server half decides whether to
 * emit a URL at all. When the list lived only in `next.config.ts` the server
 * could not consult it, so it emitted URLs the browser refused — and the page
 * showed a broken frame where an honest placeholder belonged.
 */

describe("isAllowedImageHost", () => {
  it("allows the exact hosts on the list", () => {
    expect(isAllowedImageHost("https://arweave.net/abc")).toBe(true);
    expect(isAllowedImageHost("https://ipfs.io/ipfs/bafy/1.png")).toBe(true);
    expect(isAllowedImageHost("https://shdw-drive.genesysgo.net/x/y.png")).toBe(true);
  });

  it("allows a subdomain only where the list has a wildcard", () => {
    expect(isAllowedImageHost("https://foo.arweave.net/x")).toBe(true);
    expect(isAllowedImageHost("https://bafy.ipfs.nftstorage.link/1.png")).toBe(true);
    // `https://ipfs.io` has no wildcard, so a subdomain is not covered.
    expect(isAllowedImageHost("https://evil.ipfs.io.attacker.test/x")).toBe(false);
  });

  it("REFUSES a host that merely ends with a listed name", () => {
    // The suffix trap: `notarweave.net` ends with `arweave.net` as a string.
    // Matching must be on a dot boundary or an attacker registers the difference.
    expect(isAllowedImageHost("https://notarweave.net/x")).toBe(false);
    expect(isAllowedImageHost("https://arweave.net.attacker.test/x")).toBe(false);
  });

  it("REFUSES http, which the CSP would block anyway", () => {
    // Refusing here renders a placeholder instead of a frame that fails.
    expect(isAllowedImageHost("http://arweave.net/x")).toBe(false);
  });

  it("REFUSES anything that is not a URL, without throwing", () => {
    // These come from a stranger's metadata document.
    for (const v of ["", "not a url", "javascript:alert(1)", "//arweave.net/x", "data:image/png;base64,AA"]) {
      expect(isAllowedImageHost(v), v).toBe(false);
    }
  });

  it("keeps the host a listed gateway REDIRECTS to", () => {
    /**
     * THE BUG THIS GUARDS, found by looking at a screenshot rather than by any
     * test here.
     *
     * `img-src` is evaluated against every URL in a redirect chain, not only the
     * one in the markup. `gateway.irys.xyz/<id>` answers `302` to a
     * `*.datasprite-cdn.com` host that serves the bytes — so with only the
     * gateway listed, a correctly uploaded image was blocked by the browser and
     * rendered as our "no image" placeholder. The failure was indistinguishable
     * from a missing asset, which is why it survived a green suite.
     *
     * No test in this repository could have caught it: it is a fact about a
     * third party's HTTP behaviour. What a test CAN do is stop somebody tidying
     * the entry away as an unexplained extra, so this asserts it is there and
     * the comment on the list says why.
     */
    expect(isAllowedImageHost("https://abc123.devnet-1.datasprite-cdn.com/xyz/")).toBe(true);
    expect(IMAGE_HOSTS).toContain("https://*.datasprite-cdn.com");
  });

  it("every entry on the list is https and parses", () => {
    // The control: a malformed source expression would silently allow nothing
    // and every image would become a placeholder.
    for (const source of IMAGE_HOSTS) {
      expect(source.startsWith("https://"), source).toBe(true);
      expect(() => new URL(source.replace("*.", "wildcard.")), source).not.toThrow();
    }
  });
});
