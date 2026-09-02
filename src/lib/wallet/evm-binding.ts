/**
 * Proving that whoever opened an order controls the EVM address it names.
 *
 * **WHY THIS EXISTS, and why Solana has no equivalent.** An order records a
 * payer address, and settlement later refuses any transfer whose `from` is not
 * that address (`checkWindowAndPayer`). That much already stops an attacker
 * claiming a stranger's transfer for their own order. What it does NOT stop is
 * the mirror image: opening an order in a STRANGER'S name, then waiting for a
 * transfer they made for their own reasons to fall inside its window and
 * claiming it against the order we opened. The window makes that narrow rather
 * than impossible, and on a chain whose blocks are a tenth of a second apart,
 * narrow is not the word anyone wants about somebody else's money.
 *
 * A signature closes it: the order names an address only if the holder of that
 * address said so.
 *
 * **`personal_sign` (EIP-191), not `eth_signTypedData`.** Every injected wallet
 * implements it, it renders as readable text rather than a struct, and what is
 * being signed here IS a sentence a person should read before agreeing to it.
 * Typed data buys domain separation that the message text already states.
 *
 * **This module is pure and touches no network, no clock and no database.**
 * The caller supplies `nowMs`. That is what makes the verification testable in
 * Node, and it is the same discipline `raffles/draw.ts` follows.
 *
 * WHO CALLS THIS: `POST /api/raffles/[slug]/orders` verifies; the browser's
 * `components/useEvmWallet.ts` builds the same message and asks the wallet to
 * sign it. Both import `payerBindingMessage`, so there is one definition of
 * what gets signed rather than two that must agree.
 */

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

/**
 * How long a binding signature is good for.
 *
 * Short, because the message carries a client-chosen nonce rather than a
 * server-issued one — see the ceiling note on `verifyPayerBinding`. Five
 * minutes is long enough for somebody to read the prompt and press the button,
 * and short enough that a captured signature is stale before it is worth
 * anything.
 */
export const BINDING_VALIDITY_MS = 5 * 60_000;

export type BindingFields = {
  /** The site asking. Bound in so a signature taken elsewhere is not valid here. */
  domain: string;
  /** The address being claimed, as the wallet spells it. */
  address: string;
  /** Which raffle. A signature for one raffle does not open an order on another. */
  slug: string;
  /** EIP-155 chain id, so a signature for a testnet is not valid on mainnet. */
  chainId: number;
  /** Client-chosen, 8–64 characters of hex. */
  nonce: string;
  /** ISO 8601. */
  issuedAt: string;
};

/**
 * The exact text a wallet is asked to sign.
 *
 * Modelled on EIP-4361 so wallets render it in the shape people have learned to
 * read, but this is an ORDER BINDING, not a login: nothing here creates a
 * session, and the server stores no token as a result.
 *
 * **The first line is a plain sentence, deliberately.** A signing prompt full
 * of fields with no statement is one people click through. The statement is
 * what makes "I did not agree to that" a checkable claim.
 */
export function payerBindingMessage(fields: BindingFields): string {
  return [
    `${fields.domain} wants you to prove you control this wallet.`,
    "",
    "Signing this does not move any funds and does not approve any spending.",
    "It only records that this wallet is the one that will pay for this order.",
    "",
    `Address: ${fields.address}`,
    `Raffle: ${fields.slug}`,
    `Chain ID: ${fields.chainId}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt}`,
  ].join("\n");
}

/**
 * The EIP-191 `personal_sign` digest.
 *
 * `keccak256("\x19Ethereum Signed Message:\n" + byteLength + message)`. The
 * length is the count of BYTES, not characters — a message with any non-ASCII
 * in it hashes differently under the two readings, and a wallet uses bytes.
 */
