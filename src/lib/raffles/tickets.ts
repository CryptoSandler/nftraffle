import { randomUUID } from "node:crypto";
import type { ChainId } from "../chain/adapter";
import { isUniqueViolation, query, queryOne, transaction } from "../db";
import { PAYMENT_WINDOW_MINUTES } from "../payments/config";
import type {
  NativeTransferFailure,
  NativeTransferResult,
} from "../payments/native-transfer";

/**
 * Ticket orders and settlement: the step where a chain's native currency
 * becomes tickets.
 *
 * This is the one module in the project where a mistake costs somebody real
 * money in either direction — a false settle hands out tickets for nothing, and
 * a failed settle takes a payment and credits no one. Every branch below either
 * commits the whole settlement (signature claimed + order paid + tickets
 * issued) or leaves all three untouched. There is no state in between.
 *
 * WHO CALLS THIS: `createTicketOrder` from `POST /api/raffles/[slug]/orders`;
 * `settleTicketOrder` from `POST /api/orders/[id]/confirm`; `ticketsFor` from
 * `raffles/payout.ts` and the public verification page; `ticketsSold` and
 * `walletTicketCount` from the raffle page.
 */

export type TicketOrderStatus = "pending" | "paid" | "expired" | "failed";

export type TicketOrder = {
  id: string;
  raffleId: string;
  /** Copied from the raffle at creation; the FK in migration 004 keeps them equal. */
  chain: ChainId;
  quantity: number;
  amountNative: bigint;
  payerPubkey: string;
  /** Solana Pay's reference. Null on chains with no such convention. */
  referencePubkey: string | null;
  status: TicketOrderStatus;
  failureReason: string | null;
  createdAt: Date;
  expiresAt: Date;
  paidAt: Date | null;
};

type OrderRow = {
  id: string;
  raffle_id: string;
  chain: ChainId;
  quantity: number;
  amount_native: string;
  payer_pubkey: string;
  reference_pubkey: string | null;
  status: TicketOrderStatus;
  failure_reason: string | null;
  created_at: Date;
  expires_at: Date;
  paid_at: Date | null;
};

const ORDER_COLUMNS = `id, raffle_id, chain, quantity, amount_native, payer_pubkey, reference_pubkey,
  status, failure_reason, created_at, expires_at, paid_at`;

function toOrder(row: OrderRow): TicketOrder {
  return {
    id: row.id,
    raffleId: row.raffle_id,
    chain: row.chain,
    quantity: row.quantity,
    amountNative: BigInt(row.amount_native),
    payerPubkey: row.payer_pubkey,
    referencePubkey: row.reference_pubkey,
    status: row.status,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
  };
}

export async function orderById(id: string): Promise<TicketOrder | null> {
  const row = await queryOne<OrderRow>(
    `SELECT ${ORDER_COLUMNS} FROM ticket_orders WHERE id = $1`,
    [id],
  );
  return row ? toOrder(row) : null;
}

// --- Creating an order -------------------------------------------------------

export type CreateOrderResult =
  | { ok: true; order: TicketOrder }
  | {
      ok: false;
      reason: "not_found" | "not_open" | "not_enough_tickets" | "bad_quantity";
    };

/**
 * Opens an order at the raffle's price.
 *
 * **The caller says how many, never how much.** A quantity is a request; a
 * price is a fact the raffle owns, and reading it here rather than trusting a
 * body is the difference between a fixed price and a price anybody can set.
 *
 * The supply check here counts SOLD tickets, not pending orders. Reserving
 * supply for an unpaid order would let anyone take a raffle off the market for
 * free by opening orders they never pay — so this check is advisory, and the
 * one that actually protects the supply runs inside `settleTicketOrder` under a
 * lock on the raffle row.
 */
