import { primaryEndpoint, rpcCall } from "./rpc";

/**
 * Asset metadata and ownership, from DAS.
 *
 * **Every image and every name in this product comes from here or from nowhere.**
 * There is no upload path and no form field that accepts a URL: the launchpad
 * has the creator upload to permanent storage and sign it themselves (spec
 * §0.2), and everything a page displays afterwards is read back off the chain.
 * That is what keeps this project from being an image host for arbitrary art
 * uploaded by unvetted strangers.
 *
 * DAS is why `SOLANA_RPC_URL` has no default. `getAsset` and `getAssetsByOwner`
 * are not served by the public mainnet endpoint, so a deployment that silently
 * fell back to it would fail here in a way that reads as a bug rather than as
 * missing configuration.
 *
 * WHO CALLS THIS: `assetOwner` from `raffles/escrow.ts` (does the prize really
 * sit in escrow) and `raffles/payout.ts` (did the prize really reach the
 * winner); `asset` from the raffle and collection pages; `assetsInCollection`
 * from the collection page.
 */

export type AssetMetadata = {
  mint: string;
  name: string;
  /** The image URI as the chain reports it. Rendered only from the allowed hosts. */
  image: string | null;
  collection: string | null;
  owner: string | null;
};

type DasAsset = {
  id?: string;
  ownership?: { owner?: string };
  content?: {
    metadata?: { name?: string };
    links?: { image?: string };
    files?: { uri?: string; mime?: string }[];
  };
  grouping?: { group_key?: string; group_value?: string }[];
};

/**
 * One asset, or null when the chain does not know it.
 *
 * Never throws for a missing asset — a raffle page for a burned or nonexistent
 * mint must render as "this asset could not be read" rather than as a 500. A
 * transport failure DOES throw, because "the node is down" and "the asset does
 * not exist" are different answers and collapsing them would let an RPC outage
 * look like a seller listing a fake mint.
 */
export async function asset(mint: string): Promise<AssetMetadata | null> {
  const result = (await rpcCall(primaryEndpoint(), "getAsset", { id: mint })) as DasAsset | null;
  return result ? toMetadata(result) : null;
}

/**
 * Who owns `mint` right now, or null.
 *
 * The single question the escrow check is built on, and it is deliberately
 * asked of the chain rather than derived from a transaction the seller quoted.
 * A signature proves a transfer happened; only ownership proves the asset is
 * still there. Both are checked — see `raffles/escrow.ts` — because a seller
 * who deposits and then withdraws before publishing would satisfy the first
 * and not the second.
 */
export async function assetOwner(mint: string): Promise<string | null> {
  return (await asset(mint))?.owner ?? null;
}

/**
 * Every asset in a collection, paged.
 *
 * `limit` is capped at DAS's own maximum of 1000 per page. The cap on total
 * pages is this project's: a collection page that walks an unbounded number of
 * pages is a page one large collection can hold open indefinitely.
 */
export async function assetsInCollection(
  collectionMint: string,
  options: { page?: number; limit?: number } = {},
): Promise<AssetMetadata[]> {
  const result = (await rpcCall(primaryEndpoint(), "getAssetsByGroup", {
    groupKey: "collection",
    groupValue: collectionMint,
    page: options.page ?? 1,
    limit: Math.min(options.limit ?? 100, 1000),
  })) as { items?: DasAsset[] } | null;

  return (result?.items ?? []).map(toMetadata);
}

function toMetadata(raw: DasAsset): AssetMetadata {
  return {
    mint: raw.id ?? "",
    name: raw.content?.metadata?.name ?? "",
    image: raw.content?.links?.image ?? raw.content?.files?.[0]?.uri ?? null,
    collection:
      raw.grouping?.find((group) => group.group_key === "collection")?.group_value ?? null,
    owner: raw.ownership?.owner ?? null,
  };
}
