/**
 * The small amount of ERC-721 this project needs, decoded by hand.
 *
 * **No ABI library, deliberately.** Two things are read from a contract — a
 * `Transfer` event and an `ownerOf` call — and both are fixed-shape: a known
 * topic with 32-byte words, and a four-byte selector with one word of
 * arguments. Pulling in an ABI encoder to decode two known layouts is a
 * dependency for what a few lines cover (CLAUDE.md, rung 5), and `viem` is
 * already scheduled for the browser side where it earns its place building
 * transactions.
 *
 * WHO CALLS THIS: `chain/robinhood/transfer.ts` and `chain/robinhood/index.ts`.
 */

/**
 * `keccak256("Transfer(address,address,uint256)")`.
 *
 * Hardcoded rather than computed: it is a constant of the standard, and
 * computing it would mean a keccak implementation on the server for one value
 * that has never changed and cannot.
 *
 * **ERC-20 shares this signature**, which is the trap. The two are told apart
 * by topic count, not by topic zero: ERC-721 indexes the tokenId so it carries
 * four topics, while ERC-20 leaves the value unindexed and carries three. A
 * reader that matched on topic zero alone would read a token movement as an
 * NFT transfer.
 */
export const ERC721_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** `ownerOf(uint256)`, first four bytes of its keccak hash. */
export const OWNER_OF_SELECTOR = "0x6352211e";

/** `tokenURI(uint256)`. */
export const TOKEN_URI_SELECTOR = "0xc87b56dd";

/** An ERC-721 asset: the contract that defines it and the id within it. */
export type Erc721Asset = { contract: string; tokenId: bigint };

/**
 * Parses the stored asset reference, `<contract>/<tokenId>`.
 *
 * Returns null rather than throwing on anything malformed: this runs against
 * values read back from the database and from a URL, and a bad row must render
 * as "this could not be read" rather than as a 500 on a public page.
 */
export function parseErc721Asset(raw: string): Erc721Asset | null {
  const trimmed = raw.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return null;

  const contract = trimmed.slice(0, slash).toLowerCase();
  const tokenPart = trimmed.slice(slash + 1);
  if (!/^0x[0-9a-f]{40}$/.test(contract)) return null;
  // Decimal only, and no leading + or -. A tokenId is a uint256.
  if (!/^\d+$/.test(tokenPart)) return null;

  try {
    return { contract, tokenId: BigInt(tokenPart) };
  } catch {
    return null;
  }
}

/** The canonical stored form. Lowercased so two spellings cannot become two assets. */
export function formatErc721Asset(asset: Erc721Asset): string {
  return `${asset.contract.toLowerCase()}/${asset.tokenId.toString()}`;
}

/** A 32-byte topic word back to an address. */
export function addressFromTopic(topic: string): string | null {
  if (typeof topic !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return null;
  return `0x${topic.slice(26).toLowerCase()}`;
}

/** A 32-byte word as a uint256. */
export function uintFromWord(word: string): bigint | null {
  if (typeof word !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(word)) return null;
  try {
    return BigInt(word);
  } catch {
    return null;
  }
}

/** Left-pads a uint256 argument for an `eth_call` data field. */
export function encodeUint256(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

/** True when two addresses are the same, whatever their checksum casing. */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
