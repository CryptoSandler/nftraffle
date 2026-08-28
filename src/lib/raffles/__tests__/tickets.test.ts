import { describe, expect, it } from "vitest";
import { query } from "../../db";
import type { SolTransferResult } from "../../payments/sol-transfer";
import { commitSeed } from "../draw";
import { createDraft, openRaffle, raffleById } from "../lifecycle";
import {
  createTicketOrder,
  orderById,
  settleTicketOrder,
  ticketsFor,
  ticketsSold,
  walletTicketCount,
} from "../tickets";

/**
 * The money path.
 *
 * This is the one file where a mistake costs somebody real SOL in either
 * direction — a false settle hands out tickets for nothing, a failed settle
 * takes a payment and credits no one. Every test below is a scenario that
 * produces one of those two outcomes if the code is wrong.
 */

const BUYER = "6dNVEXCsBpisPjcyanBz4qgpm2SXPkR7wRPmuA6cxRLW";
const OTHER = "3Nq7EtQe3aUZLxRUkzYq9c6DdShxWFRp3wY4qWCTGVAH";
const SELLER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const WALLET = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const PRICE = 100_000_000n;

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


async function openRaffleFixture(maxTickets = 10) {
  counter += 1;
  const created = await createDraft({
    slug: `tickets-${counter}`,
    sellerWallet: SELLER,
    prizeMint: `mint-${counter}`,
    collectionId: null,
    ticketPriceLamports: PRICE,
    maxTickets,
    houseFeeBps: 500,
    drawSlot: 400_000_000n + BigInt(counter),
    endsAt: new Date(Date.now() + 60 * 60_000),
    ...seedPair(),
  });
  if (!created.ok) throw new Error(created.reason);
  const opened = await openRaffle(created.raffle.id, {
    listingFeeSignature: `l-${counter}`,
    escrowSignature: `e-${counter}`,
  });
  if (!opened.ok) throw new Error(opened.reason);
  return opened.raffle;
}

/** A verifier that answers however a test needs, without a network. */
function verifier(result: SolTransferResult) {
  return async () => result;
}

const paid = (lamports: bigint, payer = BUYER): SolTransferResult => ({
  ok: true,
  payer,
  lamports,
  blockTimeMs: Date.now(),
});

async function order(raffleId: string, quantity = 1, payer = BUYER) {
  const result = await createTicketOrder({
    raffleId,
    quantity,
    payerPubkey: payer,
    ipHash: "ip-hash",
  });
  if (!result.ok) throw new Error(result.reason);
  return result.order;
}