export function personalSignDigest(message: string): Uint8Array {
  const body = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${body.length}`);
  const joined = new Uint8Array(prefix.length + body.length);
  joined.set(prefix, 0);
  joined.set(body, prefix.length);
  return keccak_256(joined);
}

/** An address from an uncompressed public key: the low 20 bytes of its keccak. */
export function addressFromPublicKey(uncompressed: Uint8Array): string {
  // Drop the 0x04 prefix; the hash is over the 64 coordinate bytes.
  const hashed = keccak_256(uncompressed.subarray(1));
  return `0x${Buffer.from(hashed.subarray(12)).toString("hex")}`;
}

export type BindingRefusal =
  | "malformed_signature"
  | "bad_message"
  | "wrong_domain"
  | "wrong_slug"
  | "wrong_chain"
  | "expired"
  | "address_mismatch";

export type BindingResult =
  | { ok: true; address: string }
  | { ok: false; reason: BindingRefusal };

/**
 * Whether `signature` is a `personal_sign` of exactly the message these fields
 * produce, made by `fields.address`.
 *
 * **The message is REBUILT here, never parsed from the client.** Accepting a
 * message string and checking that it "contains" the right slug would let a
 * caller sign one sentence and have it read as another; rebuilding means the
 * only text that can verify is the text this server would have asked for.
 *
 * **What this does not defend against, said out loud.** The nonce is chosen by
 * the client, not issued by this server, so a captured message-and-signature
 * pair can be replayed to open another order for the SAME address on the SAME
 * raffle inside the validity window. That is a nuisance rather than a theft —
 * it names a payer who really did sign, opens an order nobody has to pay, and
 * is rate-limited like any other order. Closing it needs a server-issued
 * single-use nonce, which is a table and a round trip.
 * // ponytail: client nonce with a 5-minute window; issue and burn nonces
 * // server-side if order spam by replay ever shows up in `ticket_orders`.
 */
export function verifyPayerBinding(input: {
  signature: string;
  fields: BindingFields;
  expectedDomain: string;
  expectedSlug: string;
  expectedChainId: number;
  nowMs: number;
}): BindingResult {
  const { fields } = input;

  if (typeof fields.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(fields.address.trim())) {
    return { ok: false, reason: "bad_message" };
  }
  if (typeof fields.nonce !== "string" || !/^[0-9a-fA-F]{8,64}$/.test(fields.nonce)) {
    return { ok: false, reason: "bad_message" };
  }
  if (fields.domain !== input.expectedDomain) return { ok: false, reason: "wrong_domain" };
  if (fields.slug !== input.expectedSlug) return { ok: false, reason: "wrong_slug" };
  if (fields.chainId !== input.expectedChainId) return { ok: false, reason: "wrong_chain" };

  const issued = Date.parse(fields.issuedAt);
  if (!Number.isFinite(issued)) return { ok: false, reason: "bad_message" };
  // Both directions. A future timestamp is as wrong as a stale one, and
  // accepting one would let a signature be minted now and held indefinitely.
  const age = input.nowMs - issued;
  if (age > BINDING_VALIDITY_MS || age < -BINDING_VALIDITY_MS) {
    return { ok: false, reason: "expired" };
  }

  const raw = input.signature.trim();
  if (!/^0x[0-9a-fA-F]{130}$/.test(raw)) return { ok: false, reason: "malformed_signature" };

  const bytes = Buffer.from(raw.slice(2), "hex");
  // The last byte is `v`: 27/28 in the original scheme, 0/1 as some wallets
  // emit it. Anything else is not a recovery id.
  const v = bytes[64];
  const recovery = v === 27 || v === 28 ? v - 27 : v;
  if (recovery !== 0 && recovery !== 1) return { ok: false, reason: "malformed_signature" };

  let recovered: string;
  try {
    const digest = personalSignDigest(payerBindingMessage(fields));
    const sig = secp256k1.Signature.fromCompact(
      Uint8Array.from(bytes.subarray(0, 64)),
    ).addRecoveryBit(recovery);
    recovered = addressFromPublicKey(sig.recoverPublicKey(digest).toRawBytes(false));
  } catch {
    return { ok: false, reason: "malformed_signature" };
  }

  // Case-insensitive: EIP-55 checksummed and lowercase spellings are the same
  // address, and refusing on case would reject real wallets.
  if (recovered.toLowerCase() !== fields.address.trim().toLowerCase()) {
    return { ok: false, reason: "address_mismatch" };
  }

  return { ok: true, address: recovered };
}
