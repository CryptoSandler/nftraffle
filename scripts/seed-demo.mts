/**
 * Demo data for local development, written through the REAL code paths.
 *
 * Deliberately not raw INSERTs. Driving `createDraft` -> `openRaffle` ->
 * `createTicketOrder` -> `settleTicketOrder` -> `recordDraw` means this script
 * is also a wiring check: if a transition grows a precondition the seed does
 * not satisfy, this fails loudly rather than producing rows the application
 * could never have created.
 *
 * The verifier is stubbed — there is no chain here — and that is the only thing
 * faked. Everything else is the code the application runs.
 *
 * WHO CALLS THIS: a developer, by hand: `npx tsx scripts/seed-demo.mts`.
 * Nothing in the application calls it and nothing should.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
const { commitSeed, deriveWinner } = await import("../src/lib/raffles/draw");
const { createDraft, openRaffle, advanceRaffle, recordDraw } = await import("../src/lib/raffles/lifecycle");
const { createTicketOrder, settleTicketOrder, ticketsFor } = await import("../src/lib/raffles/tickets");
const { closePool } = await import("../src/lib/db");

const A = "6dNVEXCsBpisPjcyanBz4qgpm2SXPkR7wRPmuA6cxRLW";
const B = "3Nq7EtQe3aUZLxRUkzYq9c6DdShxWFRp3wY4qWCTGVAH";
const WALLET = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

// An open raffle, mid-sale.
const live = commitSeed();
const openDraft = await createDraft({
  slug: "demo-open", sellerWallet: A, prizeMint: "MintOpen1111111111111111111111111111111111",
  collectionId: null, ticketPriceLamports: 250_000_000n, maxTickets: 20, houseFeeBps: 500,
  drawSlot: 999_000_001n, endsAt: new Date(Date.now() + 3 * 3600_000), seedHash: live.seedHash,
});
if (!openDraft.ok) throw new Error(openDraft.reason);
const opened = await openRaffle(openDraft.raffle.id, { listingFeeSignature: "seedL1", escrowSignature: "seedE1" });
if (!opened.ok) throw new Error(opened.reason);
const o1 = await createTicketOrder({ raffleId: opened.raffle.id, quantity: 3, payerPubkey: B, ipHash: null });
if (!o1.ok) throw new Error(o1.reason);
await settleTicketOrder({ orderId: o1.order.id, signature: "seedPay1", paymentWallet: WALLET,
  verify: async () => ({ ok: true, payer: B, lamports: 750_000_000n, blockTimeMs: Date.now() }) });

// A drawn raffle, so the verify page has something to check.
const done = commitSeed();
const drawnDraft = await createDraft({
  slug: "demo-drawn", sellerWallet: A, prizeMint: "MintDrawn111111111111111111111111111111111",
  collectionId: null, ticketPriceLamports: 100_000_000n, maxTickets: 5, houseFeeBps: 500,
  drawSlot: 999_000_002n, endsAt: new Date(Date.now() + 3600_000), seedHash: done.seedHash,
});
if (!drawnDraft.ok) throw new Error(drawnDraft.reason);
const opened2 = await openRaffle(drawnDraft.raffle.id, { listingFeeSignature: "seedL2", escrowSignature: "seedE2" });
if (!opened2.ok) throw new Error(opened2.reason);
const o2 = await createTicketOrder({ raffleId: opened2.raffle.id, quantity: 5, payerPubkey: B, ipHash: null });
if (!o2.ok) throw new Error(o2.reason);
await settleTicketOrder({ orderId: o2.order.id, signature: "seedPay2", paymentWallet: WALLET,
  verify: async () => ({ ok: true, payer: B, lamports: 500_000_000n, blockTimeMs: Date.now() }) });
await advanceRaffle(opened2.raffle.id);

const blockhash = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3teA9";
const tickets = await ticketsFor(opened2.raffle.id);
const { winningTicket } = deriveWinner({
  seedHash: done.seedHash, seed: done.seed, drawBlockhash: blockhash,
  raffleId: opened2.raffle.id, ticketCount: tickets.length,
});
const winner = tickets.find((t) => t.number === winningTicket)!;
const drew = await recordDraw(opened2.raffle.id, {
  seed: done.seed, drawBlockhash: blockhash, winnerWallet: winner.wallet, winningTicket,
});
if (!drew.ok) throw new Error(drew.reason);

console.log("seeded: demo-open, demo-drawn (winner ticket " + winningTicket + ")");
await closePool();
