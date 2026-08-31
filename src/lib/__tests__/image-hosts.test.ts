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

  it("every entry on the list is https and parses", () => {
    // The control: a malformed source expression would silently allow nothing
    // and every image would become a placeholder.
    for (const source of IMAGE_HOSTS) {
      expect(source.startsWith("https://"), source).toBe(true);
      expect(() => new URL(source.replace("*.", "wildcard.")), source).not.toThrow();
    }
  });
});
