import { clientIp, hashIp, subnetKey } from "./client-ip";
import { siteUrl } from "./config";

/**
 * Who is calling, and whether they are allowed to write, in one place.
 *
 * WHO CALLS THIS: every route handler under `src/app/api/`. `identify` before
 * anything rate-limited, `refuseForeignOrigin` first on every POST.
 *
 * Simpler than the sibling's version of this file in exactly one way: there is
 * no cookie identity here. That project issued a signed "painter" cookie
 * because its hot path was anonymous and free, so it needed a per-browser
 * subject to meter. Every write in this product costs SOL and is bound to a
 * wallet the chain names, so the only thing left to meter is the address —
 * which means one fewer secret to configure and one fewer thing to forge.
 */
export type Caller =
  | { ok: true; ipHash: string; subnetKey: string }
  | { ok: false; message: string };

/**
 * Fails closed on the address: without a trustworthy one there is no rate
 * limit, and a shared bucket for every anonymous caller is either an unlimited
 * allowance or a self-inflicted outage.
 */
export function identify(request: Request): Caller {
  const identity = clientIp(request);
  if (!identity.ok) {
    // The operational detail — which environment variable to set, how many
    // proxy hops are configured — is for the server log, not the caller. It
    // names ALLOW_UNTRUSTED_CLIENT_IP, the variable that switches rate limiting
    // off, and this message is returned in a body the client renders.
    console.error(`identify: ${identity.reason}`);
    return { ok: false, message: "This request could not be verified. Please try again." };
  }

  return {
    ok: true,
    ipHash: hashIp(identity.ip),
    subnetKey: subnetKey(identity.ip),
  };
}

/**
 * The site's own origin, so a cross-site POST can be told apart from a
 * same-origin one.
 *
 * `SITE_URL` wins when it is set — the source of truth in production and
 * previews, where the Host header may not match the public hostname. Falling
 * back to the request's own Host keeps local development working without it.
 */
function siteOrigin(request: Request): string {
  const configured = siteUrl();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Malformed SITE_URL: fall through to Host rather than 500 every write.
    }
  }

  const host = request.headers.get("host");
  if (host) {
    const protocol = new URL(request.url).protocol || "https:";
    return `${protocol}//${host}`;
  }

  return new URL(request.url).origin;
}

/**
 * Refuses a POST that came from another site, or null to let it through.
 *
 * WHY EVERY WRITE ROUTE AND NOT JUST THE MONEY ONES. A CORS-simple POST (e.g.
 * `content-type: text/plain`) needs no preflight, so this is the only line
 * between any page on the internet and a state change made on this caller's
 * behalf. A forged call still opens orders, mints reference keypairs, and
 * spends rate-limit budget — and on `/api/rpc` it spends a paid provider's
 * quota, which is the case that costs actual money.
 *
 * A request with NO Origin header at all is unaffected — a same-origin form
 * post and a server-to-server call both look like that, and neither is what
 * this guard is for. Only a present, foreign Origin is refused.
 */
export function refuseForeignOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;

  let foreign = true;
  try {
    foreign = new URL(origin).origin !== siteOrigin(request);
  } catch {
    foreign = true;
  }
  if (!foreign) return null;

  return json(
    { error: "This origin is not allowed to post here." },
    { status: 403, headers: NO_STORE },
  );
}

export const NO_STORE = { "cache-control": "no-store" };

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}
