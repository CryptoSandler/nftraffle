import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The draw: commit at creation, reveal at close, recomputable by anyone.
 *
 * Pure functions only, and that is the point rather than tidiness. Everything
 * here has to be checkable by a stranger with a sha256 tool and the four values
 * the raffle page publishes, so nothing in this file may read the clock, the
 * database, or the environment. A draw that depends on something unpublished is
 * a draw nobody can reproduce, however honest it actually is.
 *
 * WHO CALLS THIS: `commitSeed` from `POST /api/raffles` when a draft is
 * created; `deriveWinner` and `verifyCommitment` from `raffles/lifecycle.ts`
 * when a closed raffle is drawn; `drawMaterial` and `verifyCommitment` again
 * from the public page at `/r/[slug]/verify`, which shows the reader the same
 * arithmetic the server ran.
 *
 * WHAT THIS DOES NOT DEFEND AGAINST, stated here because a mechanism that
 * oversells itself is worse than one that does not exist: an operator who
 * dislikes the outcome can decline to reveal the seed. The commitment makes
 * BIAS impossible — the hash is published before the blockhash exists, so no
 * seed can be chosen to suit a result — and it makes REFUSAL obvious. It cannot
 * make refusal impossible without an on-chain program, which this project does
 * not have. `/r/[slug]/verify` names that state explicitly rather than
 * rendering an empty section.
 */

const SEED_BYTES = 32;

/** A 32-byte seed and the sha256 commitment published for it, both as hex. */
export function commitSeed(): { seed: string; seedHash: string } {
  const seed = randomBytes(SEED_BYTES).toString("hex");
  return { seed, seedHash: sha256Hex(Buffer.from(seed, "hex")) };
}

/**
 * Whether a revealed seed matches the hash committed for it.
 *
 * Hashes the seed's BYTES, not its hex spelling. Hashing the ASCII of the hex
 * would be self-consistent — it would verify against itself all day — and would
 * match nothing a reader computes with an ordinary sha256 tool, which is the
 * only audience this function has.
 *
 * Never throws. It runs against values read back from the database and from a
 * URL, and a malformed row must render as "this does not check out" on a public
 * page rather than as a 500.
 */
export function verifyCommitment(seed: string, seedHash: string): boolean {
  const seedBytes = hexToBytes(seed);
  if (!seedBytes) return false;

  const expected = hexToBytes(sha256Hex(seedBytes));
  const offered = hexToBytes(seedHash.trim().toLowerCase());
  if (!offered || !expected || offered.length !== expected.length) return false;

  return timingSafeEqual(offered, expected);
}

export type AnchorRefusal =
  /**
   * The block offered as the draw's entropy is older than the sale's close, so
   * its hash existed while tickets could still be bought. THE ATTACK: a buyer
   * who reads it can compute the winning number before deciding whether to buy,
   * and buy exactly the ticket that wins.
   */
  | "anchor_before_close"
  /** Older than the anchor the raffle published. Not the block that was committed to. */
  | "anchor_before_commitment";

/**
 * Whether a block may decide this raffle.
 *
 * **This is the rule the whole draw redesign exists to enforce**
 * (`docs/decisions.md` Q14, `docs/findings-2026-08-31-draw-margin.md`). The
 * previous design named a block NUMBER at creation, predicted from an assumed
 * slot rate; on mainnet the real rate was 317 ms against an assumed 400, so the
 * named block arrived roughly a fifth early — and for any raffle running longer
 * than about four hours, it arrived BEFORE the sale closed. Its hash was then
 * public while tickets were still on sale.
 *
 * The redesign anchors to an instant instead of a number, which removes the
 * arithmetic that was wrong. This function is the belt to that braces: it
 * checks the resolved block's OWN timestamp against the close, so a draw can
 * only ever use entropy that did not exist while anyone could still buy.
 *
 * **Both conditions are checked, not just the interesting one.** Being after
 * the close is the safety property; being at or after the published anchor is
 * the DETERMINISM property — anyone recomputing the draw looks up the first
 * block at or after `drawAt`, and a server that used an earlier one would be
 * publishing a method it did not follow.
 *
 * Pure, like everything in this file: the caller supplies the three instants,
 * so the same check runs in the draw route, in the tests, and on the public
 * verification page.
 *
 * WHO CALLS THIS: `POST /api/admin/raffles/[id]/draw` before it derives a
 * winner, and `/r/[slug]/verify` when it re-checks a completed draw.
 */
