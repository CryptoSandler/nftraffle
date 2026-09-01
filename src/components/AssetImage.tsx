"use client";

import { useState } from "react";

/**
 * An asset's picture, or an honest placeholder.
 *
 * **A plain `<img>`, deliberately, not `next/image`.** Next's image pipeline
 * fetches the source ON OUR SERVER to optimise it — which would mean this
 * server making a request to a URL chosen by whoever minted the asset, outside
 * every bound `chain/metadata-fetch.ts` sets. The browser loading it directly is
 * bounded instead by the CSP's `img-src`, and our server never fetches an image
 * at all.
 *
 * The URL has already been checked against that same allowlist server-side
 * (`lib/image-hosts.ts`), so a blocked load here means the host went down rather
 * than that we emitted something the browser refused.
 *
 * **The placeholder says what it is.** Not a spinner, which implies something is
 * still coming, and not an empty box, which reads as a layout bug. An asset
 * whose metadata host is down is a fact about that asset, and the frame says so.
 *
 * WHO CALLS THIS: the raffle page and every listing surface, through
 * `lib/chain/asset-display.ts`.
 */
export function AssetImage({
  src,
  name,
  className = "",
}: {
  src: string | null;
  name: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex items-center justify-center border border-rule bg-panel ${className}`}
        role="img"
        aria-label={`No image available for ${name}`}
      >
        <span className="figure px-2 text-center text-[10px] leading-tight text-quiet">
          no image
        </span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      className={`border border-rule object-cover ${className}`}
      loading="lazy"
      decoding="async"
      // Never send our URL to a third-party image host.
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