export async function createTicketOrder(input: {
  raffleId: string;
  quantity: number;
  payerPubkey: string;
  ipHash: string | null;
  /**
   * The chain this raffle settles on, and its per-order reference.
   *
   * Both come from the caller rather than being read here, because this module
   * must not import an adapter: `chain/adapter.ts` imports this file's sibling
   * `escrow.ts` for a type, and a direct import back would be a cycle. The
   * route holds the adapter and passes down the two values it produces.
   */
  chain: ChainId;
  reference: string | null;
}): Promise<CreateOrderResult> {
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 10_000) {
    return { ok: false, reason: "bad_quantity" };
  }

  const raffle = await queryOne<{
    status: string;
    ticket_price_native: string;
    max_tickets: number;
    sold: string;
  }>(
    `SELECT r.status, r.ticket_price_native, r.max_tickets,
            (SELECT count(*) FROM tickets t WHERE t.raffle_id = r.id) AS sold
       FROM raffles r WHERE r.id = $1`,
    [input.raffleId],
  );
  if (!raffle) return { ok: false, reason: "not_found" };
  if (raffle.status !== "open") return { ok: false, reason: "not_open" };

  const remaining = raffle.max_tickets - Number(raffle.sold);
  if (input.quantity > remaining) return { ok: false, reason: "not_enough_tickets" };

  const amount = BigInt(raffle.ticket_price_native) * BigInt(input.quantity);
  const row = await queryOne<OrderRow>(
    `INSERT INTO ticket_orders
       (id, raffle_id, quantity, amount_native, payer_pubkey, reference_pubkey, ip_hash,
        expires_at, chain)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' minutes')::interval, $9)
     RETURNING ${ORDER_COLUMNS}`,
    [
      `to_${randomUUID().replaceAll("-", "")}`,
      input.raffleId,
      input.quantity,
      amount.toString(),
      input.payerPubkey,
      input.reference,
      input.ipHash,
      String(PAYMENT_WINDOW_MINUTES),
      input.chain,
    ],
  );
  return { ok: true, order: toOrder(row!) };
}

// --- Settling ----------------------------------------------------------------

export type SettleFailure =
  | NativeTransferFailure
  | "not_found"
  | "already_settled"
  | "expired"
  | "signature_reused"
  | "sold_out";

export type SettleResult =
  | { ok: true; ticketNumbers: number[] }
  | { ok: false; reason: SettleFailure; message: string };

/**
 * Which verification failures are worth another attempt.
 *
 * Only the ones that can change on their own. A wrong amount or a wrong payer
 * will still be wrong in five seconds, and every attempt spends the order's
 * verification quota — so a permanent failure fails the order, and a transient
 * one leaves it pending for the payer who checked a second too early.
 */
const RETRYABLE: ReadonlySet<string> = new Set([
  "not_found",
  "no_block_time",
  "rpc_unavailable",
]);

/**
 * Whether a failed verification nonetheless means real money reached our wallet.
 *
 * Only these. A transfer that never touched our wallet has nothing to file and
 * no sender worth recording; filing it would put rows in the operator's queue
 * for money nobody ever sent us.
 */
const MONEY_ARRIVED: ReadonlySet<string> = new Set([
  "insufficient_amount",
  "outside_window",
  "wrong_payer",
]);

/** The verifier, injected so settlement can be tested without a network. */
export type TicketVerifier = (input: {
  signature: string;
  recipient: string;
  minAmount: bigint;
  expectedPayer: string;
  window: { fromMs: number; toMs: number };
}) => Promise<NativeTransferResult>;

/**
 * Turns a verified payment into tickets, atomically.
 *
 * **The order of operations is the design.** Verification happens OUTSIDE the
 * transaction, because it is a network call and holding a row lock across one
 * would serialise every buyer behind the slowest RPC response. Everything that
 * follows — claiming the signature, marking the order, allocating numbers —
 * happens inside one transaction under `SELECT ... FOR UPDATE` on the raffle,
 * which is what makes two concurrent confirmations unable to take the same
 * ticket number or together exceed the supply.
 *
 * **The supply check inside the lock is not a duplicate of the one in
 * `createTicketOrder`.** That one is advisory and can be stale by the time the
 * payer signs; this one is the one that actually holds. A payment that arrives
 * after the raffle sold out is real money with no seat to land in, so it is
 * filed to `unmatched_payments` rather than refused into the void.
 */
