import { query } from "../db";
import type { RaffleStatus } from "./lifecycle";

/**
 * The read side: what the home page, the collection page and the admin queue
 * list.
 *
 * **Newest-first, and there is deliberately no ranking, filtering or sorting
 * surface here.** DESIGN.md §1 forbids it: sorting by price, volume or rarity
 * serves discovery among high volume, which is a problem this product does not
 * have and is Magic Eden's game played with a hundredth of their liquidity.
 * When it becomes a real problem, that is a decision to take deliberately, not
 * a query to add quietly.
 *
 * WHO CALLS THIS: `liveRaffles` from `/` and `/c/[slug]`; `recentCollections`
 * from `/`; `payoutQueue` from `/admin`.
 */

export type RaffleSummary = {
  id: string;
  slug: string;
  prizeMint: string;
  sellerWallet: string;
  collectionId: string | null;
  ticketPriceLamports: bigint;
  maxTickets: number;
  ticketsSold: number;
  /**
   * Carried on the summary because the admin payout queue computes the
   * seller's net from it, and a summary without it forced that screen to pass
   * a placeholder — which showed the operator the GROSS and would have had
   * them send the wrong amount. The fee is frozen per raffle, so it has to
   * travel with the raffle rather than be read from the current setting.
   */
  houseFeeBps: number;
  status: RaffleStatus;
  /** Null until the draw. The payout queue needs it to say where to send the prize. */
  winnerWallet: string | null;
  endsAt: Date;
};

type SummaryRow = {
  id: string;
  slug: string;
  prize_mint: string;
  seller_wallet: string;
  collection_id: string | null;
  ticket_price_lamports: string;
  max_tickets: number;
  house_fee_bps: number;
  sold: string;
  status: RaffleStatus;
  winner_wallet: string | null;
  ends_at: Date;
};

function toSummary(row: SummaryRow): RaffleSummary {
  return {
    id: row.id,
    slug: row.slug,
    prizeMint: row.prize_mint,
    sellerWallet: row.seller_wallet,
    collectionId: row.collection_id,
    ticketPriceLamports: BigInt(row.ticket_price_lamports),
    maxTickets: row.max_tickets,
    ticketsSold: Number(row.sold),
    houseFeeBps: row.house_fee_bps,
    status: row.status,
    winnerWallet: row.winner_wallet,
    endsAt: row.ends_at,
  };
}

const SUMMARY_SELECT = `
  SELECT r.id, r.slug, r.prize_mint, r.seller_wallet, r.collection_id,
         r.ticket_price_lamports, r.max_tickets, r.house_fee_bps, r.status,
         r.winner_wallet, r.ends_at,
         (SELECT count(*) FROM tickets t WHERE t.raffle_id = r.id) AS sold
    FROM raffles r`;

/**
 * Raffles a visitor can act on or watch: open, closed-awaiting-draw, and drawn.
 *
 * Drafts are excluded because a draft has no prize in escrow yet, and listing
 * one would advertise a raffle for an asset nobody has deposited. Cancelled
 * ones are excluded from the list and remain reachable at their own URL, so a
 * ticket holder following a link still lands on the page that says why.
 *
 * `limit` is capped rather than trusted: this is a public page and an
 * unbounded page size is a public page anybody can make expensive.
 */
export async function liveRaffles(options: { limit?: number } = {}): Promise<RaffleSummary[]> {
  const rows = await query<SummaryRow>(
    `${SUMMARY_SELECT}
      WHERE r.status IN ('open','closed','drawn','paid')
      ORDER BY (r.status = 'open') DESC, r.ends_at ASC
      LIMIT $1`,
    [Math.min(options.limit ?? 50, 200)],
  );
  return rows.map(toSummary);
}

/** The raffles whose prize belongs to one collection — leg 3's whole content. */
export async function rafflesForCollection(collectionId: string): Promise<RaffleSummary[]> {
  const rows = await query<SummaryRow>(
    `${SUMMARY_SELECT}
      WHERE r.collection_id = $1 AND r.status <> 'draft'
      ORDER BY (r.status = 'open') DESC, r.ends_at DESC
      LIMIT 200`,
    [collectionId],
  );
  return rows.map(toSummary);
}

/**
 * Everything drawn and not yet paid — the operator's work queue.
 *
 * Ordered oldest first, because the queue is a list of people waiting, and the
 * one who has waited longest goes first. That is the opposite of every other
 * ordering in this file and it is deliberate.
 */
