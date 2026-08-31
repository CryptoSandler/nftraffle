import { randomUUID } from "node:crypto";
import { isUniqueViolation, queryOne, transaction, violatedConstraint } from "../db";

/**
 * Every state a raffle can be in, and every move between them.
 *
 * **One module owns all of them, and there is deliberately no `setStatus`.**
 * A status is derived from data, never accepted from a caller (CLAUDE.md), so
 * the only way to reach a state is through the function that owns it — and each
 * of those checks its own precondition inside the same transaction that writes
 * the change. A route reaching for a bare `UPDATE raffles SET status` is the
 * defect this file exists to make unnecessary.
 *
 * The states:
 *
 *   draft     the row exists; nothing is proved and no ticket can be sold
 *   open      escrow and listing fee verified on chain; selling
 *   closed    the clock ran out or the supply sold out; not drawn
 *   drawn     seed revealed against the announced slot's blockhash; nothing moved
 *   paid      both transfers verified on chain; terminal
 *   cancelled an operator ended it, with a reason the public page shows
 *
 * WHO CALLS THIS: `createDraft` from `POST /api/raffles`; `openRaffle` from
 * `POST /api/raffles/[slug]/publish` (after `raffles/escrow.ts` verifies both
 * signatures); `advanceRaffle` from every read of a raffle page and from the
 * admin queue; `recordDraw` from `POST /api/admin/raffles/[id]/draw`;
 * `recordPayout` and `cancelRaffle` from the admin payout queue;
 * `cancelRaffleAsSeller` from `POST /api/raffles/[slug]/cancel`.
 *
 * NOTE ON `advanceRaffle`'s caller. It is driven by READS rather than by a
 * scheduled job, deliberately: this project has no cron, and a raffle whose
 * clock has run out but which nobody has looked at has no observer to be wrong
 * for. The moment anyone loads the page or the admin queue, the transition
 * happens before anything is rendered. The ceiling on that choice is that a
 * raffle nobody visits stays `open` in the database — visible only to a direct
 * SQL reader — until someone does.
 * // ponytail: read-driven; add a cron if a downstream ever needs the row to be
 * // correct without anybody having asked for it.
 */

export type RaffleStatus = "draft" | "open" | "closed" | "drawn" | "paid" | "cancelled";

export type Raffle = {
  id: string;
  slug: string;
  sellerWallet: string;
  prizeMint: string;
  collectionId: string | null;
  ticketPriceLamports: bigint;
  maxTickets: number;
  houseFeeBps: number;
  listingFeeSignature: string | null;
  escrowSignature: string | null;
  status: RaffleStatus;
  seedHash: string;
  /** The REVEALED seed. Null until the draw — safe for any public reader. */
  seed: string | null;
  drawSlot: bigint;
  drawBlockhash: string | null;
  winnerWallet: string | null;
  winningTicket: number | null;
  opensAt: Date | null;
  endsAt: Date;
  createdAt: Date;
  drawnAt: Date | null;
  prizeSignature: string | null;
  proceedsSignature: string | null;
  paidAt: Date | null;
  cancelledReason: string | null;
};

type RaffleRow = {
  id: string;
  slug: string;
  seller_wallet: string;
  prize_mint: string;
  collection_id: string | null;
  ticket_price_lamports: string;
  max_tickets: number;
  house_fee_bps: number;
  listing_fee_signature: string | null;
  escrow_signature: string | null;
  status: RaffleStatus;
  seed_hash: string;
  seed: string | null;
  draw_slot: string;
  draw_blockhash: string | null;
  winner_wallet: string | null;
  winning_ticket: number | null;
  opens_at: Date | null;
  ends_at: Date;
  created_at: Date;
  drawn_at: Date | null;
  prize_signature: string | null;
  proceeds_signature: string | null;
  paid_at: Date | null;
  cancelled_reason: string | null;
};

