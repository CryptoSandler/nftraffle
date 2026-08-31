import { describe, expect, it } from "vitest";
import { query, queryOne } from "../../db";
import { commitSeed, verifyCommitment } from "../draw";
import {
  advanceRaffle,
  cancelRaffle,
  cancelRaffleAsSeller,
  createDraft,
  openRaffle,
  raffleById,
  raffleBySlug,
  recordDraw,
  recordPayout,
} from "../lifecycle";

/**
 * Every transition a raffle can make, and — more importantly — every one it
 * cannot.
 *
 * The rule these tests defend is CLAUDE.md's: a status is never an input. There
 * is no `setStatus`, so the only way to reach a state is through the function
 * that owns it, and each of those functions refuses when its precondition does
 * not hold. A test that only drove the happy path would leave the whole point
 * untested.
 */

const SELLER = "6dNVEXCsBpisPjcyanBz4qgpm2SXPkR7wRPmuA6cxRLW";
const OTHER_WALLET = "3Nq7EtQe3aUZLxRUkzYq9c6DdShxWFRp3wY4qWCTGVAH";
const MINT = "8H1yMDsxDs52kZ8kmDzYWiCoTfxLZDvcqcMjxLdbBnRz";

let counter = 0;

/**
 * A commitment and its secret, the pair `createDraft` needs.
 *
 * The secret is written at creation and only copied into the published `seed`
 * at the draw (migration 003), so a fixture that supplied a hash without a
 * secret would create a raffle nobody could ever draw.
 */
function seedPair() {
  const { seed, seedHash } = commitSeed();
  return { seedHash, seedSecret: seed };
}


async function draft(overrides: Partial<Parameters<typeof createDraft>[0]> = {}) {
  counter += 1;
  const result = await createDraft({
    slug: `raffle-${counter}`,
    chain: "solana" as const,
    sellerWallet: SELLER,
    prizeAsset: MINT,
    collectionId: null,
    ticketPriceNative: 100_000_000n,
    maxTickets: 10,
    houseFeeBps: 500,
    drawSlot: 300_000_000n + BigInt(counter),
    endsAt: new Date(Date.now() + 60 * 60_000),
    ...seedPair(),
    ...overrides,
  });
  if (!result.ok) throw new Error(`fixture draft failed: ${result.reason}`);
  return result.raffle;
}

/** Puts a raffle in `open` the only way the module allows. */
async function opened(overrides: Parameters<typeof draft>[0] = {}) {
  const row = await draft(overrides);
  const result = await openRaffle(row.id, {
    listingFeeSignature: `listing-${row.id}`,
    escrowSignature: `escrow-${row.id}`,
  });
  if (!result.ok) throw new Error(`fixture open failed: ${result.reason}`);
  return result.raffle;
}

/** Sells `count` tickets directly, so lifecycle tests do not depend on settlement. */
async function sellTickets(raffleId: string, count: number, wallet = OTHER_WALLET) {
  const orderId = `order-${raffleId}-${wallet}-${count}`;
  await query(
    `INSERT INTO ticket_orders
       (id, raffle_id, chain, quantity, amount_native, payer_pubkey, reference_pubkey,
        status, expires_at, paid_at)
     VALUES ($1,$2,'solana',$3,$4,$5,$6,'paid', now() + interval '1 hour', now())`,
    [orderId, raffleId, count, 100_000_000n * BigInt(count), wallet, `ref-${orderId}`],
  );
  for (let n = 1; n <= count; n++) {
    await query(
      `INSERT INTO tickets (raffle_id, number, order_id, wallet) VALUES ($1,$2,$3,$4)`,
      [raffleId, n, orderId, wallet],
    );
  }
}

