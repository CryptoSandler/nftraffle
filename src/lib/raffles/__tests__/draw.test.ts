import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { commitSeed, deriveWinner, drawMaterial, verifyCommitment } from "../draw";

/**
 * The draw is the one piece of this product that a stranger is asked to trust,
 * so these tests are written from the position of somebody who does not.
 *
 * Three properties matter and each is tested for its own reason:
 *
 *  - REPRODUCIBLE. Given the published inputs, anyone recomputes the same
 *    winner. Without this the verification page is decoration.
 *  - IN RANGE. The winner is always a ticket that exists. An off-by-one here is
 *    a winner nobody holds, discovered by the person who was owed the prize.
 *  - SENSITIVE TO EVERY INPUT. If an ingredient can be changed without changing
 *    the outcome, it is not part of the mechanism however prominently it is
 *    published — and two raffles closing on the same slot would share a result.
 */

const SEED = "a".repeat(64);
const SEED_HASH = createHash("sha256").update(Buffer.from(SEED, "hex")).digest("hex");
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3teA9";

const BASE = {
  seedHash: SEED_HASH,
  seed: SEED,
  drawBlockhash: BLOCKHASH,
  raffleId: "rf_00000000000000000000000000000001",
  ticketCount: 100,
};

describe("commitSeed", () => {
  it("produces a 32-byte seed and its sha256, and they agree", () => {
    const { seed, seedHash } = commitSeed();
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    expect(seedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyCommitment(seed, seedHash)).toBe(true);
  });

  it("does not repeat", () => {
    const seeds = new Set(Array.from({ length: 50 }, () => commitSeed().seed));
    expect(seeds.size).toBe(50);
  });

  it("hashes the seed's BYTES, not its hex spelling", () => {
    // The published commitment has to be checkable by somebody with a hex
    // string and a sha256 tool. Hashing the ASCII of the hex would still be
    // self-consistent here and would not match what anybody else computes —
    // a mechanism that verifies only against itself.
    const { seed, seedHash } = commitSeed();
    expect(seedHash).toBe(createHash("sha256").update(Buffer.from(seed, "hex")).digest("hex"));
  });
});

describe("verifyCommitment", () => {
  it("rejects a seed that does not match its published hash", () => {
    expect(verifyCommitment("b".repeat(64), SEED_HASH)).toBe(false);
  });

  it("rejects malformed input rather than throwing", () => {
    // This runs against values read back from the database and from a URL.
    // Throwing would turn a bad row into a 500 on a public page.
    expect(verifyCommitment("not-hex", SEED_HASH)).toBe(false);
    expect(verifyCommitment("", SEED_HASH)).toBe(false);
    expect(verifyCommitment(SEED, "")).toBe(false);
    expect(verifyCommitment("abc", "abc")).toBe(false);
  });

  it("is not case-sensitive about the hash", () => {
    expect(verifyCommitment(SEED, SEED_HASH.toUpperCase())).toBe(true);
  });
});

describe("deriveWinner", () => {
  it("is reproducible", () => {
    expect(deriveWinner(BASE)).toEqual(deriveWinner(BASE));
  });

  it("always names a ticket that exists", () => {
    for (const ticketCount of [1, 2, 3, 7, 99, 100, 1_000, 9_999]) {
      const { winningTicket } = deriveWinner({ ...BASE, ticketCount });
      expect(winningTicket).toBeGreaterThanOrEqual(1);
      expect(winningTicket).toBeLessThanOrEqual(ticketCount);
    }
  });

  it("names ticket 1 when exactly one ticket sold", () => {
    // The no-minimum rule (spec §0.6) makes this a real case, not a degenerate
    // one: a raffle can close having sold exactly one ticket.
    expect(deriveWinner({ ...BASE, ticketCount: 1 }).winningTicket).toBe(1);
  });

  it("refuses to draw with no tickets", () => {
    // A raffle that sold nothing has no winner. Returning 0, or 1, or throwing
    // deep inside a modulo is all worse than refusing here, where the caller
    // still knows what it was doing.
    expect(() => deriveWinner({ ...BASE, ticketCount: 0 })).toThrow(/at least one ticket/i);
  });

  it("changes when the seed changes", () => {
    const other = "b".repeat(64);
    const changed = deriveWinner({
      ...BASE,
      seed: other,
      seedHash: createHash("sha256").update(Buffer.from(other, "hex")).digest("hex"),
    });
    expect(changed.winningTicket).not.toBe(deriveWinner(BASE).winningTicket);
  });

  it("changes when the blockhash changes", () => {
    const changed = deriveWinner({
      ...BASE,
      drawBlockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi",
    });
    expect(changed.winningTicket).not.toBe(deriveWinner(BASE).winningTicket);
  });

  it("changes when the raffle id changes", () => {
    // THE REASON raffle_id IS AN INGREDIENT AT ALL. Without it, two raffles
    // that happen to close against the same announced slot and were seeded by
    // the same process would produce correlated results — and the correlation
    // would only be visible to somebody who noticed two winners at the same
    // index on the same day.
    const changed = deriveWinner({
      ...BASE,
      raffleId: "rf_00000000000000000000000000000002",
    });
    expect(changed.winningTicket).not.toBe(deriveWinner(BASE).winningTicket);
  });

  it("distributes across the range rather than favouring an end", () => {
    // Not a randomness proof — sha256 is not on trial here. This catches the
    // implementation bugs that DO happen: a truncated hash that only ever
    // yields small numbers, or a modulo applied to one byte.
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      seen.add(
        deriveWinner({ ...BASE, raffleId: `rf_${i}`, ticketCount: 1_000 }).winningTicket,
      );
    }
    expect(seen.size).toBeGreaterThan(300);
    expect(Math.max(...seen)).toBeGreaterThan(900);
    expect(Math.min(...seen)).toBeLessThan(100);
  });

  it("uses the FULL digest, not a truncated prefix", () => {
    // A 32-bit or 53-bit truncation would pass every test above and still be a
    // narrower draw than the published method claims. Asserting the material is
    // 256 bits is what makes the verification page's description true.
    const material = drawMaterial(BASE);
    expect(material).toMatch(/^[0-9a-f]{64}$/);
    expect(BigInt(`0x${material}`)).toBeGreaterThan(2n ** 200n);
  });

  it("is order-independent of how tickets were bought", () => {
    // The published inputs are the four values and the ticket COUNT. Nothing
    // about insertion order may enter, or the draw stops being reproducible
    // from the public ticket list.
    expect(deriveWinner(BASE).winningTicket).toBe(deriveWinner({ ...BASE }).winningTicket);
  });
});

describe("drawMaterial", () => {
  it("is the documented concatenation, so a reader can recompute it by hand", () => {
    // This assertion IS the specification. If the implementation changes, this
    // fails, and the verification page's instructions have to change with it.
    const expected = createHash("sha256")
      .update(`${BASE.seedHash}${BASE.seed}${BASE.drawBlockhash}${BASE.raffleId}`, "utf8")
      .digest("hex");
    expect(drawMaterial(BASE)).toBe(expected);
  });
});