const COLUMNS = `id, slug, seller_wallet, prize_mint, collection_id, ticket_price_lamports,
  max_tickets, house_fee_bps, listing_fee_signature, escrow_signature, status, seed_hash, seed,
  draw_slot, draw_blockhash, winner_wallet, winning_ticket, opens_at, ends_at, created_at,
  drawn_at, prize_signature, proceeds_signature, paid_at, cancelled_reason`;

/**
 * `BIGINT` arrives from `pg` as a string, deliberately: the driver will not
 * silently narrow a 64-bit value into a JavaScript number that cannot hold it.
 * Lamports go back to `bigint` here so nothing downstream does money arithmetic
 * on a float.
 */
function toRaffle(row: RaffleRow): Raffle {
  return {
    id: row.id,
    slug: row.slug,
    sellerWallet: row.seller_wallet,
    prizeMint: row.prize_mint,
    collectionId: row.collection_id,
    ticketPriceLamports: BigInt(row.ticket_price_lamports),
    maxTickets: row.max_tickets,
    houseFeeBps: row.house_fee_bps,
    listingFeeSignature: row.listing_fee_signature,
    escrowSignature: row.escrow_signature,
    status: row.status,
    seedHash: row.seed_hash,
    seed: row.seed,
    drawSlot: BigInt(row.draw_slot),
    drawBlockhash: row.draw_blockhash,
    winnerWallet: row.winner_wallet,
    winningTicket: row.winning_ticket,
    opensAt: row.opens_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    drawnAt: row.drawn_at,
    prizeSignature: row.prize_signature,
    proceedsSignature: row.proceeds_signature,
    paidAt: row.paid_at,
    cancelledReason: row.cancelled_reason,
  };
}

export async function raffleById(id: string): Promise<Raffle | null> {
  const row = await queryOne<RaffleRow>(`SELECT ${COLUMNS} FROM raffles WHERE id = $1`, [id]);
  return row ? toRaffle(row) : null;
}

export async function raffleBySlug(slug: string): Promise<Raffle | null> {
  const row = await queryOne<RaffleRow>(`SELECT ${COLUMNS} FROM raffles WHERE slug = $1`, [slug]);
  return row ? toRaffle(row) : null;
}

// --- draft -------------------------------------------------------------------

export type CreateDraftInput = {
  slug: string;
  sellerWallet: string;
  prizeMint: string;
  collectionId: string | null;
  ticketPriceLamports: bigint;
  maxTickets: number;
  /** Frozen per raffle: a later change to HOUSE_FEE_BPS must not reach back. */
  houseFeeBps: number;
  /** Announced at creation. Names a slot that does not exist yet. */
  drawSlot: bigint;
  endsAt: Date;
  /** From `commitSeed()`. Published immediately. */
  seedHash: string;
  /**
   * From `commitSeed()`. Written to `seed_secret` and never published until the
   * draw copies it into `seed` (migration 003).
   *
   * Taken here rather than left to a follow-up UPDATE so that a draft either
   * has its secret or does not exist. A raffle whose commitment was published
   * and whose seed was lost between two statements is a raffle nobody can ever
   * draw, and the public page would show it as withheld.
   */
  seedSecret: string;
};

export type CreateDraftResult =
  | { ok: true; raffle: Raffle }
  | { ok: false; reason: "prize_already_listed" | "slug_taken" };

/**
 * Opens a draft: the record the escrow deposit will be verified against.
 *
 * **The draft exists before the asset arrives, and that ordering is the whole
 * design** (spec §0.3). Verification needs something to verify against; without
 * a prior record, an NFT landing in escrow is an orphan the server would have
 * to guess about, and two sellers depositing assets from one collection in the
 * same minute are indistinguishable.
 *
 * Both failures are decided by a database constraint rather than by a SELECT
 * this function ran first — two concurrent callers would both read "free" and
 * both proceed. It inserts and translates the violation by constraint name.
 */
