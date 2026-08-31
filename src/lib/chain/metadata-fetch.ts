/**
 * Fetching a token's off-chain metadata JSON, under bounds.
 *
 * **This is the only place in this product that fetches a URL somebody else
 * chose**, and that is what every rule below is for. An ERC-721's `tokenURI`
 * is set by whoever deployed the contract, so the string this module is handed
 * is attacker-controlled by definition — not "could be malicious if something
 * goes wrong", but supplied by an untrusted party as a matter of course.
 *
 * Solana needs none of this: DAS returns the metadata already resolved, through
 * a provider we configure. EVM has no equivalent, so the bound has to be here.
 *
 * **The threat is SSRF before it is anything else.** This code runs on a server
 * that can reach things a visitor cannot: a cloud metadata endpoint at
 * 169.254.169.254, a database on a private subnet, a neighbour service on
 * localhost. A fetch of an attacker's URL is a request that attacker gets to
 * make FROM INSIDE, and the response is rendered on a page. So the question is
 * never "is this URL bad" — it is "is this URL on the small list of shapes we
 * accept", and everything else is refused.
 *
 * WHO CALLS THIS: `chain/robinhood/metadata.ts`, and nothing else. It is
 * deliberately not exported through the adapter interface — an adapter that
 * could be handed an arbitrary URL by a caller would put this decision back in
 * the caller's hands.
 */

/**
 * How long a metadata host gets. A page render waits on this.
 *
 * Short on purpose: metadata is decoration. A raffle page must render the
 * prize, the price and the draw whether or not somebody's IPFS pin is up, and a
 * ten-second stall on a third party is a worse page than a missing image.
 */
const FETCH_TIMEOUT_MS = 4_000;

/**
 * The most we will read. Token metadata is a small JSON object — a name, a
 * URL, a few traits.
 *
 * **Enforced while reading, not from `content-length`.** A host can omit that
 * header or lie in it, so the declared size is a fast rejection and the stream
 * itself is capped as it arrives. The same discipline `/api/rpc/[chain]` applies
 * to request bodies, for the same reason: a check that a peer can turn off is
 * not a check.
 */
const MAX_BYTES = 128 * 1024;

/**
 * The schemes we accept, and nothing else.
 *
 * - `https:` — the ordinary case, and TLS is not optional for something we
 *   render.
 * - `ipfs:` — resolved through the gateway below, never fetched as a protocol.
 * - `data:` — JSON inlined in the token URI. It touches no network at all,
 *   which makes it the safest of the three rather than the most exotic.
 *
 * **`http:` is refused deliberately**, and it is the one somebody will want to
 * add. Plaintext means any party on the path chooses what we render, and most
 * of the interesting SSRF targets — link-local, loopback, private ranges —
 * speak it. Refusing the scheme removes that whole class before the host is
 * even examined.
 */
const ALLOWED_SCHEMES = new Set(["https:", "ipfs:", "data:"]);

/**
 * Where `ipfs://` is resolved.
 *
 * A public gateway rather than a node of our own: this project runs no
 * infrastructure it does not have to, and a pinned CID is content-addressed, so
 * a gateway cannot substitute different bytes without changing the CID. It CAN
 * refuse to serve, which degrades to a missing image — the acceptable failure.
 *
 * // ponytail: one hard-coded gateway; make it an env var with a fallback list
 * // if metadata starts failing to load for real collections.
 */
const IPFS_GATEWAY = "https://ipfs.io/ipfs/";

/**
 * Hostnames that are never fetched, whatever the scheme said.
 *
 * This is defence in depth behind the scheme allowlist rather than the primary
 * control — over `https:` these are unusual but not impossible, and a
 * certificate for `localhost` is something anybody can mint.
 *
 * **What this does NOT stop, said out loud: DNS rebinding.** A hostname that
 * resolves to a public address when checked and a private one when fetched
 * defeats every name-based check, including this one. Closing it needs
 * resolution and connection to be the same step — a custom agent that pins the
 * resolved address — which Node's `fetch` does not expose. The residual risk is
 * accepted here because the response is parsed into three known fields and
 * never echoed, so a successful rebind yields a name and an image URL rather
 * than an exfiltrated body.
 * // ponytail: name-based only; pin the resolved address with a custom agent if
 * // this server ever gains a private network worth reaching.
 */
function isForbiddenHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host === "0.0.0.0") return true;
  // IPv4 literals in the ranges that are never a legitimate metadata host.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local: cloud metadata lives here
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a >= 224) return true; // multicast and reserved
  }
  // IPv6 unique-local and link-local.
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) return true;
  return false;
}

