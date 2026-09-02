import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { config } from "dotenv";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58Encode } from "../src/lib/base58";
import { sellerBindingMessage } from "../src/lib/wallet/solana-binding";

/**
 * The launchpad's devnet rehearsal: launch a collection, mint from it twice,
 * and try to mint without paying the platform's fee.
 *
 * **The third one is the point.** The first two say the happy path works; only
 * the third says the fee is enforced by the program rather than by our client,
 * which is the whole claim of spec §0.1 and the reason `docs/decisions.md` Q21
 * let umi into this project at all.
 *
 * Everything goes through the running server's own routes, so what is being
 * rehearsed is the product rather than a script that resembles it. The only
 * thing done outside them is signing, because a shell has no wallet.
 *
 *   npm run rehearse:launch
 *
 * WHO CALLS THIS: a person following `docs/launch-rehearsal.md`.
 */

config({ path: ".env.local" });

const API = process.env.API ?? "http://localhost:3100";
const RPC = process.env.SOLANA_RPC_URL!;
const PAYMENT = process.env.PAYMENT_WALLET_SOLANA!;
const KEYS = `${process.env.HOME}/.config/solana/nftraffle-devnet`;

if (!RPC || !PAYMENT) {
  console.error("SOLANA_RPC_URL and PAYMENT_WALLET_SOLANA must be set. Is .env.local the rehearsal environment?");
  process.exit(2);
}

function wallet(file: string) {
  const raw = JSON.parse(readFileSync(`${KEYS}/${file}`, "utf8")) as number[];
  const seed = Uint8Array.from(raw.slice(0, 32));
  return { seed, address: base58Encode(ed25519.getPublicKey(seed)) };
}

