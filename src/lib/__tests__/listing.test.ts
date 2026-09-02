import { describe, expect, it } from "vitest";
import { PUBLISH_RETRY_REASONS, publishOutcome } from "../listing";

/**
 * What a seller is told when the deposit landed and the publish did not.
 *
 * **This is the only moment in the listing flow where the product owes somebody
 * an explanation about property it is holding.** The fee is paid, the prize is
 * in escrow, and the raffle is still a draft — so every sentence below is
 * written for a person whose NFT is somewhere they cannot see it.
 */

describe("after the deposit has landed", () => {
  it("offers a retry while the chain is merely behind", () => {
    // `not_found` on a signature we watched succeed means the node has not
    // caught up, not that the transfer is missing.
    for (const reason of PUBLISH_RETRY_REASONS) {
      expect(publishOutcome({ reason, message: "..." }).kind).toBe("retry");
    }
  });

  it("stops offering a retry when the deposit itself is wrong", () => {
    // A transfer to the wrong destination is not going to become right by being
    // asked again, and a seller refreshing forever is worse than being told.
    const outcome = publishOutcome({ reason: "wrong_destination", message: "..." });

    expect(outcome.kind).toBe("held");
  });

  it("never tells a seller nothing was charged", () => {
    const reasons = [...PUBLISH_RETRY_REASONS, "wrong_destination", "wrong_mint", undefined];

    for (const reason of reasons) {
      const outcome = publishOutcome({ reason, message: "..." });
      // The refusal copy everywhere else in this product ends with "Nothing has
      // been charged" (`lib/surfaces.ts`). Here it would be a lie: the fee left
      // their wallet and the asset left their wallet. DESIGN.md §8.
      expect(outcome.message).not.toMatch(/nothing has been charged/i);
      expect(outcome.message.toLowerCase()).toContain("escrow");
    }
  });

  it("says the raffle is not open yet, so nobody is buying tickets for it", () => {
    const outcome = publishOutcome({ reason: "wrong_sender", message: "..." });

    // The seller's second question, after "where is my NFT", is "is it selling
    // tickets without me". It is not: a draft is invisible.
    expect(outcome.message).toMatch(/not open|no tickets|nobody/i);
  });
});
