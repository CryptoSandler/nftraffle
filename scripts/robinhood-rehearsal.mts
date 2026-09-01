/**
 * The Robinhood testnet rehearsal, as one command.
 *
 * **Why this exists.** `docs/testnet-rehearsal-robinhood.md` has thirteen checks
 * marked NOT RUN, blocked on funded testnet wallets and an ERC-721. When those
 * arrive, nobody should have to re-derive a signing procedure from a paragraph:
 * the difference between a runbook that gets run and one that gets skimmed is
 * whether the first step is a command or a reading comprehension exercise.
 *
 * **It also fixes a step that was not executable as written.** Check 4 said
 * "build the binding message the same way `payerBindingMessage` does" and then
 * showed `cast wallet sign ... "<the binding message>"`. That is a placeholder,
 * not a recipe — the same defect as 3b, which described a sequence the create
 * route refuses, and 4d, which needed a gap the prose did not give. This imports
 * the real function, so the message signed is the message verified.
 *
 *   npm run rehearse:robinhood -- --check   # prerequisites only, no chain writes
 *   npm run rehearse:robinhood              # the whole sequence
 *
 * WHO CALLS THIS: a person, from a terminal, once the wallets exist. Nothing in
 * the application imports it.
 */

import { execFileSync } from "node:child_process";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { payerBindingMessage, personalSignDigest } from "../src/lib/wallet/evm-binding";

const CHECK_ONLY = process.argv.includes("--check");

/** Everything this needs, and what it is for. Missing values are listed, not guessed. */
const REQUIRED = {
  API: "the local server, e.g. http://localhost:3000",
  ROBINHOOD_RPC_URL: "the testnet RPC endpoint",
  RH_SELLER_KEY: "0x-prefixed private key that owns the prize",
  RH_BUYER_KEY: "0x-prefixed private key with testnet ETH",
  RH_IMPOSTOR_KEY: "0x-prefixed private key with testnet ETH, for the negatives",
  RH_PRIZE: "the prize, as <contract>/<tokenId>",
  RH_PRIZE_2: "a SECOND token the seller owns, for the deposit negatives 3a and 3b",
  RH_PAYMENT_WALLET: "PAYMENT_WALLET_ROBINHOOD, so payments can be sent to it",
  RH_ESCROW_WALLET: "ESCROW_WALLET_ROBINHOOD, so the prize can be deposited",
  ADMIN_TOKEN: "to open an admin session for the draw and the payout",
  DATABASE_URL: "the rehearsal database, for the two checks that are SQL",
} as const;

const TESTNET_CHAIN_ID = 46630;

let failures = 0;
const pass = (name: string, detail = "") => console.log(`  PASS  ${name}${detail ? `  ${detail}` : ""}`);
const fail = (name: string, detail: string) => { failures++; console.log(`  FAIL  ${name}  ${detail}`); };
const skip = (name: string, why: string) => console.log(`  SKIP  ${name}  ${why}`);

function addressOf(privateKey: string): string {
  const key = Uint8Array.from(Buffer.from(privateKey.replace(/^0x/, ""), "hex"));
  const pub = secp256k1.getPublicKey(key, false);
  return `0x${Buffer.from(keccak_256(pub.subarray(1)).subarray(12)).toString("hex")}`;
}

/**
 * The payer binding, signed here rather than described in prose.
 *
 * The message comes from the same function the server rebuilds and verifies
 * against, so a mismatch is impossible by construction rather than by care.
 */
function signBinding(privateKey: string, slug: string, domain: string, chainId: number) {
  const fields = {
    domain,
    address: addressOf(privateKey),
    slug,
    chainId,
    nonce: Buffer.from(crypto.getRandomValues(new Uint8Array(8))).toString("hex"),
    issuedAt: new Date().toISOString(),
  };
  const key = Uint8Array.from(Buffer.from(privateKey.replace(/^0x/, ""), "hex"));
  const rec = secp256k1.sign(personalSignDigest(payerBindingMessage(fields)), key, {
    prehash: false,
    format: "recovered",
  });
  const signature = `0x${Buffer.from(rec.subarray(1)).toString("hex")}${(rec[0] + 27).toString(16).padStart(2, "0")}`;
  return { signature, ...fields };
}