export async function settleTicketOrder(input: {
  orderId: string;
  signature: string;
  paymentWallet: string;
  verify: TicketVerifier;
}): Promise<SettleResult> {
  const order = await orderById(input.orderId);
  if (!order) return { ok: false, reason: "not_found", message: "No such order." };
  if (order.status === "paid") {
    return { ok: false, reason: "already_settled", message: "This order is already paid." };
  }
  if (order.status !== "pending") {
    return { ok: false, reason: "already_settled", message: "This order can no longer be paid." };
  }
  if (order.expiresAt.getTime() <= Date.now()) {
    await query(`UPDATE ticket_orders SET status = 'expired' WHERE id = $1 AND status = 'pending'`, [
      order.id,
    ]);
    return {
      ok: false,
      reason: "expired",
      message: "This order expired before it was paid. Start a new one.",
    };
  }

  const verdict = await input.verify({
    signature: input.signature,
    recipient: input.paymentWallet,
    minAmount: order.amountNative,
    expectedPayer: order.payerPubkey,
    window: { fromMs: order.createdAt.getTime(), toMs: order.expiresAt.getTime() },
  });

  if (!verdict.ok) {
    if (MONEY_ARRIVED.has(verdict.reason)) {
      await fileUnmatched({
        signature: input.signature,
        subjectId: order.id,
        receivedLamports: 0n,
        expectedLamports: order.amountNative,
        senderPubkey: null,
        reason: verdict.reason,
      });
    }
    if (!RETRYABLE.has(verdict.reason)) {
      await query(
        `UPDATE ticket_orders SET status = 'failed', failure_reason = $2
          WHERE id = $1 AND status = 'pending'`,
        [order.id, verdict.reason],
      );
    }
    return { ok: false, reason: verdict.reason, message: verdict.message };
  }

  return transaction(async (client) => {
    // Claim the signature first. It is the guarantee that one payment buys one
    // thing, and it is a PRIMARY KEY rather than a SELECT-then-INSERT that two
    // concurrent callers would both pass.
    try {
      await client.query(
        `INSERT INTO consumed_signatures (signature, purpose, subject_id) VALUES ($1,'ticket',$2)`,
        [input.signature, order.id],
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // The usual cause is benign: a dropped response to a confirm that
      // actually settled, so the retry posted a signature we had already spent.
      return {
        ok: false as const,
        reason: "signature_reused" as const,
        message: "That transaction has already been used to pay for an order.",
      };
    }

    // The lock that makes the rest of this correct under concurrency.
    const raffle = await client.query<{ max_tickets: number; sold: string }>(
      `SELECT r.max_tickets,
              (SELECT count(*) FROM tickets t WHERE t.raffle_id = r.id) AS sold
         FROM raffles r WHERE r.id = $1 FOR UPDATE`,
      [order.raffleId],
    );
    const sold = Number(raffle.rows[0].sold);
    const remaining = raffle.rows[0].max_tickets - sold;

    if (remaining < order.quantity) {
      // Real money, no seat. Filed inside this transaction so the record and
      // the signature claim commit together — a claim with no filing would be
      // a payment nobody can find.
      await client.query(
        `INSERT INTO unmatched_payments
           (id, signature, subject_id, received_native, expected_native, sender_pubkey, reason)
         VALUES ($1,$2,$3,$4,$5,$6,'sold_out')
         ON CONFLICT (signature) DO NOTHING`,
        [
          `um_${randomUUID().replaceAll("-", "")}`,
          input.signature,
          order.id,
          verdict.amount.toString(),
          order.amountNative.toString(),
          verdict.payer,
        ],
      );
      await client.query(
        `UPDATE ticket_orders SET status = 'failed', failure_reason = 'sold_out' WHERE id = $1`,
        [order.id],
      );
      return {
        ok: false as const,
        reason: "sold_out" as const,
        message:
          "This raffle sold out before your payment was confirmed. Your payment has been " +
          "recorded and will be refunded by hand.",
      };
    }

    const ticketNumbers = Array.from({ length: order.quantity }, (_, i) => sold + i + 1);
    for (const number of ticketNumbers) {
      await client.query(
        `INSERT INTO tickets (raffle_id, number, order_id, wallet) VALUES ($1,$2,$3,$4)`,
        [order.raffleId, number, order.id, order.payerPubkey],
      );
    }

    await client.query(
      `UPDATE ticket_orders SET status = 'paid', paid_at = now() WHERE id = $1`,
      [order.id],
    );

    // Selling the last ticket closes the raffle in the same transaction that
    // sold it, so no reader can ever see a sold-out raffle still offering a buy
    // button. The predicate repeats `advanceRaffle`'s rule rather than calling
    // it, because that function runs its own statement outside this
    // transaction's client and would not see these tickets yet.
    if (remaining === order.quantity) {
      await client.query(`UPDATE raffles SET status = 'closed' WHERE id = $1 AND status = 'open'`, [
        order.raffleId,
      ]);
    }

    return { ok: true as const, ticketNumbers };
  });
}

/**
 * Records real money that arrived and could not be applied.
 *
 * `ON CONFLICT DO NOTHING` rather than a caught exception: a caller can
 * legitimately submit the same losing signature twice, and on the paths that
 * run this inside a transaction a caught `23505` still leaves the enclosing
 * Postgres transaction aborted — every later statement fails with `25P02`, and
 * a `COMMIT` silently degrades to a `ROLLBACK`. Avoiding the error entirely is
 * what makes that impossible.
 */
async function fileUnmatched(params: {
  signature: string;
  subjectId: string | null;
  receivedLamports: bigint;
  expectedLamports: bigint;
  senderPubkey: string | null;
  reason: string;
}): Promise<void> {
  await query(
    `INSERT INTO unmatched_payments
       (id, signature, subject_id, received_native, expected_native, sender_pubkey, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (signature) DO NOTHING`,
    [
      `um_${randomUUID().replaceAll("-", "")}`,
      params.signature,
      params.subjectId,
      params.receivedLamports.toString(),
      params.expectedLamports.toString(),
      params.senderPubkey,
      params.reason,
    ],
  );
}

// --- Reading tickets ---------------------------------------------------------

export type Ticket = { number: number; wallet: string };

/**
 * Every ticket, in number order.
 *
 * Ordered here rather than by the caller because the draw is defined over
 * tickets sorted ascending, and the public verification page must be able to
 * show the same list the server used.
 */
export async function ticketsFor(raffleId: string): Promise<Ticket[]> {
  return query<Ticket>(
    `SELECT number, wallet FROM tickets WHERE raffle_id = $1 ORDER BY number ASC`,
    [raffleId],
  );
}

export async function ticketsSold(raffleId: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT count(*) AS count FROM tickets WHERE raffle_id = $1`,
    [raffleId],
  );
  return Number(row?.count ?? 0);
}

/**
 * How many tickets one wallet holds.
 *
 * The only odds figure any copy in this product may quote: "you hold 4 of 112
 * sold" is a fact, and anything phrased as a chance is a claim (DESIGN.md §8.1).
 */
export async function walletTicketCount(raffleId: string, wallet: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT count(*) AS count FROM tickets WHERE raffle_id = $1 AND wallet = $2`,
    [raffleId, wallet],
  );
  return Number(row?.count ?? 0);
}
