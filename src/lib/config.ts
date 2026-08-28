/**
 * Environment readers.
 *
 * Each one throws rather than defaulting. A default for any of these is a
 * production deploy that looks healthy while doing the wrong thing: an unsalted
 * hash, or a rate limit anyone can opt out of.
 *
 * WHO CALLS THIS: `client-ip.ts` (every one of the address functions),
 * `payments/config.ts` for the fee readers, and `http.ts` for the origin guard.
 */

function required(name: string, why: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set. ${why}`);
  return value;
}

export function rateLimitSalt(): string {
  return required(
    "RATE_LIMIT_SALT",
    "An unsalted SHA-256 of an IPv4 address is reversible by brute force, so the " +
      "stored hashes would be visitor IP addresses in all but name.",
  );
}

export function trustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : 1;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function allowUntrustedClientIp(): boolean {
  return process.env.ALLOW_UNTRUSTED_CLIENT_IP?.trim() === "true";
}

/**
 * Which platform header, if any, this deployment trusts as the caller's real
 * address.
 *
 * Unset by default: no platform header is trusted until we are told which edge
 * we are running behind, because a header is only unforgeable when that
 * platform's edge is the one writing it. `client-ip.ts` still validates the
 * value against the headers it actually knows how to use — this function only
 * reads the environment.
 */
export function trustedPlatformHeader(): string | null {
  return process.env.TRUSTED_PLATFORM_HEADER?.trim() || null;
}

/**
 * The site's own public origin, when it is configured.
 *
 * Used by the origin guard in `http.ts` and by nothing else. It is optional
 * because a deployment without it falls back to the request's own Host, which
 * is right for local development and merely adequate in production — see
 * `refuseForeignOrigin` for why the fallback is acceptable there.
 */
export function siteUrl(): string | null {
  return process.env.SITE_URL?.trim() || null;
}

/**
 * A positive integer from the environment, or the documented default.
 *
 * Unlike the rest of this file, a bad value here does not throw: the settings
 * that use it are tunable knobs, not secrets a missing value should block
 * startup over. But `Number.parseInt` on garbage produces NaN, and NaN is not a
 * fallback — it reaches Postgres as an integer parameter and gets rejected,
 * 500ing every request that touches it. Falling back explicitly is what makes a
 * typo in the environment merely wrong instead of an outage.
 */
export function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = raw?.trim() ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
