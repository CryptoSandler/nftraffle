import { readFile } from "node:fs/promises";
import { ed25519 } from "@noble/curves/ed25519.js";
import { randomBytes } from "node:crypto";
import { base58Encode } from "../src/lib/base58.ts";
import { sellerBindingMessage } from "../src/lib/wallet/solana-binding.ts";

/**
 * Produces the seller binding a Solana raffle draft now needs, from a keypair
 * file, so a runbook can keep creating drafts with curl.
 *
 * **WHY THIS EXISTS.** `POST /api/raffles` stopped taking a seller's wallet on
 * the caller's word (`docs/decisions.md` Q20). The listing form signs with the
 * browser's wallet; a shell has no wallet, and `docs/devnet-rehearsal.md`,
 * `docs/testnet-rehearsal-robinhood.md` and `docs/first-raffle.md` all create
 * drafts from a terminal. Without this the project's main verification
 * instrument would have been broken by the change it is meant to verify.
 *
 * **It signs a MESSAGE and never a transaction**, so the worst a stolen output
 * can do is open a draft for an asset the signer already holds — which the
 * unique index allows exactly one of anyway.
 *
 * WHO CALLS THIS: a person following a runbook. Nothing in `src/` imports it.
 *
 *   npx tsx scripts/sign-seller-binding.mts \
 *     --keypair ~/.config/solana/nftraffle-devnet/seller.json \
 *     --asset <MINT> --domain localhost:3000
 */

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const keypairPath = arg("keypair");
const asset = arg("asset");
const domain = arg("domain");

if (!keypairPath || !asset || !domain) {
  console.error(
    "usage: sign-seller-binding.mts --keypair <path> --asset <mint> --domain <host[:port]>\n" +
      "  --domain is the HOST the request will carry, exactly: `localhost:3000`,\n" +
      "  not `http://localhost:3000`. The server rebuilds the message from its own\n" +
      "  host, so a mismatch here refuses with `wrong_domain`.",
  );
  process.exit(2);
}

/**
 * Solana's keypair file is a 64-number JSON array: the 32-byte seed followed by
 * the 32-byte public key. `@noble/curves` takes the seed and derives the public
 * half itself, which is also the check — a file whose halves disagree fails
 * here rather than producing a signature nobody can verify.
 */
const raw = JSON.parse(await readFile(keypairPath, "utf8")) as number[];
if (!Array.isArray(raw) || raw.length !== 64) {
  console.error(`${keypairPath} is not a 64-byte Solana keypair file.`);
  process.exit(2);
}
const secretKey = Uint8Array.from(raw.slice(0, 32));
const publicKey = ed25519.getPublicKey(secretKey);
const declared = base58Encode(Uint8Array.from(raw.slice(32)));
const address = base58Encode(publicKey);
if (declared !== address) {
  console.error(`${keypairPath}: the public half does not match the secret half.`);
  process.exit(2);
}

const fields = {
  domain,
  address,
  chain: "solana",
  prizeAsset: asset,
  nonce: randomBytes(8).toString("hex"),
  issuedAt: new Date().toISOString(),
};

const signature = base58Encode(
  ed25519.sign(new TextEncoder().encode(sellerBindingMessage(fields)), secretKey),
);

// The binding object, ready to splice into the request body. The window is five
// minutes (`BINDING_VALIDITY_MS`), so this is signed at the moment it is used.
console.log(JSON.stringify({ signature, fields }, null, 2));