describe("createTicketOrder", () => {
  it("prices the order from the raffle, never from the caller", async () => {
    // The caller says how many, never how much. A quantity is a request; a
    // price is a fact the raffle owns.
    const raffle = await openRaffleFixture();
    const row = await order(raffle.id, 3);
    expect(row.amountLamports).toBe(PRICE * 3n);
  });

  it("mints a unique reference per order", async () => {
    const raffle = await openRaffleFixture();
    const a = await order(raffle.id);
    const b = await order(raffle.id);
    expect(a.referencePubkey).not.toBe(b.referencePubkey);
    expect(a.referencePubkey).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it("refuses an order on a raffle that is not open", async () => {
    const created = await createDraft({
      slug: "not-open-yet",
      sellerWallet: SELLER,
      prizeMint: "mint-draft",
      collectionId: null,
      ticketPriceLamports: PRICE,
      maxTickets: 5,
      houseFeeBps: 0,
      drawSlot: 1n,
      endsAt: new Date(Date.now() + 60_000),
      ...seedPair(),
    });
    if (!created.ok) throw new Error(created.reason);
    expect(await createTicketOrder({
      raffleId: created.raffle.id,
      quantity: 1,
      payerPubkey: BUYER,
      ipHash: null,
    })).toEqual({ ok: false, reason: "not_open" });
  });

  it("refuses to sell more tickets than remain", async () => {
    const raffle = await openRaffleFixture(3);
    expect(await createTicketOrder({
      raffleId: raffle.id,
      quantity: 4,
      payerPubkey: BUYER,
      ipHash: null,
    })).toEqual({ ok: false, reason: "not_enough_tickets" });
  });

  it("counts SOLD tickets, not pending orders, against the supply", async () => {
    // A pending order holds nothing: it may never be paid, and reserving supply
    // for it would let anyone take a raffle off the market for free by opening
    // orders they never pay.
    const raffle = await openRaffleFixture(2);
    await order(raffle.id, 2);
    const second = await createTicketOrder({
      raffleId: raffle.id,
      quantity: 2,
      payerPubkey: OTHER,
      ipHash: null,
    });
    expect(second.ok).toBe(true);
  });

  it("refuses a non-positive or absurd quantity", async () => {
    const raffle = await openRaffleFixture();
    for (const quantity of [0, -1, 1.5, Number.NaN]) {
      expect(
        (await createTicketOrder({ raffleId: raffle.id, quantity, payerPubkey: BUYER, ipHash: null })).ok,
        `quantity=${quantity}`,
      ).toBe(false);
    }
  });
});

describe("settleTicketOrder", () => {
  it("issues tickets and marks the order paid, together", async () => {
    const raffle = await openRaffleFixture();
    const row = await order(raffle.id, 2);

    const result = await settleTicketOrder({
      orderId: row.id,
      signature: "sig-a",
      paymentWallet: WALLET,
      verify: verifier(paid(PRICE * 2n)),
    });

    expect(result).toMatchObject({ ok: true, ticketNumbers: [1, 2] });
    expect((await orderById(row.id))?.status).toBe("paid");
    expect(await ticketsSold(raffle.id)).toBe(2);
  });

  it("allocates ticket numbers contiguously from 1 across orders", async () => {
    // The draw indexes into 1..n. A gap or a repeat is a winner nobody holds.
    const raffle = await openRaffleFixture();
    const first = await order(raffle.id, 2);
    const second = await order(raffle.id, 3, OTHER);

    await settleTicketOrder({
      orderId: first.id, signature: "s1", paymentWallet: WALLET, verify: verifier(paid(PRICE * 2n)),
    });
    await settleTicketOrder({
      orderId: second.id, signature: "s2", paymentWallet: WALLET, verify: verifier(paid(PRICE * 3n, OTHER)),
    });

    const tickets = await ticketsFor(raffle.id);
    expect(tickets.map((t) => t.number)).toEqual([1, 2, 3, 4, 5]);
    expect(tickets.map((t) => t.wallet)).toEqual([BUYER, BUYER, OTHER, OTHER, OTHER]);
  });

  it("issues NOTHING when the payment does not verify", async () => {
    const raffle = await openRaffleFixture();
    const row = await order(raffle.id, 2);

    const result = await settleTicketOrder({
      orderId: row.id,
      signature: "sig-bad",
      paymentWallet: WALLET,
      verify: verifier({ ok: false, reason: "insufficient_amount", message: "too little" }),
    });

    expect(result).toMatchObject({ ok: false, reason: "insufficient_amount" });
    expect(await ticketsSold(raffle.id)).toBe(0);
    // `failed`, not `pending`: an underpayment cannot be topped up, because a
    // payment is one transaction and this one is permanently too small. The
    // payer starts a new order. Only the transient reasons stay pending — the
    // test below covers that half.
    expect((await orderById(row.id))?.status).toBe("failed");
  });

  it("leaves a retryable failure pending so the payer can try again", async () => {
    // `not_found` means "not on chain YET" as often as it means "never was".
    // Failing the order permanently on it would strand somebody who paid and
    // checked a second too early.
    const raffle = await openRaffleFixture();
    const row = await order(raffle.id);
    await settleTicketOrder({
      orderId: row.id,
      signature: "sig-early",
      paymentWallet: WALLET,
      verify: verifier({ ok: false, reason: "not_found", message: "not yet" }),
    });
    expect((await orderById(row.id))?.status).toBe("pending");

    const retry = await settleTicketOrder({
      orderId: row.id, signature: "sig-early", paymentWallet: WALLET, verify: verifier(paid(PRICE)),
    });
    expect(retry.ok).toBe(true);
  });

  it("refuses a signature already spent on another order", async () => {
    const raffle = await openRaffleFixture();
    const first = await order(raffle.id);
    const second = await order(raffle.id, 1, OTHER);

    await settleTicketOrder({
      orderId: first.id, signature: "shared", paymentWallet: WALLET, verify: verifier(paid(PRICE)),
    });
    const result = await settleTicketOrder({
      orderId: second.id, signature: "shared", paymentWallet: WALLET, verify: verifier(paid(PRICE, OTHER)),
    });

    expect(result).toMatchObject({ ok: false, reason: "signature_reused" });
    expect(await ticketsSold(raffle.id)).toBe(1);
  });

  it("binds the payment to the wallet the order was opened with", async () => {
    // Without this, anyone watching the chain could take a stranger's transfer
    // and claim it against their own order.
    const raffle = await openRaffleFixture();
    const row = await order(raffle.id);
    let sawExpectedPayer: string | null | undefined;

    await settleTicketOrder({
      orderId: row.id,
      signature: "sig-payer",
      paymentWallet: WALLET,
      verify: async (input) => {
        sawExpectedPayer = input.expectedPayer;
        return paid(PRICE);
      },
    });

    expect(sawExpectedPayer).toBe(BUYER);
  });

  it("passes the order's own window to the verifier", async () => {
    // A transfer made before the order existed cannot pay for it, however well
    // the amount matches.
    const raffle = await openRaffleFixture();
    const row = await order(raffle.id);
    let sawWindow: { fromMs: number; toMs: number } | undefined;

    await settleTicketOrder({
      orderId: row.id,
      signature: "sig-window",
      paymentWallet: WALLET,
      verify: async (input) => {
        sawWindow = input.window;
        return paid(PRICE);
      },
    });

    expect(sawWindow?.fromMs).toBe(row.createdAt.getTime());
    expect(sawWindow?.toMs).toBe(row.expiresAt.getTime());
  });

  it("requires at least the full price, and accepts a surplus", async () => {
    const raffle = await openRaffleFixture();
    const row = await order(raffle.id, 2);
    let asked: bigint | undefined;

    const result = await settleTicketOrder({
      orderId: row.id,
      signature: "sig-over",
      paymentWallet: WALLET,
      verify: async (input) => {
        asked = input.minLamports;
        return paid(PRICE * 3n);
      },
    });

    expect(asked).toBe(PRICE * 2n);
    expect(result.ok).toBe(true);
  });

  it("refuses to settle an order twice", async () => {
    const raffle = await openRaffleFixture();
    const row = await order(raffle.id);
    await settleTicketOrder({
      orderId: row.id, signature: "sig-1", paymentWallet: WALLET, verify: verifier(paid(PRICE)),
    });
    const again = await settleTicketOrder({
      orderId: row.id, signature: "sig-2", paymentWallet: WALLET, verify: verifier(paid(PRICE)),
    });
    expect(again).toMatchObject({ ok: false, reason: "already_settled" });
    expect(await ticketsSold(raffle.id)).toBe(1);
  });

  it("refuses to settle an expired order", async () => {
    const raffle = await openRaffleFixture();
    const row = await order(raffle.id);
    // Both timestamps move: `ticket_orders_check` enforces expires_at >
    // created_at, so an order cannot be aged by pulling its expiry back alone.
    // That constraint firing here is the schema doing its job.
    await query(
      `UPDATE ticket_orders
          SET created_at = now() - interval '2 hours',
              expires_at = now() - interval '1 minute'
        WHERE id = $1`,
      [row.id],
    );
    const result = await settleTicketOrder({
      orderId: row.id, signature: "sig-late", paymentWallet: WALLET, verify: verifier(paid(PRICE)),
    });
    expect(result).toMatchObject({ ok: false, reason: "expired" });
  });

  it("cannot oversell the raffle even when an order was opened while supply lasted", async () => {
    // The check at order time is advisory — supply can be taken by somebody
    // else before this order pays. The check that actually protects the raffle
    // is this one, inside the settling transaction, under a lock on the row.
    const raffle = await openRaffleFixture(2);
    const first = await order(raffle.id, 2);
    const second = await order(raffle.id, 2, OTHER);

    await settleTicketOrder({
      orderId: first.id, signature: "sold-out", paymentWallet: WALLET, verify: verifier(paid(PRICE * 2n)),
    });
    const late = await settleTicketOrder({
      orderId: second.id, signature: "too-late", paymentWallet: WALLET, verify: verifier(paid(PRICE * 2n, OTHER)),
    });

    expect(late).toMatchObject({ ok: false, reason: "sold_out" });
    expect(await ticketsSold(raffle.id)).toBe(2);
  });

  it("files a real payment that arrived but could not be applied", async () => {
    // The money reached our wallet. Whatever happens to the tickets, there must
    // be a record an operator can work from — the alternative is somebody's SOL
    // vanishing with nothing to show it ever arrived.
    const raffle = await openRaffleFixture(1);
    const first = await order(raffle.id, 1);
    const second = await order(raffle.id, 1, OTHER);
    await settleTicketOrder({
      orderId: first.id, signature: "ok-sig", paymentWallet: WALLET, verify: verifier(paid(PRICE)),
    });
    await settleTicketOrder({
      orderId: second.id, signature: "orphan-sig", paymentWallet: WALLET, verify: verifier(paid(PRICE, OTHER)),
    });

    const filed = await query<{ signature: string; sender_pubkey: string; received_lamports: string }>(
      `SELECT signature, sender_pubkey, received_lamports FROM unmatched_payments`,
    );
    expect(filed).toHaveLength(1);
    expect(filed[0].signature).toBe("orphan-sig");
    expect(filed[0].sender_pubkey).toBe(OTHER);
    expect(BigInt(filed[0].received_lamports)).toBe(PRICE);
  });

  it("does not file a payment that never reached us", async () => {
    const raffle = await openRaffleFixture();
    const row = await order(raffle.id);
    await settleTicketOrder({
      orderId: row.id,
      signature: "never-arrived",
      paymentWallet: WALLET,
      verify: verifier({ ok: false, reason: "no_transfer", message: "nothing" }),
    });
    expect(await query(`SELECT 1 FROM unmatched_payments`)).toHaveLength(0);
  });

  it("closes the raffle when the last ticket is sold", async () => {
    const raffle = await openRaffleFixture(2);
    const row = await order(raffle.id, 2);
    await settleTicketOrder({
      orderId: row.id, signature: "final", paymentWallet: WALLET, verify: verifier(paid(PRICE * 2n)),
    });
    expect((await raffleById(raffle.id))?.status).toBe("closed");
  });
});

describe("walletTicketCount", () => {
  it("counts what one wallet holds, which is the only odds figure copy may quote", async () => {
    const raffle = await openRaffleFixture();
    const mine = await order(raffle.id, 3);
    const theirs = await order(raffle.id, 1, OTHER);
    await settleTicketOrder({
      orderId: mine.id, signature: "m", paymentWallet: WALLET, verify: verifier(paid(PRICE * 3n)),
    });
    await settleTicketOrder({
      orderId: theirs.id, signature: "t", paymentWallet: WALLET, verify: verifier(paid(PRICE, OTHER)),
    });

    expect(await walletTicketCount(raffle.id, BUYER)).toBe(3);
    expect(await walletTicketCount(raffle.id, OTHER)).toBe(1);
    expect(await ticketsSold(raffle.id)).toBe(4);
  });
});
