import { describe, expect, it } from "vitest";
import { readMetadataDocument, resolveTokenUri } from "../metadata-fetch";
import { decodeAbiString } from "../robinhood/metadata";

/**
 * The bounds on fetching somebody else's URL.
 *
 * **`tokenURI` is attacker-controlled by definition** — whoever deployed the
 * ERC-721 chose the string — and this code runs on a server that can reach a
 * cloud metadata endpoint, a private subnet and localhost. So the tests that
 * matter here are the refusals, and they are written as "this specific attack
 * is refused" rather than as "the validator works".
 */

describe("resolveTokenUri — what may be fetched at all", () => {
  it("accepts an ordinary https URL", () => {
    expect(resolveTokenUri("https://example.com/token/1.json")).toEqual({
      ok: true,
      url: "https://example.com/token/1.json",
    });
  });

  it("resolves ipfs:// through a gateway rather than as a protocol", () => {
    // Content-addressed, so a gateway cannot substitute different bytes without
    // changing the CID. It can refuse to serve, which degrades to no image.
    const r = resolveTokenUri("ipfs://bafyfake123/meta.json");
    expect(r).toMatchObject({ ok: true });
    expect((r as { url: string }).url).toBe("https://ipfs.io/ipfs/bafyfake123/meta.json");
  });

  it("REFUSES http://, which is where the interesting SSRF targets live", () => {
    // Plaintext means anyone on the path picks what we render, and link-local,
    // loopback and private ranges all speak it. Refusing the scheme removes the
    // class before the host is examined.
    expect(resolveTokenUri("http://example.com/1.json")).toEqual({
      ok: false,
      reason: "scheme_not_allowed",
    });
  });

  it("REFUSES file:// and other schemes outright", () => {
    for (const uri of ["file:///etc/passwd", "ftp://host/x", "gopher://host/x", "javascript:1"]) {
      expect(resolveTokenUri(uri), uri).toMatchObject({ ok: false });
    }
  });

  it("REFUSES the cloud metadata endpoint", () => {
    // 169.254.169.254 over https is unusual and not impossible, and it is the
    // single highest-value SSRF target on a cloud host.
    expect(resolveTokenUri("https://169.254.169.254/latest/meta-data/")).toEqual({
      ok: false,
      reason: "host_not_allowed",
    });
  });

  it("REFUSES loopback, private and link-local hosts", () => {
    const hosts = [
      "https://localhost/x.json",
      "https://127.0.0.1/x.json",
      "https://10.0.0.5/x.json",
      "https://192.168.1.9/x.json",
      "https://172.16.4.1/x.json",
      "https://[::1]/x.json",
      "https://[fd00::1]/x.json",
      "https://something.local/x.json",
    ];
    for (const h of hosts) {
      expect(resolveTokenUri(h), h).toMatchObject({ ok: false, reason: "host_not_allowed" });
    }
  });

  it("allows a public IP that merely starts with a private-looking octet", () => {
    // The control for the test above. A check that refuses everything would
    // pass every refusal test and break every real collection.
    expect(resolveTokenUri("https://172.32.0.1/x.json")).toMatchObject({ ok: true });
    expect(resolveTokenUri("https://11.0.0.1/x.json")).toMatchObject({ ok: true });
  });

  it("REFUSES credentials embedded in the URL", () => {
    // Would be sent to the host on our behalf, and are never legitimate here.
    expect(resolveTokenUri("https://user:pass@example.com/x.json")).toMatchObject({ ok: false });
  });

  it("REFUSES an absurdly long URI without parsing it", () => {
    expect(resolveTokenUri("https://example.com/" + "a".repeat(4_000))).toEqual({
      ok: false,
      reason: "bad_uri",
    });
  });
});

describe("readMetadataDocument — only three fields ever leave the document", () => {
  it("takes name, image and collection and discards everything else", () => {
    const doc = readMetadataDocument({
      name: "Prize #1",
      image: "https://example.com/1.png",
      collection: "Fakes",
      description: "ignored",
      attributes: [{ trait_type: "x", value: "y" }],
      __proto__: { polluted: true },
    });
    expect(doc).toEqual({ name: "Prize #1", image: "https://example.com/1.png", collection: "Fakes" });
  });

  it("nulls a non-string rather than coercing it", () => {
    // `image: {}` rendering as "[object Object]" is the small version of
    // letting an attacker's document reach a template.
    expect(readMetadataDocument({ name: {}, image: 12, collection: [] })).toEqual({
      name: null,
      image: null,
      collection: null,
    });
  });

  it("survives a document that is not an object at all", () => {
    for (const v of [null, "string", 7, []]) {
      expect(readMetadataDocument(v)).toEqual({ name: null, image: null, collection: null });
    }
  });

  it("truncates rather than rendering an unbounded name", () => {
    expect(readMetadataDocument({ name: "x".repeat(5_000) }).name).toHaveLength(200);
  });
});

describe("decodeAbiString — a contract's return value is not trusted either", () => {
  function encode(value: string): string {
    const bytes = Buffer.from(value, "utf8");
    const len = bytes.length.toString(16).padStart(64, "0");
    const data = bytes.toString("hex").padEnd(Math.ceil(bytes.length / 32) * 64, "0");
    return "0x" + (32).toString(16).padStart(64, "0") + len + data;
  }

  it("decodes an ordinary tokenURI", () => {
    expect(decodeAbiString(encode("ipfs://bafyfake/1.json"))).toBe("ipfs://bafyfake/1.json");
  });

  it("REFUSES a length field that claims more than the payload holds", () => {
    // A decoder that trusts the length allocates on an attacker's word.
    const huge = "0x" + (32).toString(16).padStart(64, "0") + "f".repeat(64) + "00".repeat(32);
    expect(decodeAbiString(huge)).toBeNull();
  });

  it("REFUSES a truncated or malformed return value", () => {
    for (const v of ["0x", "0xabcd", "not hex", ""]) {
      expect(decodeAbiString(v), v).toBeNull();
    }
  });

  it("REFUSES bytes that are not valid UTF-8", () => {
    const bad = "0x" + (32).toString(16).padStart(64, "0") + (4).toString(16).padStart(64, "0") + "fffefdfc".padEnd(64, "0");
    expect(decodeAbiString(bad)).toBeNull();
  });
});