export type TokenMetadata = {
  name: string | null;
  image: string | null;
  collection: string | null;
};

export type MetadataRefusal =
  | "bad_uri"
  | "scheme_not_allowed"
  | "host_not_allowed"
  | "too_large"
  | "timeout"
  | "unreachable"
  | "not_json";

export type MetadataResult =
  | { ok: true; metadata: TokenMetadata }
  | { ok: false; reason: MetadataRefusal };

/**
 * Turns a raw `tokenURI` into a URL this module is willing to fetch, or says
 * why not.
 *
 * Exported because it is the whole of the decision and deserves to be tested
 * without a network. Everything after it is plumbing.
 */
export function resolveTokenUri(raw: string): { ok: true; url: string } | { ok: false; reason: MetadataRefusal } {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 2_048) return { ok: false, reason: "bad_uri" };

  // `ipfs://<cid>/path` is not a URL Node will parse usefully, so it is
  // rewritten before parsing rather than after.
  if (trimmed.toLowerCase().startsWith("ipfs://")) {
    const path = trimmed.slice("ipfs://".length).replace(/^ipfs\//i, "");
    if (!/^[A-Za-z0-9][A-Za-z0-9./_-]*$/.test(path)) return { ok: false, reason: "bad_uri" };
    return { ok: true, url: IPFS_GATEWAY + path };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "bad_uri" };
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) return { ok: false, reason: "scheme_not_allowed" };
  if (url.protocol === "data:") return { ok: true, url: trimmed };
  if (isForbiddenHost(url.hostname)) return { ok: false, reason: "host_not_allowed" };
  // Credentials in a metadata URL are never legitimate and would be sent to the
  // host on our behalf.
  if (url.username || url.password) return { ok: false, reason: "bad_uri" };

  return { ok: true, url: url.toString() };
}

/**
 * Pulls the three fields we render out of whatever JSON came back.
 *
 * **Everything else is discarded, and that is the point.** The document is
 * attacker-controlled; parsing it into a known shape here means nothing
 * unexpected can reach a template. Fields that are not strings become null
 * rather than being coerced — `image: {}` rendering as `[object Object]` is the
 * small version of the same mistake.
 *
 * `image` is NOT fetched or validated as a URL here: it is handed to Next's
 * image pipeline, which only renders hosts listed in `next.config.ts`. One
 * allowlist, in the place that does the rendering.
 */
export function readMetadataDocument(value: unknown): TokenMetadata {
  const doc = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, max) : null;
  return {
    name: str(doc.name, 200),
    image: str(doc.image, 2_048),
    // ERC-721 has no collection field by convention; some contracts carry one.
    collection: str(doc.collection, 200),
  };
}

/**
 * Fetches and parses one token's metadata, under every bound above.
 *
 * Never throws, and never returns a partial result. A caller renders the asset
 * reference when this refuses, which is why the refusal reasons are typed —
 * "the host was not allowed" and "the host was down" are different operational
 * facts even though the page looks the same.
 */
export async function fetchTokenMetadata(rawUri: string): Promise<MetadataResult> {
  const resolved = resolveTokenUri(rawUri);
  if (!resolved.ok) return resolved;

  let response: Response;
  try {
    response = await fetch(resolved.url, {
      // NO REDIRECTS. A redirect is a second URL chosen by the same untrusted
      // party, arriving after every check above has already run — which is
      // precisely how a scheme and host allowlist gets walked around. Following
      // one would mean re-validating the target, and "validate, follow,
      // re-validate" is a loop with an off-by-one nobody notices.
      redirect: "error",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    // THE NAME, NEVER THE OBJECT. A failed fetch can carry the target URL in
    // its message, and this one was supplied by an attacker.
    const name = error instanceof Error ? error.name : "unknown";
    return { ok: false, reason: name === "TimeoutError" ? "timeout" : "unreachable" };
  }

  if (!response.ok) return { ok: false, reason: "unreachable" };

  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > MAX_BYTES) return { ok: false, reason: "too_large" };

  const text = await readCapped(response, MAX_BYTES);
  if (text === null) return { ok: false, reason: "too_large" };

  try {
    return { ok: true, metadata: readMetadataDocument(JSON.parse(text)) };
  } catch {
    return { ok: false, reason: "not_json" };
  }
}

/** Reads a body up to `maxBytes`, never buffering more than that. */
async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      return null;
    }
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}
