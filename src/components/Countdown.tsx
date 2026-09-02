"use client";

import { useSyncExternalStore } from "react";
import { formatRemaining, remaining, utcInstant, type Remaining } from "../lib/countdown";

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
 * **The accent, and only while it is running.** `docs/decisions.md` Q22 gives the
 * accent two jobs — this and `.pop-action` — and `countdown-accent.test.ts`
 * asserts on rendered HTML that an elapsed clock emits no accent at all.
 *
 * **`size="lead"` makes it the loudest fact on a page** (`docs/benchmark-nft.md`
 * list A2). It changes the type scale and nothing else: the accent, the tabular
 * face and the absolute instant beside it are the same at both sizes, because
 * they are the rules and the size is a layout decision.
 *
 * WHO CALLS THIS: `src/app/page.tsx`, `src/app/r/[slug]/page.tsx`,
 * `src/app/c/[chain]/[slug]/page.tsx` and `src/components/RaffleList.tsx`.
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

/**
 * The markup, with no subscription in it.
 *
 * **Split out so the rule below can be asserted on RENDERED HTML** rather than
 * on the intention behind it. The hook version cannot be: `useSyncExternalStore`
 * returns null on the server, so a server render never contains a clock at all
 * and a test of it would pass whatever the rule said.
 *
 * **THE RULE: `--accent` is rendered only while a countdown is still running.**
 * A closed or drawn raffle has no live clock, so it has no accent — the
 * elapsed label is not recoloured, it is not emitted. What remains is the
 * status word in the row, in `ink`, and the absolute instant in `quiet`.
 *
 * The reason is the same one that gave the accent a single job
 * (`docs/decisions.md` Q19): a colour that means "time is running out" must not
 * appear on a raffle where it has already run out, or it stops meaning that and
 * starts meaning "this row is about time" — which is every row.
 */
export type ClockSize = "base" | "lead";

export function CountdownView({
  targetMs,
  label,
  value,
  size = "base",
}: {
  targetMs: number;
  label: string;
  /** Null before hydration: the server has no clock. */
  value: Remaining | null;
  size?: ClockSize;
}) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-3 gap-y-1">
      {value && !value.elapsed && (
        <span className={size === "lead" ? "clock figure text-2xl" : "clock figure text-base"}>
          {`${label} ${formatRemaining(value)}`}
        </span>
      )}
      <span className="figure text-xs text-quiet" title="The exact instant, in UTC">
        {utcInstant(new Date(targetMs))}
      </span>
    </span>
  );
}

export function Countdown({
  targetMs,
  label,
  size,
}: {
  targetMs: number;
  label: string;
  size?: ClockSize;
}) {
  const nowMs = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  return (
    <CountdownView
      targetMs={targetMs}
      label={label}
      size={size}
      value={nowMs === null ? null : remaining(targetMs, nowMs)}
    />
  );
}
