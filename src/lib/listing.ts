/**
 * The listing flow's decisions, apart from the wallet plumbing that carries
 * them out.
 *
 * The same split `checkout.ts` makes for the buying side, for the same reason:
 * what a person is told when something goes wrong is a product decision, it is
 * testable in Node, and it should not be buried in a component alongside
 * `useState`.
 *
 * WHO CALLS THIS: `src/components/ListRaffle.tsx`.
 */

/**
 * The binding fields for a new draft.
 *
 * **Here rather than in the component for a rule with a scar behind it**: the
 * design suite forbids `toISOString()` in any `.tsx`, because that is how a raw
 * `2026-08-31T21:55:05.841Z` once reached a page. This timestamp never reaches
 * a page — it is signed, and the server rebuilds the same string to verify —
 * but the rule is worth more than the exception, and the fields belong beside
 * the rest of the flow's decisions anyway.
 */
export function bindingFieldsFor(input: {
  domain: string;
  address: string;
  prizeAsset: string;
}): {
  domain: string;
  address: string;
  chain: string;
  prizeAsset: string;
  nonce: string;
  issuedAt: string;
} {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return {
    domain: input.domain,
    address: input.address,
    chain: "solana",
    prizeAsset: input.prizeAsset,
    // 16 hex characters, which is what the binding's nonce rule accepts.
    nonce: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""),
    issuedAt: new Date().toISOString(),
  };
}

/**
 * When a launch should open, as the API wants it.
 *
 * Here for the same reason `bindingFieldsFor` is: the design suite forbids
 * `toISOString()` in a `.tsx`, and the scar behind that rule is a raw
 * `2026-08-31T21:55:05.841Z` reaching a page. This string is sent, not shown.
 */
export function startsAtFromNow(minutes: number): string {
  return new Date(Date.now() + Math.max(0, minutes) * 60_000).toISOString();
}

export type PublishFailure = { reason?: unknown; message: string };

export type PublishOutcome =
  /** The chain is behind or unreachable. The deposit is fine; ask again. */
  | { kind: "retry"; message: string }
  /** The deposit does not satisfy the escrow check. A person has to look. */
  | { kind: "held"; message: string };

/**
 * Reasons that mean "ask again in a moment", not "this will never work".
 *
 * `not_found` is on this list and that is the one worth explaining: the browser
 * has just watched the transaction succeed, so a node saying it does not exist
 * is a node that has not caught up. Treating that as a permanent failure would
 * tell a seller their deposit is lost seconds before it appears.
 */
export const PUBLISH_RETRY_REASONS: readonly string[] = [
  "not_found",
  "rpc_unavailable",
  "ownership_unknown",
];

/**
 * What to show a seller whose `/publish` failed AFTER their transaction settled.
 *
 * **The fee and the prize have both left their wallet by the time this runs.**
 * So no message here may end with the sentence every other refusal in this
 * product ends with — `lib/surfaces.ts`'s "Nothing has been charged" — because
 * something has been. Every branch says where the asset is and whether the
 * raffle is selling anything.
 */
export function publishOutcome(failure: PublishFailure): PublishOutcome {
  const reason = typeof failure.reason === "string" ? failure.reason : "";

  const whereItIs =
    "Your prize is in escrow and the raffle is not open, so no tickets are being sold for it.";

  if (PUBLISH_RETRY_REASONS.includes(reason)) {
    return {
      kind: "retry",
      message: `${whereItIs} Solana has not caught up with your deposit yet — try publishing again in a moment.`,
    };
  }

  return {
    kind: "held",
    message:
      `${whereItIs} The deposit did not pass the check that opens a raffle, which needs somebody ` +
      `to look at it. Keep this page's address: it names the draft.`,
  };
}
