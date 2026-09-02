/**
 * Proving that whoever opens a raffle draft controls the wallet it names as
 * seller.
 *
 * **WHY THIS EXISTS, and why it is not the same job as `evm-binding.ts`.** That
 * module binds a PAYER so a stranger's transfer cannot be claimed against an
 * order we opened. This one binds a SELLER, and what it protects is not money
 * but a slot: `raffles_live_prize` (migration 004) is a unique index over
 * `(chain, prize_asset)` for every status a raffle can be spoken for in, and
 * `POST /api/raffles` insists only that the named seller REALLY HOLDS the
 * asset — not that the caller is that seller.
 *
 * Without a signature, then, anybody could post a draft naming a stranger's
 * asset and that stranger as its seller, and the holder would be unable to list
 * their own asset: `prize_already_listed`, against a draft that appears in no
 * public listing, so they cannot even find the slug to cancel it. One request,
 * no wallet, no cost. The signature makes the slot takeable only by the wallet
 * that holds the thing.
 *
 * **`solana:signMessage`, and Q20 is the owner's decision to allow it.** Until
 * 2026-09-01 nothing on Solana asked for a message signature — `decisions.md`
 * Q18 records the absence as a gap rather than a principle, and Q20 is the
 * answer for this one surface. It stays this one surface: buying a ticket still
 * asks for no message, because a ticket buyer's payment is verified from the
 * chain's own record of who paid.
 *
 * **This module is pure and touches no network, no clock and no database.** The
 * caller supplies `nowMs`, which is what makes every branch testable in Node.
 *
 * WHO CALLS THIS: `POST /api/raffles` verifies; the browser's listing form at
 * `/raffle/new` builds the same message and asks the wallet to sign it. Both
 * import `sellerBindingMessage`, so there is one definition of what gets signed
 * rather than two that have to agree.
 */

import { ed25519 } from "@noble/curves/ed25519.js";
import { base58Decode } from "../base58";
import { BINDING_VALIDITY_MS } from "./evm-binding";

export type SellerBindingFields = {
  /** The site asking. Bound in so a signature taken elsewhere is not valid here. */
  domain: string;
  /** The wallet being claimed, base58, as Solana spells it. */
  address: string;
  /** Our chain id — `solana`, not a cluster name. See the ceiling note below. */
  chain: string;
  /** The asset being listed. This is the slot the signature is claiming. */
  prizeAsset: string;
  /** Client-chosen, 8–64 characters of hex. */
  nonce: string;
  /** ISO 8601. */
  issuedAt: string;
};

/**
 * The exact text a wallet is asked to sign.
 *
 * Shaped like `payerBindingMessage`, for the same reason: wallets render it as
 * plain text, and the first line is a sentence rather than a field list. A
 * prompt with no statement in it is one people learn to click through, and the
 * statement is what makes "I never agreed to that" a checkable claim.
 *
 * **It says what signing does NOT do.** Phantom shows a message-signing prompt
 * that looks, to somebody who has been warned about wallet drainers, exactly
 * like the thing they were warned about. Saying "this moves no funds" in the
 * text is the cheapest honest answer to that.
 */
export function sellerBindingMessage(fields: SellerBindingFields): string {
  return [
    `${fields.domain} wants you to prove you control this wallet.`,
    "",
    "Signing this does not move any funds and does not approve any spending.",
    "It only records that this wallet is the one listing this asset for a raffle.",
    "",
    `Address: ${fields.address}`,
    `Asset: ${fields.prizeAsset}`,
    `Chain: ${fields.chain}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt}`,
  ].join("\n");
}

export type SellerBindingRefusal =
  | "malformed_signature"
  | "bad_message"
  | "wrong_domain"
  | "wrong_chain"
  | "wrong_asset"
  | "expired"
  | "address_mismatch";

export type SellerBindingResult =
  | { ok: true; address: string }
  | { ok: false; reason: SellerBindingRefusal };

/**
 * Whether `signature` is an ed25519 signature of exactly the message these
 * fields produce, made by the wallet `fields.address` names.
 *
 * **The message is REBUILT here, never parsed from the client.** Accepting a
 * message string and checking that it "contains" the right asset would let a
 * caller sign one sentence and have it read as another; rebuilding means the
 * only text that can verify is the text this server would have asked for.
 *
 * **What this does not defend against, said out loud.** The nonce is chosen by
 * the client rather than issued here, so a captured pair can be replayed inside
 * the window — which re-creates a draft for the SAME asset by the SAME seller,
 * and the unique index refuses the second one anyway. It also binds the chain
 * and not the cluster, so a devnet signature would satisfy a mainnet request:
 * harmless today because the route independently reads ownership from ITS OWN
 * RPC, and a devnet mint is not a mainnet mint.
 * // ponytail: client nonce, chain-not-cluster. Issue single-use nonces
 * // server-side, and bind the classified cluster, if either ever produces a
 * // real complaint rather than a hypothetical one.
 */
export function verifySellerBinding(input: {
  signature: string;
  fields: SellerBindingFields;
  expectedDomain: string;
  expectedChain: string;
  expectedAsset: string;
  nowMs: number;
}): SellerBindingResult {
  const { fields } = input;

  // Shape before arithmetic: a malformed address is not a failed signature, and
  // telling them apart is the difference between "you typed it wrong" and
  // "somebody signed something else".
  const publicKey =
    typeof fields.address === "string" ? base58Decode(fields.address.trim()) : null;
  if (!publicKey || publicKey.length !== 32) return { ok: false, reason: "bad_message" };
  if (typeof fields.nonce !== "string" || !/^[0-9a-fA-F]{8,64}$/.test(fields.nonce)) {
    return { ok: false, reason: "bad_message" };
  }

  if (fields.domain !== input.expectedDomain) return { ok: false, reason: "wrong_domain" };
  if (fields.chain !== input.expectedChain) return { ok: false, reason: "wrong_chain" };
  // Case-sensitive, unlike the EVM comparison: base58 is case-significant and
  // two spellings that differ in case are two different addresses.
  if (fields.prizeAsset !== input.expectedAsset) return { ok: false, reason: "wrong_asset" };

  const issued = Date.parse(fields.issuedAt);
  if (!Number.isFinite(issued)) return { ok: false, reason: "bad_message" };
  // Both directions. A future timestamp is as wrong as a stale one, and
  // accepting one would let a signature be minted now and held indefinitely.
  const age = input.nowMs - issued;
  if (age > BINDING_VALIDITY_MS || age < -BINDING_VALIDITY_MS) {
    return { ok: false, reason: "expired" };
  }

  const signature =
    typeof input.signature === "string" ? base58Decode(input.signature.trim()) : null;
  if (!signature || signature.length !== 64) return { ok: false, reason: "malformed_signature" };

  const message = new TextEncoder().encode(sellerBindingMessage(fields));
  let verified = false;
  try {
    /**
     * `zip215: false` is RFC 8032 strict verification, which is what Solana's
     * own signature verification does. The permissive reading additionally
     * accepts signatures under small-order public keys; agreeing with the chain
     * is worth more here than accepting a signature the chain would not.
     */
    verified = ed25519.verify(signature, message, publicKey, { zip215: false });
  } catch {
    return { ok: false, reason: "malformed_signature" };
  }
  if (!verified) return { ok: false, reason: "address_mismatch" };

  return { ok: true, address: fields.address.trim() };
}
