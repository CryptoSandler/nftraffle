import { webcrypto } from "node:crypto";
import { base58Encode } from "../../base58";

/**
 * The Solana Pay reference key.
 *
 * **Moved here out of `raffles/tickets.ts` when the seam was cut**, and that
 * move is the point: a reference key is a Solana Pay convention, not a property
 * of raffles. EVM has no equivalent and needs none — transfers to the payment
 * wallet can be listed by block range and matched on (from, value, window),
 * which does not depend on the payer's client having attached anything. The
 * adapter interface returns `string | null` so the absence is a first-class
 * answer rather than a stub.
 *
 * A fresh, unguessable public key rides along on the payment transaction as a
 * read-only account, so a later pass can find a payment whose payer never came
 * back with the signature.
 *
 * **THIS PROJECT HOLDS NO PRIVATE KEY AND THIS FUNCTION IS WHY IT STAYS TRUE.**
 * It generates an Ed25519 keypair and reads out only the public half. The
 * private `CryptoKey` is never exported, never serialised, and never touched
 * again — it falls out of scope when this returns. There is deliberately no
 * `exportKey` call on it here or anywhere downstream, and a future change that
 * stored it would be a change to SECURITY.md I1 before it was a change to this
 * file.
 *
 * WHO CALLS THIS: `chain/solana/index.ts`, as the adapter's `paymentReference`.
 */
export async function generateReference(): Promise<string> {
  const keyPair = (await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as webcrypto.CryptoKeyPair;
  const rawPublicKey = await webcrypto.subtle.exportKey("raw", keyPair.publicKey);
  return base58Encode(new Uint8Array(rawPublicKey));
}