async function rpc(url: string, method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return ((await response.json()) as { result?: unknown }).result;
}

async function prerequisites(): Promise<Record<string, string> | null> {
  console.log("\nPREREQUISITES");

  const missing = Object.entries(REQUIRED).filter(([name]) => !process.env[name]?.trim());
  if (missing.length > 0) {
    for (const [name, why] of missing) fail(name, `not set — ${why}`);
  } else {
    pass("every variable is set");
  }

  // `cast` does the chain writes. Checked before anything else, because a
  // rehearsal that gets halfway and then discovers this has left state behind.
  try {
    const version = execFileSync("cast", ["--version"], { encoding: "utf8" }).split("\n")[0];
    pass("cast is installed", version);
  } catch {
    fail("cast is not installed", "Foundry provides it: https://getfoundry.sh");
  }

  const rpcUrl = process.env.ROBINHOOD_RPC_URL?.trim();
  if (rpcUrl) {
    try {
      const id = await rpc(rpcUrl, "eth_chainId");
      const numeric = typeof id === "string" ? Number(BigInt(id)) : null;
      if (numeric === TESTNET_CHAIN_ID) pass("RPC is Robinhood testnet", `chain id ${numeric}`);
      else fail("RPC is not the testnet", `chain id ${numeric ?? "unreadable"}, expected ${TESTNET_CHAIN_ID}`);
    } catch {
      fail("RPC unreachable", rpcUrl.replace(/\/\/.*@/, "//<redacted>@"));
    }
  }

  const api = process.env.API?.trim();
  if (api) {
    try {
      const response = await fetch(`${api}/`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) pass("the server answers", `${api} -> ${response.status}`);
      else fail("the server did not answer 200", String(response.status));
    } catch {
      fail("the server is not running", `${api} — start it with the preview env first`);
    }
  }

  if (failures > 0) {
    console.log(`\n${failures} prerequisite(s) unmet. Nothing was written to any chain.\n`);
    return null;
  }
  return Object.fromEntries(Object.entries(REQUIRED).map(([n]) => [n, process.env[n]!.trim()]));
}

/**
 * The binding negatives, which need NO gas and no funded wallet.
 *
 * They are separated for that reason: they can be run today, against any open
 * raffle, and they are the only part of this rehearsal that could be verified
 * before the wallets exist.
 */