export async function createDraft(input: CreateDraftInput): Promise<CreateDraftResult> {
  const id = `rf_${randomUUID().replaceAll("-", "")}`;
  try {
    const row = await queryOne<RaffleRow>(
      `INSERT INTO raffles
         (id, slug, seller_wallet, prize_mint, collection_id, ticket_price_lamports,
          max_tickets, house_fee_bps, seed_hash, seed_secret, draw_slot, ends_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING ${COLUMNS}`,
      [
        id,
        input.slug,
        input.sellerWallet,
        input.prizeMint,
        input.collectionId,
        input.ticketPriceLamports.toString(),
        input.maxTickets,
        input.houseFeeBps,
        input.seedHash,
        input.seedSecret,
        input.drawSlot.toString(),
        input.endsAt,
      ],
    );
    return { ok: true, raffle: toRaffle(row!) };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const constraint = violatedConstraint(error);
    if (constraint === "raffles_live_prize") return { ok: false, reason: "prize_already_listed" };
    if (constraint === "raffles_slug_key") return { ok: false, reason: "slug_taken" };
    throw error;
  }
}

// --- draft -> open -----------------------------------------------------------

export type OpenResult =
  | { ok: true; raffle: Raffle }
  | { ok: false; reason: "not_found" | "not_draft" | "signature_reused" };

/**
 * Publishes a draft, once both payments are proved.
 *
 * This function does NOT verify anything on chain — `raffles/escrow.ts` does
 * that and hands the two signatures here. The split is deliberate: this module
 * owns transitions and knows nothing about Solana, which is what lets every
 * transition be tested without a network.
 *
 * The `status = 'draft'` predicate is inside the UPDATE rather than in a
 * preceding SELECT, so two concurrent publishes cannot both pass a check and
 * both write. The second one updates zero rows and is told `not_draft`.
 */
export async function openRaffle(
  id: string,
  signatures: { listingFeeSignature: string; escrowSignature: string },
): Promise<OpenResult> {
  try {
    const row = await queryOne<RaffleRow>(
      `UPDATE raffles
          SET status = 'open',
              listing_fee_signature = $2,
              escrow_signature = $3,
              opens_at = now()
        WHERE id = $1 AND status = 'draft'
        RETURNING ${COLUMNS}`,
      [id, signatures.listingFeeSignature, signatures.escrowSignature],
    );
    if (row) return { ok: true, raffle: toRaffle(row) };
  } catch (error) {
    // One deposit opens one raffle. `raffles.escrow_signature` and
    // `listing_fee_signature` are UNIQUE, so replaying a transfer to point a
    // second raffle at one asset is refused by the database rather than by a
    // check somebody remembers to write.
    if (isUniqueViolation(error)) return { ok: false, reason: "signature_reused" };
    throw error;
  }

  return { ok: false, reason: (await raffleById(id)) ? "not_draft" : "not_found" };
}

// --- open -> closed ----------------------------------------------------------

/**
 * Moves a raffle to whatever state its own data implies, and returns it.
 *
 * Today that is one transition — an `open` raffle whose clock has run out or
 * whose supply has sold out becomes `closed`. Both reasons are independent and
 * both matter: the clock is the obvious one, and selling out is what stops a
 * page showing a buy button that can only fail.
 *
 * Every other state is returned untouched. That includes `cancelled`, which an
 * expired clock must never reopen or re-close, and `drawn`, which must never go
 * back to `closed` and lose its winner.
 */
export async function advanceRaffle(id: string): Promise<Raffle | null> {
  const row = await queryOne<RaffleRow>(
    `UPDATE raffles r
        SET status = 'closed'
      WHERE r.id = $1
        AND r.status = 'open'
        AND (
          r.ends_at <= now()
          OR (SELECT count(*) FROM tickets t WHERE t.raffle_id = r.id) >= r.max_tickets
        )
      RETURNING ${COLUMNS}`,
    [id],
  );
  return row ? toRaffle(row) : raffleById(id);
}

// --- closed -> drawn ---------------------------------------------------------

export type DrawResult =
  | { ok: true; raffle: Raffle }
  | {
      ok: false;
      reason: "not_found" | "not_closed" | "no_such_ticket" | "winner_mismatch" | "no_seed";
    };