describe("createDraft", () => {
  it("starts in draft with no prize proved and no seed revealed", async () => {
    const raffle = await draft();
    expect(raffle.status).toBe("draft");
    expect(raffle.escrowSignature).toBeNull();
    expect(raffle.seed).toBeNull();
    expect(raffle.winnerWallet).toBeNull();
  });

  it("publishes a commitment at creation, before any ticket can be sold", async () => {
    // The whole mechanism rests on the hash existing before the draw's
    // randomness does. A draft with no commitment is a raffle whose draw could
    // never be checked, so the column is NOT NULL and this asserts the code
    // honours it rather than relying on the constraint alone.
    const raffle = await draft();
    expect(raffle.seedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(raffle.drawSlot).toBeGreaterThan(0n);
  });

  it("refuses a second live raffle for the same prize", async () => {
    await draft();
    const second = await createDraft({
      slug: "raffle-duplicate",
      chain: "solana" as const,
      sellerWallet: OTHER_WALLET,
      prizeAsset: MINT,
      collectionId: null,
      ticketPriceNative: 1n,
      maxTickets: 1,
      houseFeeBps: 0,
      drawSlot: 1n,
      endsAt: new Date(Date.now() + 60_000),
      ...seedPair(),
    });
    // Two drafts naming one mint would both match the same deposit, and the
    // one that published first would take an asset the other seller believed
    // was theirs.
    expect(second).toEqual({ ok: false, reason: "prize_already_listed" });
  });

  it("allows the same prize again once the previous raffle is cancelled", async () => {
    const first = await draft();
    await cancelRaffle(first.id, "seller changed their mind");
    const again = await draft({ slug: "raffle-again" });
    expect(again.status).toBe("draft");
  });

  it("refuses a duplicate slug", async () => {
    await draft({ slug: "taken" });
    const second = await createDraft({
      slug: "taken",
      chain: "solana" as const,
      sellerWallet: SELLER,
      prizeAsset: "9x1yMDsxDs52kZ8kmDzYWiCoTfxLZDvcqcMjxLdbBnRz",
      collectionId: null,
      ticketPriceNative: 1n,
      maxTickets: 1,
      houseFeeBps: 0,
      drawSlot: 1n,
      endsAt: new Date(Date.now() + 60_000),
      ...seedPair(),
    });
    expect(second).toEqual({ ok: false, reason: "slug_taken" });
  });
});

describe("openRaffle", () => {
  it("opens a draft once both payments are proved", async () => {
    const row = await draft();
    const result = await openRaffle(row.id, {
      listingFeeSignature: "sig-listing",
      escrowSignature: "sig-escrow",
    });
    expect(result.ok).toBe(true);
    expect((await raffleById(row.id))?.status).toBe("open");
  });

  it("refuses to open a raffle twice", async () => {
    const row = await opened();
    const again = await openRaffle(row.id, {
      listingFeeSignature: "other-listing",
      escrowSignature: "other-escrow",
    });
    expect(again).toEqual({ ok: false, reason: "not_draft" });
  });

  it("refuses to reuse an escrow signature across raffles", async () => {
    // One deposit opens one raffle. Without this, a seller could point two
    // raffles at one asset by replaying the same transfer.
    const first = await opened();
    const second = await draft({ slug: "second", prizeAsset: "5x1yMDsxDs52kZ8kmDzYWiCoTfxLZDvcqcMjxLdbBnRz" });
    const result = await openRaffle(second.id, {
      listingFeeSignature: "unique-listing",
      escrowSignature: `escrow-${first.id}`,
    });
    expect(result).toEqual({ ok: false, reason: "signature_reused" });
    expect((await raffleById(second.id))?.status).toBe("draft");
  });

  it("cannot open a cancelled raffle", async () => {
    const row = await draft();
    await cancelRaffle(row.id, "withdrawn");
    const result = await openRaffle(row.id, {
      listingFeeSignature: "l",
      escrowSignature: "e",
    });
    expect(result).toEqual({ ok: false, reason: "not_draft" });
  });
});

describe("advanceRaffle — the machine derives the status", () => {
  it("closes an open raffle whose clock has run out", async () => {
    const row = await opened({ endsAt: new Date(Date.now() - 60_000) });
    const advanced = await advanceRaffle(row.id);
    expect(advanced?.status).toBe("closed");
  });

  it("closes an open raffle that sold out early", async () => {
    // Selling out is a second, independent reason to close: the clock has not
    // run out but there is nothing left to sell, and leaving it open would show
    // a buy button that can only fail.
    const row = await opened({ maxTickets: 3 });
    await sellTickets(row.id, 3);
    expect((await advanceRaffle(row.id))?.status).toBe("closed");
  });

  it("leaves an open raffle alone while it still has time and supply", async () => {
    const row = await opened({ maxTickets: 5 });
    await sellTickets(row.id, 2);
    expect((await advanceRaffle(row.id))?.status).toBe("open");
  });

  it("never moves a cancelled raffle", async () => {
    const row = await opened({ endsAt: new Date(Date.now() - 60_000) });
    await cancelRaffle(row.id, "prize withdrawn");
    expect((await advanceRaffle(row.id))?.status).toBe("cancelled");
  });

  it("never re-closes a drawn raffle", async () => {
    const row = await opened({ endsAt: new Date(Date.now() - 60_000), maxTickets: 4 });
    await sellTickets(row.id, 2);
    await advanceRaffle(row.id);
    await recordDraw(row.id, {
      drawBlockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3teA9",
      winnerWallet: OTHER_WALLET,
      winningTicket: 1,
    });
    expect((await advanceRaffle(row.id))?.status).toBe("drawn");
  });
});

describe("recordDraw", () => {
  async function closedWithTickets(count = 3) {
    const row = await opened({ endsAt: new Date(Date.now() - 60_000), maxTickets: 10 });
    await sellTickets(row.id, count);
    await advanceRaffle(row.id);
    return row;
  }

  const DRAW = {
    drawBlockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3teA9",
    winnerWallet: OTHER_WALLET,
    winningTicket: 2,
  };

  it("records the reveal and the winner together", async () => {
    const row = await closedWithTickets();
    expect((await recordDraw(row.id, DRAW)).ok).toBe(true);

    const drawn = await raffleById(row.id);
    expect(drawn?.status).toBe("drawn");
    // The published seed is the STORED one, not a value this test handed in —
    // `recordDraw` no longer takes a seed at all. Asserting that it hashes to
    // the commitment is the check that matters, and it is the same check a
    // stranger runs on the verification page.
    expect(verifyCommitment(drawn!.seed!, drawn!.seedHash)).toBe(true);
    expect(drawn?.drawBlockhash).toBe(DRAW.drawBlockhash);
    expect(drawn?.winnerWallet).toBe(OTHER_WALLET);
    expect(drawn?.winningTicket).toBe(2);
  });


  it("does not publish the seed before the draw", async () => {
    // Migration 003's whole point: `seed` is NULL until the draw, so a public
    // reader that renders it cannot leak anything whatever it does. The secret
    // lives in a column no route returns.
    const row = await opened();
    expect((await raffleById(row.id))?.seed).toBeNull();

    const stored = await queryOne<{ seed_secret: string | null }>(
      `SELECT seed_secret FROM raffles WHERE id = $1`,
      [row.id],
    );
    expect(stored?.seed_secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses to draw a raffle whose stored seed is missing", async () => {
    // A raffle whose commitment was published and whose secret was lost can
    // never be drawn honestly. Refusing here means it surfaces to an operator
    // rather than at a hash comparison on a public page.
    const row = await closedWithTickets();
    await query(`UPDATE raffles SET seed_secret = NULL WHERE id = $1`, [row.id]);
    expect(await recordDraw(row.id, DRAW)).toEqual({ ok: false, reason: "no_seed" });
  });

  it("refuses to draw a raffle that is still open", async () => {
    // Drawing early would mean a seed revealed while tickets are still for
    // sale, which lets anybody who reads it compute the winning number and buy
    // exactly that ticket.
    const row = await opened();
    expect(await recordDraw(row.id, DRAW)).toEqual({ ok: false, reason: "not_closed" });
  });

  it("refuses to draw twice", async () => {
    const row = await closedWithTickets();
    await recordDraw(row.id, DRAW);
    expect(await recordDraw(row.id, { ...DRAW, winningTicket: 1 })).toEqual({
      ok: false,
      reason: "not_closed",
    });
  });

  it("refuses a winning ticket that does not exist", async () => {
    const row = await closedWithTickets(3);
    expect(await recordDraw(row.id, { ...DRAW, winningTicket: 4 })).toEqual({
      ok: false,
      reason: "no_such_ticket",
    });
  });

  it("refuses a winner who does not hold the winning ticket", async () => {
    // The winner is derived from the ticket, so a mismatch means the caller
    // computed one thing and is writing another. Refusing here is what stops a
    // typo in an admin path from paying the wrong wallet.
    const row = await closedWithTickets(3);
    expect(await recordDraw(row.id, { ...DRAW, winnerWallet: SELLER })).toEqual({
      ok: false,
      reason: "winner_mismatch",
    });
  });

  it("refuses to draw a raffle that sold nothing", async () => {
    const row = await opened({ endsAt: new Date(Date.now() - 60_000) });
    await advanceRaffle(row.id);
    expect(await recordDraw(row.id, DRAW)).toEqual({ ok: false, reason: "no_such_ticket" });
  });
});

describe("recordPayout", () => {
  async function drawn() {
    const row = await opened({ endsAt: new Date(Date.now() - 60_000), maxTickets: 10 });
    await sellTickets(row.id, 2);
    await advanceRaffle(row.id);
    await recordDraw(row.id, {
      drawBlockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3teA9",
      winnerWallet: OTHER_WALLET,
      winningTicket: 1,
    });
    return row;
  }

  it("marks paid only with both legs of evidence", async () => {
    const row = await drawn();
    const result = await recordPayout(row.id, {
      prizeSignature: "prize-sig",
      proceedsSignature: "proceeds-sig",
    });
    expect(result.ok).toBe(true);

    const paid = await raffleById(row.id);
    expect(paid?.status).toBe("paid");
    expect(paid?.prizeSignature).toBe("prize-sig");
    expect(paid?.proceedsSignature).toBe("proceeds-sig");
  });

  it("refuses to pay a raffle that has not been drawn", async () => {
    const row = await opened();
    expect(await recordPayout(row.id, { prizeSignature: "a", proceedsSignature: "b" })).toEqual({
      ok: false,
      reason: "not_drawn",
    });
  });

  it("refuses to pay twice", async () => {
    const row = await drawn();
    await recordPayout(row.id, { prizeSignature: "p", proceedsSignature: "q" });
    expect(await recordPayout(row.id, { prizeSignature: "x", proceedsSignature: "y" })).toEqual({
      ok: false,
      reason: "not_drawn",
    });
  });
});

describe("cancelRaffle", () => {
  it("records the reason, because the public page shows it", async () => {
    const row = await opened();
    expect((await cancelRaffle(row.id, "prize could not be verified")).ok).toBe(true);
    const cancelled = await raffleById(row.id);
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.cancelledReason).toBe("prize could not be verified");
  });

  it("refuses an empty reason", async () => {
    // A cancellation with no reason is a page that says a raffle ended and
    // cannot say why, to people who paid for tickets.
    const row = await opened();
    expect(await cancelRaffle(row.id, "   ")).toEqual({ ok: false, reason: "reason_required" });
  });

  it("cannot cancel a raffle that has already paid out", async () => {
    const row = await opened({ endsAt: new Date(Date.now() - 60_000), maxTickets: 10 });
    await sellTickets(row.id, 1);
    await advanceRaffle(row.id);
    await recordDraw(row.id, {
      drawBlockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3teA9",
      winnerWallet: OTHER_WALLET,
      winningTicket: 1,
    });
    await recordPayout(row.id, { prizeSignature: "p", proceedsSignature: "q" });
    expect(await cancelRaffle(row.id, "too late")).toEqual({ ok: false, reason: "already_paid" });
  });
});

describe("raffleBySlug", () => {
  it("finds a raffle by the slug its URL uses", async () => {
    const row = await draft({ slug: "a-readable-slug" });
    expect((await raffleBySlug("a-readable-slug"))?.id).toBe(row.id);
  });

  it("returns null rather than throwing for an unknown slug", async () => {
    expect(await raffleBySlug("no-such-raffle")).toBeNull();
  });
});

describe("the schema refuses states the code should never write", () => {
  it("will not accept a drawn raffle with no revealed seed", async () => {
    // The belt to the code's braces. If a future route reaches for a bare
    // UPDATE instead of a transition, this constraint is what stops a winner
    // being published with no way to check where it came from.
    const row = await opened();
    await expect(
      queryOne(`UPDATE raffles SET status = 'drawn' WHERE id = $1 RETURNING id`, [row.id]),
    ).rejects.toThrow(/raffles_drawn_is_revealed/);
  });

  it("will not accept a cancelled raffle with no reason", async () => {
    const row = await opened();
    await expect(
      queryOne(`UPDATE raffles SET status = 'cancelled' WHERE id = $1 RETURNING id`, [row.id]),
    ).rejects.toThrow(/raffles_cancelled_has_reason/);
  });

  it("will not accept an open raffle with no escrow behind it", async () => {
    const row = await draft();
    await expect(
      queryOne(`UPDATE raffles SET status = 'open' WHERE id = $1 RETURNING id`, [row.id]),
    ).rejects.toThrow(/raffles_open_is_escrowed/);
  });
});

describe("cancelRaffleAsSeller", () => {
  /**
   * The owner's answer to open question Q3: a seller may withdraw their own
   * raffle, but only while nobody has bought into it.
   *
   * The bound is what makes the permission safe to grant. Refunds are manual,
   * from a wallet this codebase cannot reach, so a seller who could cancel
   * after tickets sold would be making a promise about somebody else's labour —
   * ours — to people who already paid.
   */
  it("lets a seller withdraw a raffle nobody has entered", async () => {
    const row = await opened();
    const result = await cancelRaffleAsSeller(row.id, SELLER, "changed my mind");
    expect(result.ok).toBe(true);
    expect((await raffleById(row.id))?.status).toBe("cancelled");
  });

  it("refuses once a single ticket has sold", async () => {
    const row = await opened();
    await sellTickets(row.id, 1);
    expect(await cancelRaffleAsSeller(row.id, SELLER, "changed my mind")).toEqual({
      ok: false,
      reason: "tickets_sold",
    });
    expect((await raffleById(row.id))?.status).toBe("open");
  });

  it("refuses somebody who is not the seller", async () => {
    // The seller wallet is the one the draft was created with and the one the
    // escrow deposit had to come from. Anyone else cancelling would be
    // withdrawing an asset they never deposited.
    const row = await opened();
    expect(await cancelRaffleAsSeller(row.id, OTHER_WALLET, "not mine")).toEqual({
      ok: false,
      reason: "not_seller",
    });
    expect((await raffleById(row.id))?.status).toBe("open");
  });

  it("can withdraw a draft, before anything was deposited", async () => {
    const row = await draft();
    expect((await cancelRaffleAsSeller(row.id, SELLER, "wrong asset")).ok).toBe(true);
  });

  it("still requires a reason", async () => {
    const row = await opened();
    expect(await cancelRaffleAsSeller(row.id, SELLER, "  ")).toEqual({
      ok: false,
      reason: "reason_required",
    });
  });

  it("cannot touch a raffle that has already paid out", async () => {
    const row = await opened({ endsAt: new Date(Date.now() - 60_000), maxTickets: 10 });
    await sellTickets(row.id, 1);
    await advanceRaffle(row.id);
    await recordDraw(row.id, {
      drawBlockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3teA9",
      winnerWallet: OTHER_WALLET,
      winningTicket: 1,
    });
    await recordPayout(row.id, { prizeSignature: "p", proceedsSignature: "q" });
    // `already_paid` rather than `tickets_sold`. A paid raffle satisfies both
    // conditions, so the order decides the message — and "this already paid
    // out" tells the seller what actually happened, where "tickets were sold"
    // would send them looking for a refund path that is not the issue.
    expect(await cancelRaffleAsSeller(row.id, SELLER, "too late")).toEqual({
      ok: false,
      reason: "already_paid",
    });
  });

  it("is not the operator's path — an operator may still cancel a sold raffle", async () => {
    // Two entry points, two authorisations, one transition. The operator can
    // cancel a raffle with tickets sold because refunding them is work the
    // operator is signing up for; a seller cannot volunteer that work.
    const row = await opened();
    await sellTickets(row.id, 2);
    expect((await cancelRaffle(row.id, "prize could not be verified")).ok).toBe(true);
  });
});
