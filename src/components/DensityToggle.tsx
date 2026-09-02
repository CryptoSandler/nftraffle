"use client";

import { useSyncExternalStore } from "react";

/**
 * Comfortable or compact, for a list that can get long.
 *
 * `docs/benchmark-nft.md` list A8, from Magic Eden and Tensor: it respects a
 * returning reader without adding a single datum. It is the cheapest pattern in
 * the benchmark and the only one that needs client state.
 *
 * **It remembers, per browser, and it is allowed to forget.** A toggle that
 * resets on every navigation is one nobody uses twice. `localStorage` is wrapped
 * because it throws outright in some contexts — a private window with site data
 * blocked, an embedded preview — and a density preference is not worth a blank
 * page. The list renders comfortable when the read fails, which is the state a
 * first visit gets anyway.
 *
 * **`useSyncExternalStore`, not `useState` in an effect**, which is the same
 * idiom `Countdown` uses for the same reason: the value lives outside React —
 * in storage rather than in a clock — and reading it into state from an effect
 * is a render the framework did not ask for. `eslint`'s
 * `react-hooks/set-state-in-effect` refuses the other shape, and it is right to.
 *
 * The server snapshot is `comfortable` because a server has no storage. A
 * browser whose stored value differs re-renders once on hydration, which is what
 * this hook is for.
 *
 * WHO CALLS THIS: the collection page's raffle list.
 */
export type Density = "comfortable" | "compact";
const KEY = "density";

/** Cached so the snapshot is stable between notifications, as React requires. */
let cached: Density | null = null;
const listeners = new Set<() => void>();

function snapshot(): Density {
  if (cached !== null) return cached;
  try {
    cached = window.localStorage.getItem(KEY) === "compact" ? "compact" : "comfortable";
  } catch {
    // Storage unavailable. Comfortable is the honest default, not a failure.
    cached = "comfortable";
  }
  return cached;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function store(next: Density): void {
  cached = next;
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    // The toggle still works for this page; it just will not persist.
  }
  for (const listener of listeners) listener();
}

export function useDensity(): [Density, (next: Density) => void] {
  const density = useSyncExternalStore(subscribe, snapshot, () => "comfortable" as Density);
  return [density, store];
}

export function DensityToggle({
  density,
  onChange,
}: {
  density: Density;
  onChange: (next: Density) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-quiet">Density</span>
      {(["comfortable", "compact"] as const).map((option) => (
        <button
          key={option}
          type="button"
          className="control text-xs"
          /*
           * `aria-pressed` carries the state. The visual difference is weight,
           * not colour: the accent has two jobs and this is not one of them
           * (docs/decisions.md Q22), and a state shown only in colour fails
           * DESIGN.md §9 regardless.
           */
          aria-pressed={density === option}
          onClick={() => onChange(option)}
        >
          <span className={density === option ? "text-ink" : "text-quiet"}>{option}</span>
        </button>
      ))}
    </div>
  );
}