/**
 * Records the reveal and the winner, in one transaction.
 *
 * **The winner is checked against the ticket, not taken on trust.** The caller
 * derived it with `deriveWinner`, and this re-reads the ticket to confirm the
 * wallet it names really holds that number. A caller that computed one thing
 * and is writing another is a bug, and the cost of not catching it here is a
 * payout to the wrong wallet on a page that says it was fair.
 *
 * `status = 'closed'` in the predicate is what makes drawing exactly once
 * possible, and it is also what stops an early draw.
 *
 * The seed is read from `seed_secret` and copied into `seed`, which is what
 * publishes it. Before this runs, `seed` is NULL and any public reader that
 * renders it shows nothing — see migration 003 for why that split exists.
 */
export async function recordDraw(
  id: string,
  draw: { drawBlockhash: string; winnerWallet: string; winningTicket: number },
): Promise<DrawResult> {
  return transaction(async (client) => {
    const locked = await client.query<{ status: RaffleStatus; seed_secret: string | null }>(
      `SELECT status, seed_secret FROM raffles WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (locked.rowCount === 0) return { ok: false, reason: "not_found" };
    if (locked.rows[0].status !== "closed") return { ok: false, reason: "not_closed" };

    /**
     * THE REVEALED SEED IS THE STORED ONE, never a value a caller passed in.
     *
     * This function used to take the seed as an argument, which meant the
     * published value came from whoever called it rather than from the row the
     * commitment was made against. A caller with a bug — or a route reading the
     * wrong field — could have published a seed that does not hash to
     * `seed_hash`, and the failure would have surfaced on the public
     * verification page, after the prize had been sent.
     *
     * Reading it here makes that unrepresentable: the only seed this can
     * publish is the one written when the commitment was.
     */
    const seedSecret = locked.rows[0].seed_secret;
    if (!seedSecret) return { ok: false, reason: "no_seed" };

    const ticket = await client.query<{ wallet: string }>(
      `SELECT wallet FROM tickets WHERE raffle_id = $1 AND number = $2`,
      [id, draw.winningTicket],
    );
    if (ticket.rowCount === 0) return { ok: false, reason: "no_such_ticket" };
    if (ticket.rows[0].wallet !== draw.winnerWallet) {
      return { ok: false, reason: "winner_mismatch" };
    }

    const updated = await client.query<RaffleRow>(
      `UPDATE raffles
          SET status = 'drawn',
              seed = $2,
              draw_blockhash = $3,
              winner_wallet = $4,
              winning_ticket = $5,
              drawn_at = now()
        WHERE id = $1
        RETURNING ${COLUMNS}`,
      [id, seedSecret, draw.drawBlockhash, draw.winnerWallet, draw.winningTicket],
    );
    return { ok: true, raffle: toRaffle(updated.rows[0]) };
  });
}

// --- drawn -> paid -----------------------------------------------------------

export type PayoutResult =
  | { ok: true; raffle: Raffle }
  | { ok: false; reason: "not_found" | "not_drawn" };

/**
 * Marks a raffle paid, with both legs of evidence.
 *
 * Like `openRaffle`, this writes a verdict somebody else reached: the on-chain
 * checks live in `raffles/payout.ts` and both signatures arrive here already
 * proved. What this owns is that `paid` is reachable only from `drawn`, exactly
 * once, and only with both signatures present — the schema's
 * `raffles_paid_has_evidence` says the same thing a second time, on purpose.
 */
export async function recordPayout(
  id: string,
  evidence: { prizeSignature: string; proceedsSignature: string },
): Promise<PayoutResult> {
  const row = await queryOne<RaffleRow>(
    `UPDATE raffles
        SET status = 'paid',
            prize_signature = $2,
            proceeds_signature = $3,
            paid_at = now()
      WHERE id = $1 AND status = 'drawn'
      RETURNING ${COLUMNS}`,
    [id, evidence.prizeSignature, evidence.proceedsSignature],
  );
  if (row) return { ok: true, raffle: toRaffle(row) };
  return { ok: false, reason: (await raffleById(id)) ? "not_drawn" : "not_found" };
}

// --- anything -> cancelled ---------------------------------------------------

export type CancelFailure =
  | "not_found"
  | "already_paid"
  | "reason_required"
  | "not_seller"
  | "tickets_sold";

export type CancelResult = { ok: true; raffle: Raffle } | { ok: false; reason: CancelFailure };

/**
 * Ends a raffle early, with a reason. **The operator's path.**
 *
 * **The reason is mandatory and this is not paperwork.** The public page shows
 * it, and the audience is people who paid for tickets in something that is now
 * not happening. A cancellation that cannot say why is the worst version of the
 * only bad outcome this product has.
 *
 * `paid` is the one state it cannot reach from: the prize and the proceeds have
 * already moved, and marking that cancelled would leave a page claiming a
 * transfer did not happen when the chain says it did.
 *
 * An operator MAY cancel a raffle with tickets sold, because refunding them is
 * work the operator is signing up for. A seller cannot volunteer that work —
 * see `cancelRaffleAsSeller`.
 */
export async function cancelRaffle(id: string, reason: string): Promise<CancelResult> {
  return cancel(id, reason, null);
}

/**
 * **The seller's path**, and the owner's answer to open question Q3: a seller
 * may withdraw their own raffle, but only while nobody has bought into it.
 *
 * The zero-ticket bound is what makes the permission safe to grant. Refunds are
 * manual, performed by a human from a wallet this codebase cannot reach, so a
 * seller who could cancel after tickets sold would be making a promise about
 * somebody else's labour — ours — to people who have already paid. With the
 * bound, the only thing a seller withdraws is an asset nobody has a claim on.
 *
 * Two entry points, two authorisations, ONE transition. Writing the seller's
 * case as a second `UPDATE` somewhere else is exactly the bare-UPDATE-in-a-route
 * that CLAUDE.md forbids, and it would be the copy that drifts.
 */
export async function cancelRaffleAsSeller(
  id: string,
  sellerWallet: string,
  reason: string,
): Promise<CancelResult> {
  return cancel(id, reason, sellerWallet);
}

/**
 * The one transition. `seller` non-null means the seller's bounds apply.
 *
 * **Inside a transaction with `FOR UPDATE` on the raffle**, and that is a
 * correctness requirement rather than tidiness: `settleTicketOrder` takes the
 * same lock before it allocates ticket numbers. Without it, a settlement
 * committing between this function's ticket count and its UPDATE would leave a
 * cancelled raffle holding a paid ticket — somebody's SOL spent on a raffle that
 * had already been withdrawn, with nothing on the page to say so.
 */
async function cancel(
  id: string,
  reason: string,
  seller: string | null,
): Promise<CancelResult> {
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, reason: "reason_required" };

  return transaction(async (client) => {
    const locked = await client.query<{ status: RaffleStatus; seller_wallet: string }>(
      `SELECT status, seller_wallet FROM raffles WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (locked.rowCount === 0) return { ok: false, reason: "not_found" };
    if (locked.rows[0].status === "paid") return { ok: false, reason: "already_paid" };

    if (seller !== null) {
      if (locked.rows[0].seller_wallet !== seller) return { ok: false, reason: "not_seller" };

      // Checked under the lock, so a settlement cannot commit between this and
      // the UPDATE below.
      const sold = await client.query<{ count: string }>(
        `SELECT count(*) AS count FROM tickets WHERE raffle_id = $1`,
        [id],
      );
      if (Number(sold.rows[0].count) > 0) return { ok: false, reason: "tickets_sold" };
    }

    const updated = await client.query<RaffleRow>(
      `UPDATE raffles SET status = 'cancelled', cancelled_reason = $2
        WHERE id = $1
        RETURNING ${COLUMNS}`,
      [id, trimmed],
    );
    return { ok: true, raffle: toRaffle(updated.rows[0]) };
  });
}