export async function bindingNegatives(api: string, slug: string, domain: string): Promise<void> {
  console.log("\nBINDING NEGATIVES (no gas required)");
  const buyer = "0x" + "11".repeat(32);
  const other = "0x" + "22".repeat(32);
  const payer = addressOf(buyer);

  const post = async (body: unknown) => {
    const response = await fetch(`${api}/api/raffles/${slug}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as { reason?: string; error?: string } };
  };

  const cases: [string, unknown, string][] = [
    ["4e no binding", { quantity: 1, payerPubkey: payer }, "binding required"],
    [
      "4f signed by another wallet",
      { quantity: 1, payerPubkey: payer, binding: { ...signBinding(other, slug, domain, TESTNET_CHAIN_ID), address: payer } },
      "address_mismatch",
    ],
    [
      "4g binding for another raffle",
      { quantity: 1, payerPubkey: payer, binding: signBinding(buyer, "some-other-raffle", domain, TESTNET_CHAIN_ID) },
      "wrong_slug",
    ],
    [
      "4h binding for the wrong chain",
      { quantity: 1, payerPubkey: payer, binding: signBinding(buyer, slug, domain, 4663) },
      "wrong_chain",
    ],
  ];

  for (const [name, body, expected] of cases) {
    const { status, body: answer } = await post(body);
    if (status === 400 && (answer.reason === expected || expected === "binding required")) {
      pass(name, `400 ${answer.reason ?? ""}`);
    } else {
      fail(name, `expected 400/${expected}, got ${status} ${answer.reason ?? answer.error ?? ""}`);
    }
  }

  // THE CONTROL. Without it every case above would pass against a route that
  // refuses everything, which is the shape a broken check takes.
  const { status, body: answer } = await post({
    quantity: 1,
    payerPubkey: payer,
    binding: signBinding(buyer, slug, domain, TESTNET_CHAIN_ID),
  });
  if (status === 400 && answer.reason?.startsWith("wrong")) {
    fail("control: a VALID binding", `was refused as ${answer.reason}`);
  } else {
    pass("control: a VALID binding gets past the binding check", `${status} ${answer.reason ?? "accepted"}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `cast`, with the RPC and key already threaded through. */
function cast(args: string[], key?: string): string {
  const rpc = process.env.ROBINHOOD_RPC_URL!.trim();
  const full = [...args, "--rpc-url", rpc, ...(key ? ["--private-key", key] : [])];
  return execFileSync("cast", full, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** A `cast send`, returning the transaction hash. */
function send(args: string[], key: string): string {
  const out = cast(["send", ...args, "--json"], key);
  const hash = (JSON.parse(out) as { transactionHash?: string }).transactionHash;
  if (!hash) throw new Error("cast send returned no transactionHash");
  return hash;
}

async function api(path: string, init?: RequestInit & { cookie?: string }) {
  const response = await fetch(`${process.env.API!.trim()}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.cookie ? { cookie: init.cookie } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* a redirect has no body */ }
  return { status: response.status, body, headers: response.headers };
}

async function sql(statement: string): Promise<{ ok: boolean; error?: string }> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try { await pool.query(statement); return { ok: true }; }
  catch (e) { return { ok: false, error: (e as Error).message }; }
  finally { await pool.end(); }
}

/** A positive check: its failure stops the run, because the rest depends on it. */
function must(name: string, ok: boolean, detail: string): void {
  if (ok) pass(name, detail);
  else { fail(name, detail); throw new Error(`stopped at ${name}`); }
}

/** A negative: it must refuse. A pass here is a STOP, but the run continues. */
function mustRefuse(name: string, status: number, reason: string | undefined, expected: string): void {
  const refused = status >= 400;
  if (refused && (reason === expected || expected === "*")) pass(name, `${status} ${reason ?? ""}`);
  else fail(name, `expected a refusal (${expected}), got ${status} ${reason ?? ""}`);
}

async function runSequence(env: Record<string, string>): Promise<void> {
  const [contract, tokenId] = env.RH_PRIZE.split("/");
  const [contract2, tokenId2] = env.RH_PRIZE_2.split("/");
  const seller = addressOf(env.RH_SELLER_KEY);
  const buyer = addressOf(env.RH_BUYER_KEY);
  const impostor = addressOf(env.RH_IMPOSTOR_KEY);
  const domain = new URL(env.API).host;
  const price = "0.001";
  const priceWei = 1_000_000_000_000_000n;

  const draft = (asset: string, wallet: string, ticketPrice = price, minutes = 15) =>
    api("/api/raffles", {
      method: "POST",
      body: JSON.stringify({
        chain: "robinhood", prizeAsset: asset, sellerWallet: wallet,
        ticketPrice, maxTickets: 5, durationMinutes: minutes,
      }),
    });

  console.log("\n1. CREATE THE DRAFT");
  const created = await draft(env.RH_PRIZE, seller);
  must("1 draft created", created.status === 201, `${created.status}`);
  const slug = created.body.slug as string;
  const endsAt = Date.parse(created.body.endsAt as string);
  const drawAt = Date.parse(created.body.drawAt as string);
  must("1 drawAt is endsAt + 10 minutes", drawAt - endsAt === 600_000, `${(drawAt - endsAt) / 1000}s`);
  must("1 no slot number, no seed", !("drawHeight" in created.body) && !("seed" in created.body),
    Object.keys(created.body).sort().join(","));

  const impostorDraft = await draft(env.RH_PRIZE, impostor);
  mustRefuse("1a seller does not hold the token", impostorDraft.status, "*", "*");
  const dear = await draft(env.RH_PRIZE, seller, "0.6");
  mustRefuse("1b price above Robinhood's ceiling", dear.status, dear.body.reason as string, "price_too_high");

  console.log("\n2-3. FEE, DEPOSIT, PUBLISH");
  const feeTx = send([env.RH_PAYMENT_WALLET, "--value", `${priceWei}`], env.RH_SELLER_KEY);
  const depositTx = send([contract, "transferFrom(address,address,uint256)", seller, env.RH_ESCROW_WALLET, tokenId], env.RH_SELLER_KEY);
  await sleep(5_000);
  const published = await api(`/api/raffles/${slug}/publish`, {
    method: "POST",
    body: JSON.stringify({ listingFeeSignature: feeTx, escrowSignature: depositTx }),
  });
  must("2 published", published.body.status === "open", `${published.status}`);
  const owner = cast(["call", contract, "ownerOf(uint256)(address)", tokenId]);
  must("3 the chain agrees the prize is in escrow",
    owner.toLowerCase().includes(env.RH_ESCROW_WALLET.toLowerCase().slice(2)), owner);

  console.log("\n3a-3c. DEPOSIT NEGATIVES");
  // 3a: deposit the second token, take it back out, then publish.
  const d3a = await draft(env.RH_PRIZE_2, seller);
  const slug3a = d3a.body.slug as string;
  const dep3a = send([contract2, "transferFrom(address,address,uint256)", seller, env.RH_ESCROW_WALLET, tokenId2], env.RH_SELLER_KEY);
  send([contract2, "transferFrom(address,address,uint256)", env.RH_ESCROW_WALLET, seller, tokenId2], env.RH_ESCROW_KEY ?? env.RH_SELLER_KEY);
  const fee3a = send([env.RH_PAYMENT_WALLET, "--value", `${priceWei}`], env.RH_SELLER_KEY);
  await sleep(5_000);
  const p3a = await api(`/api/raffles/${slug3a}/publish`, {
    method: "POST", body: JSON.stringify({ listingFeeSignature: fee3a, escrowSignature: dep3a }),
  });
  mustRefuse("3a deposit-and-withdraw", p3a.status, p3a.body.reason as string, "not_in_escrow");

  // 3b: the old receipt is `dep3a`, made more than 120s ago by the time this
  // draft exists. Re-deposit for real so `not_in_escrow` is not what answers.
  await sleep(125_000);
  const d3b = await draft(env.RH_PRIZE_2, seller);
  const slug3b = d3b.body.slug as string;
  send([contract2, "transferFrom(address,address,uint256)", seller, env.RH_ESCROW_WALLET, tokenId2], env.RH_SELLER_KEY);
  const fee3b = send([env.RH_PAYMENT_WALLET, "--value", `${priceWei}`], env.RH_SELLER_KEY);
  await sleep(5_000);
  const p3b = await api(`/api/raffles/${slug3b}/publish`, {
    method: "POST", body: JSON.stringify({ listingFeeSignature: fee3b, escrowSignature: dep3a }),
  });
  mustRefuse("3b deposit predating the draft", p3b.status, p3b.body.reason as string, "predates_draft");

  const feeImpostor = send([env.RH_PAYMENT_WALLET, "--value", `${priceWei}`], env.RH_IMPOSTOR_KEY);
  await sleep(5_000);
  const p3c = await api(`/api/raffles/${slug3b}/publish`, {
    method: "POST", body: JSON.stringify({ listingFeeSignature: feeImpostor, escrowSignature: dep3a }),
  });
  mustRefuse("3c fee paid by somebody else", p3c.status, p3c.body.reason as string, "wrong_payer");

  console.log("\n4. BUY A TICKET");
  await bindingNegatives(env.API, slug, domain);

  const order = await api(`/api/raffles/${slug}/orders`, {
    method: "POST",
    body: JSON.stringify({
      quantity: 2, payerPubkey: buyer,
      binding: signBinding(env.RH_BUYER_KEY, slug, domain, TESTNET_CHAIN_ID),
    }),
  });
  must("4 order opened", order.status === 201, `${order.status}`);
  must("4 reference is null on EVM", order.body.reference === null, String(order.body.reference));
  const payTx = send([env.RH_PAYMENT_WALLET, "--value", String(priceWei * 2n)], env.RH_BUYER_KEY);
  await sleep(5_000);
  const confirmed = await api(`/api/orders/${order.body.orderId}/confirm`, {
    method: "POST", body: JSON.stringify({ signature: payTx }),
  });
  must("4 tickets issued", confirmed.status === 200, JSON.stringify(confirmed.body.ticketNumbers));

  console.log("\n4a-4d. PAYMENT NEGATIVES");
  const mkOrder = async (payer: string, key: string, quantity = 1) =>
    api(`/api/raffles/${slug}/orders`, {
      method: "POST",
      body: JSON.stringify({ quantity, payerPubkey: payer, binding: signBinding(key, slug, domain, TESTNET_CHAIN_ID) }),
    });

  const o4a = await mkOrder(buyer, env.RH_BUYER_KEY);
  const pay4a = send([env.RH_PAYMENT_WALLET, "--value", `${priceWei}`], env.RH_IMPOSTOR_KEY);
  await sleep(5_000);
  const c4a = await api(`/api/orders/${o4a.body.orderId}/confirm`, {
    method: "POST", body: JSON.stringify({ signature: pay4a }),
  });
  mustRefuse("4a paid by the wrong wallet", c4a.status, c4a.body.reason as string, "wrong_payer");

  const o4b = await mkOrder(buyer, env.RH_BUYER_KEY);
  const c4b = await api(`/api/orders/${o4b.body.orderId}/confirm`, {
    method: "POST", body: JSON.stringify({ signature: payTx }),
  });
  mustRefuse("4b reused transaction hash", c4b.status, c4b.body.reason as string, "signature_reused");

  const o4c = await mkOrder(buyer, env.RH_BUYER_KEY);
  await sql(`UPDATE ticket_orders SET created_at = now() - interval '2 hours',
             expires_at = now() - interval '1 minute' WHERE id = '${o4c.body.orderId}'`);
  const pay4c = send([env.RH_PAYMENT_WALLET, "--value", `${priceWei}`], env.RH_BUYER_KEY);
  await sleep(5_000);
  const c4c = await api(`/api/orders/${o4c.body.orderId}/confirm`, {
    method: "POST", body: JSON.stringify({ signature: pay4c }),
  });
  mustRefuse("4c expired order", c4c.status, c4c.body.reason as string, "expired");

  // 4d needs a REAL gap. Measured against the clock, not against how long the
  // commands felt — this produced a false pass twice on the Solana runbook.
  const early = send([env.RH_PAYMENT_WALLET, "--value", `${priceWei}`], env.RH_BUYER_KEY);
  console.log("       waiting 130s so 4d's gap is genuinely outside the 120s skew…");
  await sleep(130_000);
  const o4d = await mkOrder(buyer, env.RH_BUYER_KEY);
  const c4d = await api(`/api/orders/${o4d.body.orderId}/confirm`, {
    method: "POST", body: JSON.stringify({ signature: early }),
  });
  mustRefuse("4d transfer predating the order", c4d.status, c4d.body.reason as string, "outside_window");

  console.log("\n5. CLOSE AND DRAW");
  const session = await api("/api/admin/session", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `token=${encodeURIComponent(env.ADMIN_TOKEN)}`,
  });
  const cookie = session.headers.get("set-cookie")?.split(";")[0] ?? "";
  must("5 admin session opened", cookie.length > 0, `${session.status}`);

  // 5b, on a raffle that is still open: the seed must not be published early.
  const verifyOpen = await fetch(`${env.API}/r/${slug3b}/verify`).then((r) => r.text());
  must("5b seed hidden before the draw", verifyOpen.includes("not revealed"), "");

  const raffleId = (await sql(`SELECT 1`)).ok
    ? await (async () => {
        const { Pool } = await import("pg");
        const pool = new Pool({ connectionString: env.DATABASE_URL });
        const r = await pool.query<{ id: string }>(`SELECT id FROM raffles WHERE slug = $1`, [slug]);
        await pool.end();
        return r.rows[0]?.id;
      })()
    : undefined;

  const untilDraw = drawAt - Date.now() + 15_000;
  if (untilDraw > 0) {
    console.log(`       waiting ${Math.ceil(untilDraw / 1000)}s for the close and the anchor…`);
    await sleep(untilDraw);
  }
  await fetch(`${env.API}/r/${slug}`);
  const drew = await api(`/api/admin/raffles/${raffleId}/draw`, { method: "POST", cookie });
  must("5 drawn", drew.status === 303, `${drew.status}`);
  const verified = await fetch(`${env.API}/r/${slug}/verify`).then((r) => r.text());
  must("5 the verify page recomputes and agrees", verified.includes("they agree"), "");

  console.log("\n5c. THE ANCHOR CONSTRAINTS");
  const c5c1 = await sql(`UPDATE raffles SET draw_block_time = ends_at - interval '1 minute' WHERE slug = '${slug}'`);
  mustRefuse("5c block from during the sale", c5c1.ok ? 200 : 409,
    c5c1.error?.includes("raffles_anchor_block_after_close") ? "raffles_anchor_block_after_close" : c5c1.error, "raffles_anchor_block_after_close");
  const c5c2 = await sql(`UPDATE raffles SET draw_at = ends_at - interval '1 minute' WHERE slug = '${slug}'`);
  mustRefuse("5c anchor before the close", c5c2.ok ? 200 : 409,
    c5c2.error?.includes("raffles_anchor_after_close") ? "raffles_anchor_after_close" : c5c2.error, "raffles_anchor_after_close");

  console.log("\n6. PAY OUT");
  const winner = await (async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: env.DATABASE_URL });
    const r = await pool.query<{ winner_wallet: string }>(`SELECT winner_wallet FROM raffles WHERE slug = $1`, [slug]);
    await pool.end();
    return r.rows[0]?.winner_wallet;
  })();

  const escrowKey = env.RH_ESCROW_KEY;
  if (!escrowKey) {
    skip("6, 6a, 6b", "RH_ESCROW_KEY not set — the escrow key is the owner's and this script does not need it for anything else");
    return;
  }

  // 6a first, because it must be undone before the real payout can be made.
  const wrongTx = send([contract, "transferFrom(address,address,uint256)", env.RH_ESCROW_WALLET, impostor, tokenId], escrowKey);
  const proceedsShort = send([seller, "--value", `${priceWei}`], env.RH_PAYMENT_WALLET_KEY ?? escrowKey);
  await sleep(5_000);
  const paid6a = await api(`/api/admin/raffles/${raffleId}/paid`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    cookie,
    body: `prizeSignature=${wrongTx}&proceedsSignature=${proceedsShort}`,
  });
  mustRefuse("6a prize sent to the wrong wallet", paid6a.status, paid6a.body.reason as string, "prize_wrong_recipient");

  // RECOVERY. Without this the prize is stranded with the impostor and the
  // real payout below cannot be made.
  send([contract, "transferFrom(address,address,uint256)", impostor, env.RH_ESCROW_WALLET, tokenId], env.RH_IMPOSTOR_KEY);
  console.log("       6a recovered: the prize is back in escrow");

  const prizeTx = send([contract, "transferFrom(address,address,uint256)", env.RH_ESCROW_WALLET, winner, tokenId], escrowKey);
  const paid6b = await api(`/api/admin/raffles/${raffleId}/paid`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    cookie,
    body: `prizeSignature=${prizeTx}&proceedsSignature=${proceedsShort}`,
  });
  mustRefuse("6b seller underpaid", paid6b.status, paid6b.body.reason as string, "insufficient_amount");
}

async function main(): Promise<void> {
  console.log("Robinhood testnet rehearsal — docs/testnet-rehearsal-robinhood.md");
  const env = await prerequisites();
  if (!env) process.exit(1);

  if (CHECK_ONLY) {
    console.log("\n--check: prerequisites only. Nothing was written to any chain.\n");
    return;
  }

  console.log("\nThis writes to the testnet and takes about 30 minutes, most of it waiting.");
  try {
    await runSequence(env);
  } catch (error) {
    console.log(`\nSTOPPED: ${(error as Error).message}`);
    console.log("A positive check failed, so the run stopped rather than reporting later");
    console.log("checks that could not have meant anything. State may be left in escrow.");
  }
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILURE(S)`} — a negative that did not refuse is a STOP.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

if (!process.env.VITEST) await main();
