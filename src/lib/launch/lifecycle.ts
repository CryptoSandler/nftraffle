import { randomUUID } from "node:crypto";
import { query, queryOne } from "../db";

/**
 * The launchpad's state machine: a collection is a draft until the chain says
 * otherwise.
 *
 * The same shape as `raffles/lifecycle.ts` and for the same reason — **a status
 * is derived from data, never accepted from a caller** (CLAUDE.md). `live` is
 * not a field a route may set: migration 001's `collections_live_is_complete`
 * refuses to store a live row without a collection mint, a candy machine, a
 * verified fee signature and a timestamp, so the transition below cannot
 * succeed on a collection that was not actually deployed and paid for.
 *
 * WHO CALLS THIS: `POST /api/collections` creates; `POST
 * /api/collections/[slug]/publish` publishes; the mint route and the collection
 * page read.
 */

export type Launch = {
  id: string;
  slug: string;
  chain: string;
  creatorWallet: string;
  name: string;
  symbol: string;
  collectionMint: string | null;
  candyMachine: string | null;
  itemsAvailable: number;
  priceNative: bigint;
  mintFeeNative: bigint;
  mintFeeBps: number;
  status: string;
  startsAt: Date | null;
};

const COLUMNS = `id, slug, chain, creator_wallet, name, symbol, collection_mint, candy_machine,
  items_available, price_native, mint_fee_native, mint_fee_bps, status, starts_at`;

type Row = {
  id: string;
  slug: string;
  chain: string;
  creator_wallet: string;
  name: string;
  symbol: string;
  collection_mint: string | null;
  candy_machine: string | null;
  items_available: number;
  price_native: string;
  mint_fee_native: string;
  mint_fee_bps: number;
  status: string;
  starts_at: Date | null;
};

function toLaunch(row: Row): Launch {
  return {
    id: row.id,
    slug: row.slug,
    chain: row.chain,
    creatorWallet: row.creator_wallet,
    name: row.name,
    symbol: row.symbol,
    collectionMint: row.collection_mint,
    candyMachine: row.candy_machine,
    itemsAvailable: row.items_available,
    priceNative: BigInt(row.price_native),
    mintFeeNative: BigInt(row.mint_fee_native),
    mintFeeBps: row.mint_fee_bps,
    status: row.status,
    startsAt: row.starts_at,
  };
}

export async function launchBySlug(slug: string): Promise<Launch | null> {
  const row = await queryOne<Row>(`SELECT ${COLUMNS} FROM collections WHERE slug = $1`, [slug]);
  return row ? toLaunch(row) : null;
}

/**
 * Opens a draft, holding the two addresses the transaction was built for.
 *
 * **The addresses are written BEFORE the creator signs**, which is what makes
 * publishing checkable: the machine that gets read back has to be the machine
 * this row named, so a creator cannot deploy one candy machine, publish a
 * different one, and have the fee guard checked on an account they control.
 */
export async function createLaunchDraft(input: {
  slug: string;
  chain: string;
  creatorWallet: string;
  name: string;
  symbol: string;
  description: string;
  collectionMint: string;
  candyMachine: string;
  itemsAvailable: number;
  priceNative: bigint;
  mintFeeNative: bigint;
  mintFeeBps: number;
  startsAt: Date;
}): Promise<Launch> {
  const row = await queryOne<Row>(
    `INSERT INTO collections
       (id, slug, chain, creator_wallet, name, symbol, description, collection_mint,
        candy_machine, items_available, price_native, mint_fee_native, mint_fee_bps, starts_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING ${COLUMNS}`,
    [
      `col_${randomUUID().replaceAll("-", "")}`,
      input.slug,
      input.chain,
      input.creatorWallet,
      input.name,
      input.symbol,
      input.description,
      input.collectionMint,
      input.candyMachine,
      input.itemsAvailable,
      input.priceNative.toString(),
      input.mintFeeNative.toString(),
      input.mintFeeBps,
      input.startsAt,
    ],
  );
  return toLaunch(row!);
}

export type PublishResult =
  | { ok: true; launch: Launch }
  | { ok: false; reason: "not_draft" | "fee_already_used" };

/**
 * Makes a collection live, once the fee and the deployed machine have both been
 * verified by the caller.
 *
 * **`status = 'draft'` is inside the UPDATE**, so two publishes racing produce
 * one live collection and one `not_draft` rather than two winners. The unique
 * index on `launch_fee_signature` is the second half of that: one payment
 * launches one collection, and replaying a signature cannot launch a second.
 */
export async function publishLaunch(
  id: string,
  input: { launchFeeSignature: string },
): Promise<PublishResult> {
  try {
    const row = await queryOne<Row>(
      `UPDATE collections
          SET status = 'live', launch_fee_signature = $2, launched_at = now()
        WHERE id = $1 AND status = 'draft'
        RETURNING ${COLUMNS}`,
      [id, input.launchFeeSignature],
    );
    if (!row) return { ok: false, reason: "not_draft" };
    return { ok: true, launch: toLaunch(row) };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "fee_already_used" };
    throw error;
  }
}

/** Marks a draft as failed, so a creator's abandoned attempt is not a live page. */
export async function failLaunch(id: string): Promise<void> {
  await query(`UPDATE collections SET status = 'failed' WHERE id = $1 AND status = 'draft'`, [id]);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}
