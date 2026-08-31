/**
 * An ERC-721's metadata: `tokenURI()` on chain, then a bounded fetch off it.
 *
 * **Two untrusted steps, and they are untrusted in different ways.** The
 * contract decides what `tokenURI` returns, so the string is attacker-chosen;
 * `chain/metadata-fetch.ts` holds every rule about what may then be fetched.
 * This file's job is the ABI decoding and nothing else, so that the security
 * decision lives in one module rather than being spread across two.
 *
 * Solana has no equivalent because DAS resolves metadata for us, through a
 * provider we configure and pay. EVM has no such service, which is the whole
 * reason this exists.
 *
 * WHO CALLS THIS: `chain/robinhood/index.ts`, as the adapter's `assetMetadata`.
 */

import { fetchTokenMetadata, type TokenMetadata } from "../metadata-fetch";
import { encodeUint256, TOKEN_URI_SELECTOR, type Erc721Asset } from "./erc721";
import { evmCall } from "./rpc";

/**
 * Decodes an ABI-encoded `string` return value.
 *
 * The layout is offset, length, then the bytes padded to 32. Decoded by hand
 * rather than with an ABI library: this is the only dynamic type this project
 * reads, and it is about twenty lines against a dependency whose whole surface
 * we would then have to audit.
 *
 * **Every bound is checked before it is used.** A contract can return whatever
 * bytes it likes, including a length field claiming four gigabytes, and a
 * decoder that trusts it allocates on an attacker's word.
 */
export function decodeAbiString(hex: string): string | null {
  if (typeof hex !== "string" || !hex.startsWith("0x")) return null;
  const body = hex.slice(2);
  if (body.length < 128 || body.length % 2 !== 0) return null;

  let offset: number;
  let length: number;
  try {
    offset = Number(BigInt("0x" + body.slice(0, 64)));
    length = Number(BigInt("0x" + body.slice(offset * 2, offset * 2 + 64)));
  } catch {
    return null;
  }
  // A URI longer than this is not a URI; the fetch layer caps at 2,048 anyway,
  // and refusing here means never allocating on the contract's number.
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)) return null;
  if (length <= 0 || length > 4_096) return null;

  const start = offset * 2 + 64;
  const end = start + length * 2;
  if (end > body.length) return null;

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(Buffer.from(body.slice(start, end), "hex")),
    );
  } catch {
    return null;
  }
}

/**
 * `tokenURI(tokenId)`, or null.
 *
 * Null covers a revert (ERC-721 reverts for a nonexistent token), a node that
 * could not be reached, and a return value that does not decode. All three mean
 * the same thing to a page — render the asset reference instead — and
 * distinguishing them would invite a caller to treat one of them as a fact.
 */
export async function tokenUri(asset: Erc721Asset): Promise<string | null> {
  try {
    const result = await evmCall("eth_call", [
      { to: asset.contract, data: `${TOKEN_URI_SELECTOR}${encodeUint256(asset.tokenId)}` },
      "latest",
    ]);
    return typeof result === "string" ? decodeAbiString(result) : null;
  } catch {
    return null;
  }
}

/**
 * The metadata for one ERC-721, or null when any step declines.
 *
 * Logs the REFUSAL REASON and never the URI. Which host an attacker pointed us
 * at is not something to put in a log line that an operator will paste
 * somewhere; that a fetch was refused, and under which rule, is exactly what an
 * operator needs when a legitimate collection does not render.
 */
export async function erc721Metadata(asset: Erc721Asset): Promise<TokenMetadata | null> {
  const uri = await tokenUri(asset);
  if (!uri) return null;

  const result = await fetchTokenMetadata(uri);
  if (!result.ok) {
    console.warn(`robinhood.assetMetadata: refused (${result.reason})`);
    return null;
  }
  return result.metadata;
}