export function checkDrawAnchor(input: {
  /** The resolved block's timestamp, as the chain reports it. */
  blockTimeMs: number;
  /** When the sale closed. */
  endsAtMs: number;
  /** The instant published at creation. */
  drawAtMs: number;
}): { ok: true } | { ok: false; reason: AnchorRefusal; message: string } {
  if (input.blockTimeMs <= input.endsAtMs) {
    return {
      ok: false,
      reason: "anchor_before_close",
      message:
        "That block is not after this raffle closed, so its hash was public while tickets were " +
        "still on sale. The draw will not use it.",
    };
  }
  if (input.blockTimeMs < input.drawAtMs) {
    return {
      ok: false,
      reason: "anchor_before_commitment",
      message:
        "That block is earlier than the instant this raffle published, so it is not the block " +
        "the draw committed to.",
    };
  }
  return { ok: true };
}

export type DrawInputs = {
  /** The commitment published when the raffle was created. */
  seedHash: string;
  /** The seed revealed at the draw. */
  seed: string;
  /**
   * The hash of the first block at or after the instant announced at creation.
   * Which block that is comes from the chain, not from us — see
   * `chain/anchor.ts`.
   */
  drawBlockhash: string;
  /** This raffle's id. */
  raffleId: string;
};

/**
 * The 256 bits the winner is derived from, as hex.
 *
 * **The four ingredients, and why each one is there.**
 *
 * - `seed` stops the chain from deciding alone, and it was committed to before
 *   the blockhash existed, so it cannot have been chosen to suit a result.
 * - `drawBlockhash` stops US from deciding alone. It comes from the first block
 *   at or after an INSTANT named before a single ticket was sold — and that
 *   block did not exist while any ticket could still be bought, which
 *   `checkDrawAnchor` above refuses to proceed without.
 * - `raffleId` stops two raffles that resolve to the same anchor block from
 *   producing correlated outcomes. Two raffles closing in the same ten minutes
 *   now genuinely can share a block, which the old per-raffle slot made rarer
 *   and which this makes ordinary — so this ingredient matters more than it did. Without it, two draws seeded by the
 *   same process on the same day could land on the same index, and the
 *   correlation would only be visible to somebody who went looking.
 * - `seedHash` is redundant given `seed` and is included anyway, because the
 *   published page lists four values and the arithmetic a reader is told to do
 *   must use all four. A description that quietly ignores one of its own inputs
 *   is a description people stop trusting when they notice.
 *
 * Concatenated as UTF-8 text, in this order, with no separator. The values are
 * fixed-width hex, base58 and an opaque id, so no concatenation ambiguity is
 * reachable — and text is what somebody can paste into a sha256 box.
 */
export function drawMaterial(inputs: DrawInputs): string {
  return sha256Hex(
    Buffer.from(
      `${inputs.seedHash}${inputs.seed}${inputs.drawBlockhash}${inputs.raffleId}`,
      "utf8",
    ),
  );
}

/**
 * The winning ticket number, from 1 to `ticketCount`.
 *
 * **The full 256-bit digest is used, not a prefix.** Truncating to 32 or 53
 * bits would pass every distribution check a test can cheaply make and would
 * still be a narrower draw than the page claims — so the arithmetic is done in
 * `BigInt`, where taking the whole digest costs nothing.
 *
 * **Modulo bias is present and is negligible, stated rather than hidden.** With
 * a 256-bit value and a ticket count under 2^32, the bias toward the low end is
 * on the order of 2^-224 — far below the point where any other part of this
 * system is the weakest link. Rejection sampling would remove it and would make
 * the page's instructions "compute this, and if it exceeds a threshold, do it
 * again", which trades a bias nobody can measure for a procedure readers get
 * wrong.
 */
export function deriveWinner(
  inputs: DrawInputs & { ticketCount: number },
): { winningTicket: number } {
  if (!Number.isInteger(inputs.ticketCount) || inputs.ticketCount < 1) {
    // A raffle that sold nothing has no winner. Refusing here, where the caller
    // still knows what it was doing, beats returning 0 or 1 and having the
    // wrongness surface as a payout to a ticket nobody holds.
    throw new RangeError("A draw needs at least one ticket.");
  }

  const material = BigInt(`0x${drawMaterial(inputs)}`);
  return { winningTicket: Number(material % BigInt(inputs.ticketCount)) + 1 };
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Hex to bytes, or null for anything that is not even-length hex. */
function hexToBytes(value: string): Buffer | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length % 2 !== 0) return null;
  if (!/^[0-9a-f]+$/.test(trimmed)) return null;
  return Buffer.from(trimmed, "hex");
}
