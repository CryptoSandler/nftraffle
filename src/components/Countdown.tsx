"use client";

import { useSyncExternalStore } from "react";
import { formatRemaining, remaining, utcInstant } from "../lib/countdown";

/**
 * A clock that ticks, with the instant it is counting to beside it.
 *
 * **Both, never one.** The countdown is what a person needs to decide; the UTC
 * instant is what they need to check, and this product's entire claim is that
 * what it says can be checked (`DESIGN.md` §8.4). Replacing the timestamp with
 * a friendly countdown would trade a verifiable fact for a comfortable one.
 *
 * **The server renders only the instant, and the countdown appears on
 * hydration.** Not a workaround: a server component may not call `Date.now()` —
 * it is impure during render and produces markup the client then disagrees with.
 * The consequence is one worth having: with JavaScript disabled the page still
 * shows the exact, checkable time, which is the half that matters most.
 *
 * **One interval for the whole page.** Every countdown subscribes to the same
 * module-level clock through `useSyncExternalStore`. A `setInterval` per row
 * would be a dozen timers on a listing page, all firing at slightly different
 * moments, and the rows would visibly disagree with each other by a second.
 *
 * **No animation and no easing** (`DESIGN.md` §4-6): a number that glides toward
 * its new value reads as live when it is polled once a second. Set in the
 * tabular face so the row does not move as digits change.
 *
 * **No colour**, because there is no palette yet. When there is one, THIS is the
 * element that gets the accent, and the only one — `docs/decisions.md` Q19.
 *
 * WHO CALLS THIS: `src/app/page.tsx`, `src/app/r/[slug]/page.tsx` and
 * `src/app/c/[chain]/[slug]/page.tsx`.
 */

/**
 * The shared clock.
 *
 * `getSnapshot` must return a STABLE value between notifications — returning
 * `Date.now()` directly would hand React a new value on every read and spin. So
 * the tick updates this, and the snapshot reads it.
 */
let tickMs = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (timer === null) {
    tickMs = Date.now();
    timer = setInterval(() => {
      tickMs = Date.now();
      for (const listener of listeners) listener();
    }, 1_000);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** On the server there is no clock, and saying so is what keeps hydration honest. */
const serverSnapshot = () => null;
const clientSnapshot = () => (tickMs === 0 ? (tickMs = Date.now()) : tickMs);

export function Countdown({
  targetMs,
  label,
  elapsedLabel,
}: {
  targetMs: number;
  label: string;
  elapsedLabel: string;
}) {
  const nowMs = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const target = new Date(targetMs);
  const value = nowMs === null ? null : remaining(targetMs, nowMs);

  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-3 gap-y-1">
      {value && (
        <span className="figure text-base tabular-nums">
          {value.elapsed ? elapsedLabel : `${label} ${formatRemaining(value)}`}
        </span>
      )}
      <span className="figure text-xs text-neutral-500" title="The exact instant, in UTC">
        {utcInstant(target)}
      </span>
    </span>
  );
}
