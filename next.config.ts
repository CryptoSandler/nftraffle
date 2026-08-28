import type { NextConfig } from "next";

/**
 * Security headers and the pre-launch noindex.
 *
 * Written for Vercel, where `headers()` is applied at the edge to every
 * matching response.
 */

/**
 * Hosts a metadata image may load from.
 *
 * **This list is the browser-enforced half of a rule the server already
 * follows.** Every image in this product comes from DAS — there is no upload
 * path and no form field that accepts a URL (spec §1, leg 3) — and DAS reports
 * whatever URI the asset's on-chain metadata points at. That URI is written by
 * whoever minted the asset, so it is attacker-controlled by construction: a
 * hostile collection can point its image at any host on the internet, and
 * rendering it would leak every viewer's address and user-agent to that host.
 *
 * So the allowlist is the permanent-storage gateways and IPFS gateways real
 * Solana metadata actually uses. An asset whose image is hosted elsewhere shows
 * as a blank frame rather than as a request we did not intend to make, and that
 * is the correct trade: a missing thumbnail costs a viewer nothing.
 */
const IMAGE_HOSTS = [
  "https://arweave.net",
  "https://*.arweave.net",
  "https://gateway.irys.xyz",
  "https://*.irys.xyz",
  "https://ipfs.io",
  "https://*.ipfs.nftstorage.link",
  "https://nftstorage.link",
  "https://cloudflare-ipfs.com",
  "https://shdw-drive.genesysgo.net",
].join(" ");

const CSP = [
  "default-src 'self'",

  // Next injects inline bootstrap scripts and, in development, uses eval for
  // hot reload. 'unsafe-inline' here is a real weakening; removing it needs
  // per-request nonces, which is its own change. Recorded rather than hidden
  // behind a comment saying it is fine.
  process.env.NODE_ENV === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",

  // Tailwind and next/font emit inline styles. Google Fonts is the one external
  // origin any stylesheet may reach — DESIGN.md §3 allows no other font source.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",

  `img-src 'self' data: ${IMAGE_HOSTS}`,

  // The browser talks to us and to the wallet extension, nothing else. The
  // Solana RPC is called from the server through /api/rpc precisely so this can
  // stay 'self': widening it would publish a paid provider's endpoint to
  // anyone who opens dev tools.
  "connect-src 'self'",

  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },

  // Two years, subdomains included, preload-eligible. Safe because the site is
  // https-only in production; a deployment still serving plain HTTP should not
  // set this.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },

  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // Nothing here needs a camera, a microphone, a location or a payment handler.
  // `payment=()` is about the Payment Request API and has nothing to do with
  // this product's payments, which are wallet signatures.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },

  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },

  /**
   * Layer 3 of the pre-launch noindex — see `src/app/robots.ts` for the whole
   * story and the launch checklist.
   *
   * This layer exists because the other two cannot see most of this site. A
   * `<meta>` tag needs a `<head>`, and every route under `/api` answers with
   * JSON that has none. A header does not care what the body is, so this is the
   * only one of the three that covers the whole surface.
   */
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,

  async headers() {
    return [
      // `/:path*` is the documented catch-all and matches `/` too, since `*`
      // allows zero segments. Headers are checked before the filesystem, so
      // this also covers files under `/public`.
      { source: "/:path*", headers: SECURITY_HEADERS },

      // The admin console and every API route must never be cached by a shared
      // cache. Other pages are dynamic too, but this is the set where a stale
      // or shared response would be a security problem rather than a stale
      // number.
      {
        source: "/(admin|api)/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, private" },
        ],
      },
      {
        source: "/admin",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, private" },
        ],
      },
    ];
  },
};

export default nextConfig;
