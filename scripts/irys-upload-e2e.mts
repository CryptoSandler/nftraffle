import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58Encode } from "../src/lib/base58";
import { uploadLaunchMetadata, type UploadWallet } from "../src/lib/launch/irys";

/**
 * The creator's upload, end to end, with a keypair standing in for the wallet.
 *
 * **It drives the same module the browser drives.** The Irys client wants three
 * methods — a public key, a message signature, and a way to send a transaction
 * — and `UploadWallet` is that shape rather than any particular wallet's. So a
 * keypair can play the part, and what gets verified here is the real upload
 * path rather than a rehearsal of it.
 *
 * **What it cannot verify is what Phantom shows**, which is why
 * `docs/wallet-warnings.md` has a three-line check for a person with a real
 * wallet. Two verifications, deliberately: this one says the flow works, that
 * one says the prompt is one a person should agree to.
 *
 *   npm run e2e:irys
 *
 * WHO CALLS THIS: a person checking the upload path after touching it.
 */

config({ path: ".env.local" });

const API = process.env.API ?? "http://localhost:3101";
const KEYPAIR = process.env.KEYPAIR ?? `${process.env.HOME}/.config/solana/nftraffle-devnet/seller.json`;

const raw = JSON.parse(readFileSync(KEYPAIR, "utf8")) as number[];
const seed = Uint8Array.from(raw.slice(0, 32));
const address = base58Encode(ed25519.getPublicKey(seed));

/** The control: whose server is this, before anything is signed or paid. */
const identity = await fetch(`${API}/launch`);
if (!identity.ok || !(await identity.text()).includes("Launch a collection")) {
  console.error(`${API} is not this project's server (HTTP ${identity.status}). Start it with npm start.`);
  process.exit(2);
}
console.log(`server at ${API}: this project`);

const wallet: UploadWallet = {
  address,
  signMessageBytes: async (message) => ed25519.sign(message, seed),
  signAndSendSerialized: async (transaction) => {
    // The browser hands this to the wallet. Here the keypair signs the compiled
    // message in place, the same way the rehearsal scripts do.
    const bytes = Uint8Array.from(transaction);
    const message = bytes.subarray(1 + 64 * bytes[0]!);
    bytes.set(ed25519.sign(message, seed), 1);
    const response = await fetch(`${API}/api/rpc/solana`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: [Buffer.from(bytes).toString("base64"), { encoding: "base64" }],
      }),
    });
    const body = await response.json();
    if (!body.result) throw new Error(`funding refused: ${JSON.stringify(body.error ?? body)}`);
    return body.result as string;
  },
};

/**
 * A one-pixel PNG by default; `IMAGE=<path>` for a real one.
 *
 * **Size decides whether the funding path runs at all.** Irys takes a small
 * upload with no balance — both a one-pixel PNG and a 40 KB one went through on
 * a wallet with nothing deposited — so a run with the default image verifies
 * the upload and NOT `signAndSendSerialized`. Point `IMAGE` at something over
 * about 100 KB to exercise the funding transfer, which is the part that goes
 * through this deployment's own RPC proxy.
 */
const PNG = process.env.IMAGE
  ? readFileSync(process.env.IMAGE)
  : Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
console.log("image bytes:", PNG.length);

console.log("uploading as", address);
const result = await uploadLaunchMetadata({
  wallet,
  image: { bytes: PNG, contentType: "image/png" },
  name: "Irys e2e",
  symbol: "IRYS",
  description: "Uploaded by scripts/irys-upload-e2e.mts",
  devnet: true,
  // Through OUR proxy, exactly as the browser does — which is also a check that
  // the proxy's method whitelist covers what the upload needs.
  rpcUrl: `${API}/api/rpc/solana`,
  onStep: (note) => console.log(" ", note),
});

console.log("image:   ", result.imageUri);
console.log("metadata:", result.metadataUri);

// The upload is not the claim. Being able to READ it back, from a host this
// site is allowed to render, is.
const fetched = await fetch(result.metadataUri, { redirect: "follow" });
const json = await fetched.json();
console.log("served:", fetched.status, "| final host:", new URL(fetched.url).host);
console.log("metadata image field:", json.image);

const { isAllowedImageHost } = await import("../src/lib/image-hosts");
console.log("metadata address passes the launch check:", isAllowedImageHost(result.metadataUri));
console.log("image address passes the launch check:", isAllowedImageHost(json.image));
if (!isAllowedImageHost(result.metadataUri) || !isAllowedImageHost(json.image)) {
  console.error("\nSTOP: an address this site cannot render would produce a blank mint page.");
  process.exit(1);
}
console.log("\nOK: uploaded, served, and renderable.");