export async function payoutQueue(): Promise<RaffleSummary[]> {
  const rows = await query<SummaryRow>(
    `${SUMMARY_SELECT} WHERE r.status = 'drawn' ORDER BY r.drawn_at ASC LIMIT 200`,
  );
  return rows.map(toSummary);
}

/** Raffles that have closed but have no winner yet — the draws that are due. */
export async function drawQueue(): Promise<RaffleSummary[]> {
  const rows = await query<SummaryRow>(
    `${SUMMARY_SELECT} WHERE r.status = 'closed' ORDER BY r.ends_at ASC LIMIT 200`,
  );
  return rows.map(toSummary);
}

export type CollectionSummary = {
  id: string;
  slug: string;
  name: string;
  symbol: string;
  collectionMint: string | null;
  candyMachine: string | null;
  creatorWallet: string;
  itemsAvailable: number;
  priceLamports: bigint;
  mintFeeLamports: bigint;
  mintFeeBps: number;
  launchedAt: Date | null;
};

type CollectionRow = {
  id: string;
  slug: string;
  name: string;
  symbol: string;
  collection_mint: string | null;
  candy_machine: string | null;
  creator_wallet: string;
  items_available: number;
  price_lamports: string;
  mint_fee_lamports: string;
  mint_fee_bps: number;
  launched_at: Date | null;
};

function toCollection(row: CollectionRow): CollectionSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    symbol: row.symbol,
    collectionMint: row.collection_mint,
    candyMachine: row.candy_machine,
    creatorWallet: row.creator_wallet,
    itemsAvailable: row.items_available,
    priceLamports: BigInt(row.price_lamports),
    mintFeeLamports: BigInt(row.mint_fee_lamports),
    mintFeeBps: row.mint_fee_bps,
    launchedAt: row.launched_at,
  };
}

const COLLECTION_COLUMNS = `id, slug, name, symbol, collection_mint, candy_machine,
  creator_wallet, items_available, price_lamports, mint_fee_lamports, mint_fee_bps, launched_at`;

/**
 * Collections that actually exist on chain.
 *
 * `status = 'live'` is the whole filter, and migration 001's
 * `collections_live_is_complete` is what makes it trustworthy: a live row is
 * guaranteed to carry a collection mint, a candy machine and a verified fee
 * signature, so nothing listed here can be a mint page that 404s.
 */
export async function recentCollections(limit = 24): Promise<CollectionSummary[]> {
  const rows = await query<CollectionRow>(
    `SELECT ${COLLECTION_COLUMNS} FROM collections
      WHERE status = 'live' ORDER BY launched_at DESC LIMIT $1`,
    [Math.min(limit, 100)],
  );
  return rows.map(toCollection);
}

export async function collectionBySlug(slug: string): Promise<CollectionSummary | null> {
  const rows = await query<CollectionRow>(
    `SELECT ${COLLECTION_COLUMNS} FROM collections WHERE slug = $1`,
    [slug],
  );
  return rows[0] ? toCollection(rows[0]) : null;
}

/**
 * Raffles whose prize belongs to a collection we did NOT launch.
 *
 * The owner's answer to open question Q5: every collection gets a page, not
 * only the ones launched here. A collection we launched has a row and its own
 * numbers; one we did not has no row at all, so its page is assembled from DAS
 * plus whatever raffles here happen to name it.
 *
 * **`collection_mint` is not a column** — `raffles.collection_id` points at our
 * own `collections` table and is NULL for an outside asset. So the join is done
 * the only way it can be: by asking DAS which collection each prize belongs to.
 * That is a network call per prize, which is why this is bounded and why the
 * caller caches nothing it did not read this request.
 *
 * WHO CALLS THIS: `/c/[mint]` — the outside-collection page.
 */
export async function rafflesByPrizeMints(mints: readonly string[]): Promise<RaffleSummary[]> {
  if (mints.length === 0) return [];
  const rows = await query<SummaryRow>(
    `${SUMMARY_SELECT}
      WHERE r.prize_mint = ANY($1::text[]) AND r.status <> 'draft'
      ORDER BY (r.status = 'open') DESC, r.ends_at DESC
      LIMIT 200`,
    [mints.slice(0, 500)],
  );
  return rows.map(toSummary);
}
