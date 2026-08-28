import { describe, expect, it } from "vitest";
import { query } from "../../db";
import { commitSeed } from "../draw";
import { advanceRaffle, createDraft, openRaffle, recordDraw } from "../lifecycle";
import { drawQueue, liveRaffles, payoutQueue } from "../listing";
import { payoutSplit } from "../payout";

const SELLER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const BUYER = "3Nq7EtQe3aUZLxRUkzYq9c6DdShxWFRp3wY4qWCTGVAH";

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


async function raffle(overrides: Partial<Parameters<typeof createDraft>[0]> = {}) {
  counter += 1;
  const created = await createDraft({
    slug: `listing-${counter}`,
    sellerWallet: SELLER,
    prizeMint: `listmint-${counter}`,
    collectionId: null,
    ticketPriceLamports: 100_000_000n,
    maxTickets: 10,
    houseFeeBps: 500,
    drawSlot: 500_000_000n + BigInt(counter),
    endsAt: new Date(Date.now() + 3600_000),
    ...seedPair(),
    ...overrides,
  });
  if (!created.ok) throw new Error(created.reason);
  return created.raffle;
}

async function sell(raffleId: string, count: number) {
  const orderId = `lo-${raffleId}`;
  await query(
    `INSERT INTO ticket_orders
       (id, raffle_id, quantity, amount_lamports, payer_pubkey, reference_pubkey, status,
        expires_at, paid_at)
     VALUES ($1,$2,$3,$4,$5,$6,'paid', now() + interval '1 hour', now())`,
    [orderId, raffleId, count, 100_000_000n * BigInt(count), BUYER, `lr-${orderId}`],
  );
  for (let n = 1; n <= count; n++) {
    await query(`INSERT INTO tickets (raffle_id, number, order_id, wallet) VALUES ($1,$2,$3,$4)`, [
      raffleId,
      n,
      orderId,
      BUYER,
    ]);
  }
}

describe("liveRaffles", () => {
  it("hides drafts, because a draft has no prize in escrow", async () => {
    // Listing one would advertise a raffle for an asset nobody has deposited.
    await raffle();
    expect(await liveRaffles()).toHaveLength(0);
  });

  it("lists an open raffle", async () => {
    const row = await raffle();
    await openRaffle(row.id, { listingFeeSignature: "lf", escrowSignature: "es" });
    const listed = await liveRaffles();
    expect(listed.map((r) => r.slug)).toEqual([row.slug]);
  });

  it("puts open raffles ahead of finished ones", async () => {
    const finished = await raffle({ slug: "finished", endsAt: new Date(Date.now() - 60_000) });
    await openRaffle(finished.id, { listingFeeSignature: "lf1", escrowSignature: "es1" });
    await advanceRaffle(finished.id);

    const live = await raffle({ slug: "still-open" });
    await openRaffle(live.id, { listingFeeSignature: "lf2", escrowSignature: "es2" });

    expect((await liveRaffles())[0].slug).toBe("still-open");
  });
});

describe("the payout queue carries what an operator has to send", () => {
  it("carries the raffle's OWN house fee, so the seller's net is right", async () => {
    /**
     * THE BUG THIS TEST EXISTS FOR. The queue screen used to compute the split
     * with a hardcoded `houseFeeBps: 0`, because the summary type did not carry
     * the fee. The figures rendered were the GROSS under a label saying what to
     * send the seller — so an operator following the screen would have
     * overpaid every seller by the platform's entire cut, from a wallet whose
     * key this codebase cannot reach and with no way to claw it back.
     *
     * Falsify it by putting 0 back in the summary: the split below becomes the
     * gross and this fails.
     */
    // `endsAt` in the past so `advanceRaffle` really closes it. The first
    // draft of this test left it open, `recordDraw` correctly refused, and the
    // queue was empty — a fixture failing quietly is exactly what an unchecked
    // result hides, so both results are asserted below.
    const row = await raffle({ houseFeeBps: 500, endsAt: new Date(Date.now() - 60_000) });
    await openRaffle(row.id, { listingFeeSignature: "lf3", escrowSignature: "es3" });
    await sell(row.id, 4);
    expect((await advanceRaffle(row.id))?.status).toBe("closed");
    expect(
      (
        await recordDraw(row.id, {
          drawBlockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3teA9",
          winnerWallet: BUYER,
          winningTicket: 1,
        })
      ).ok,
    ).toBe(true);

    const [queued] = await payoutQueue();
    expect(queued.houseFeeBps).toBe(500);

    const split = payoutSplit({
      ticketPriceLamports: queued.ticketPriceLamports,
      ticketsSold: queued.ticketsSold,
      houseFeeBps: queued.houseFeeBps,
    });
    expect(split.grossLamports).toBe(400_000_000n);
    expect(split.sellerNetLamports).toBe(380_000_000n);
    expect(split.sellerNetLamports).not.toBe(split.grossLamports);
  });

  it("carries the winner, so the queue can say where the prize goes", async () => {
    const row = await raffle({ endsAt: new Date(Date.now() - 60_000) });
    await openRaffle(row.id, { listingFeeSignature: "lf4", escrowSignature: "es4" });
    await sell(row.id, 2);
    await advanceRaffle(row.id);
    expect(
      (
        await recordDraw(row.id, {
          drawBlockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3teA9",
          winnerWallet: BUYER,
          winningTicket: 2,
        })
      ).ok,
    ).toBe(true);

    expect((await payoutQueue())[0].winnerWallet).toBe(BUYER);
  });

  it("holds only drawn raffles, and the draw queue only closed ones", async () => {
    const closed = await raffle({ slug: "awaiting-draw", endsAt: new Date(Date.now() - 60_000) });
    await openRaffle(closed.id, { listingFeeSignature: "lf5", escrowSignature: "es5" });
    await sell(closed.id, 1);
    await advanceRaffle(closed.id);

    expect((await drawQueue()).map((r) => r.slug)).toEqual(["awaiting-draw"]);
    expect(await payoutQueue()).toHaveLength(0);
  });
});