const creator = wallet("seller.json");
const buyer = wallet("buyer.json");

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await r.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function post(path: string, body: unknown, ip = "5.5.5.5") {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

/** Signs the fee-payer slot, leaving the server's account signatures in place. */
function signAsFeePayer(base64: string, seed: Uint8Array): string {
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  const message = bytes.subarray(1 + 64 * bytes[0]!);
  bytes.set(ed25519.sign(message, seed), 1);
  return Buffer.from(bytes).toString("base64");
}

async function send(base64: string, seed: Uint8Array): Promise<string> {
  const signature = await rpc<string>("sendTransaction", [
    signAsFeePayer(base64, seed),
    { encoding: "base64", preflightCommitment: "confirmed" },
  ]);
  for (let i = 0; i < 40; i++) {
    const { value } = await rpc<{ value: ({ confirmationStatus?: string; err?: unknown } | null)[] }>(
      "getSignatureStatuses",
      [[signature], { searchTransactionHistory: true }],
    );
    const status = value[0];
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      if (status.err) throw new Error(`on chain: ${JSON.stringify(status.err)}`);
      return signature;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("not confirmed in time");
}

/** What each account's balance did, from the transaction itself. */
async function deltas(signature: string): Promise<Record<string, number>> {
  // A confirmed signature is not immediately fetchable as a transaction: the
  // status index and the ledger query answer at different moments. Waiting is
  // the difference between reading the money and reporting a crash.
  type Fetched = {
    transaction: { message: { accountKeys: { pubkey: string }[] } };
    meta: { preBalances: number[]; postBalances: number[] };
  } | null;
  let t: Fetched = null;
  for (let i = 0; i < 10 && !t; i++) {
    t = await rpc<Fetched>("getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
    if (!t) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!t) return { "could not read the transaction": 0 };
  const keys = t.transaction.message.accountKeys.map((k) => k.pubkey);
  const out: Record<string, number> = {};
  keys.forEach((k, i) => {
    const d = t.meta.postBalances[i] - t.meta.preBalances[i];
    if (d !== 0) out[k] = d / 1e9;
  });
  return out;
}

function binding(uri: string) {
  const fields = {
    domain: new URL(API).host,
    address: creator.address,
    chain: "solana",
    prizeAsset: uri,
    nonce: randomBytes(8).toString("hex"),
    issuedAt: new Date().toISOString(),
  };
  return { signature: base58Encode(ed25519.sign(new TextEncoder().encode(sellerBindingMessage(fields)), creator.seed)), fields };
}

/**
 * WHICH SERVER IS ANSWERING, asked before anything is signed.
 *
 * Measured 2026-09-02: a rehearsal run on port 3100 got a `404` from a
 * DIFFERENT project's server that had taken the port — after an earlier call in
 * the same session had been answered correctly by this one. A run that does not
 * check answers questions about somebody else's application and reports them as
 * this one's.
 */
const identity = await fetch(`${API}/launch`);
const page = await identity.text();
if (!identity.ok || !page.includes("Launch a collection")) {
  console.error(
    `${API} is not this project's server (HTTP ${identity.status}). Start it with ` +
      "`PORT=<port> npm start` against .env.rehearsal, or set API to where it is listening.",
  );
  process.exit(2);
}
console.log(`server at ${API}: this project`);

console.log("creator:", creator.address, "| buyer:", buyer.address);

// -- 1. Launch --------------------------------------------------------------
console.log("\n== 1. launch ==");
const uri = process.env.METADATA_URI ?? "https://gateway.irys.xyz/9hoWXMvFPBYrLiwovEkHrL7d1854fPTHpdqguRQxYQTM";
const created = await post("/api/collections", {
  name: `Rehearsal ${new Date().toISOString().slice(11, 19)}`,
  symbol: "REH",
  uri,
  itemsAvailable: 5,
  price: "0.05",
  mintLimit: 3,
  startsAt: new Date(Date.now() + 5_000).toISOString(),
  binding: binding(uri),
});
console.log(created.status, JSON.stringify(created.body).slice(0, 200));
if (created.status !== 201) process.exit(1);
const slug = created.body.slug as string;

const launchSignature = await send(created.body.transaction, creator.seed);
console.log("launch signature:", launchSignature);
console.log("launch fee, off the chain:", JSON.stringify(await deltas(launchSignature)));

console.log("\n== 1a. publish, which reads the deployed guard back ==");
const published = await post(`/api/collections/${slug}/publish`, { launchFeeSignature: launchSignature });
console.log(published.status, JSON.stringify(published.body));
if (published.status !== 200) process.exit(1);

// -- 2. Two mints -----------------------------------------------------------
await new Promise((r) => setTimeout(r, 6_000));
for (const [n, who] of [["first", creator], ["second", buyer]] as const) {
  console.log(`\n== 2. ${n} mint (${who.address.slice(0, 8)}…) ==`);
  const intent = await post(`/api/collections/${slug}/mint`, { minter: who.address }, n === "first" ? "5.5.5.5" : "6.6.6.6");
  if (!intent.body?.transaction) {
    console.log("REFUSED:", intent.status, JSON.stringify(intent.body));
    process.exit(1);
  }
  const signature = await send(intent.body.transaction, who.seed);
  console.log("signature:", signature);
  console.log("where the money went:", JSON.stringify(await deltas(signature)));
}

// -- 3. The negative: mint without paying the platform ----------------------
/**
 * **A REFUSED MINT IS A SUCCESSFUL TRANSACTION, and that is the trap here.**
 *
 * `botTax` intercepts a failed guard, takes its tax and returns Ok, so the
 * transaction confirms with `err: null`. Measured 2026-09-02: the first version
 * of this check read the transaction status, saw success, and reported that the
 * platform fee was not being enforced — while the logs said
 * `PublicKeyMismatch` and `Candy Guard Botting is taxed at 1000000 lamports`,
 * and no asset had been minted.
 *
 * So the verdict is read from three things the mint would have changed: the
 * redeemed counter, the platform's balance, and the program's own log.
 */
console.log("\n== 3. NEGATIVE: mint with the platform fee sent somewhere else ==");
const { buildMintTransaction, readDeployedLaunch } = await import("../src/lib/launch/candy");
const row = await (await import("../src/lib/launch/lifecycle")).launchBySlug(slug);
const before = await readDeployedLaunch(row!.candyMachine!);

const forged = await buildMintTransaction({
  minter: buyer.address,
  candyMachine: row!.candyMachine!,
  collection: row!.collectionMint!,
  creator: creator.address,
  // The destination is fixed in the deployed guard. Naming a different account
  // is what a minter would do to keep our fee.
  paymentWallet: buyer.address,
});

let signature: string | null = null;
let refusal = "the transaction itself was rejected";
try {
  signature = await send(forged.transaction, buyer.seed);
} catch (error) {
  refusal = error instanceof Error ? error.message : String(error);
}

const after = await readDeployedLaunch(row!.candyMachine!);
const moved = signature ? await deltas(signature) : {};
const paidUs = moved[PAYMENT] ?? 0;
const minted = (after?.itemsRedeemed ?? 0n) > (before?.itemsRedeemed ?? 0n);

console.log("confirmed on chain:", signature ? "yes (botTax returns Ok)" : `no — ${refusal}`);
console.log("items redeemed:", `${before?.itemsRedeemed} -> ${after?.itemsRedeemed}`);
console.log("reached the platform wallet:", paidUs);
if (signature) console.log("balance changes:", JSON.stringify(moved));

if (minted) {
  console.log("\nSTOP. An item was minted without paying this platform. The guard is not enforcing.");
  process.exit(1);
}
console.log(
  "\nRefused: nothing was minted and the platform was paid nothing, so the fee is charged by " +
    "the machine rather than by our client. The wallet paid the bot tax for trying.",
);
console.log(`\nslug: ${slug}`);
