import { buildMintTransaction } from "../../../../../lib/launch/candy";
import { launchBySlug } from "../../../../../lib/launch/lifecycle";
import { identify, json, NO_STORE, refuseForeignOrigin } from "../../../../../lib/http";
import { paymentWallet } from "../../../../../lib/payments/config";
import { preflightPayment } from "../../../../../lib/chain/solana/preflight";
import { meterListingAttempt } from "../../../../../lib/rate-limit";
import { isAddressShaped } from "../../../../../lib/payments/config";
import { surfaceRefusal } from "../../../../../lib/surfaces";

export const dynamic = "force-dynamic";

/**
 * The transaction a minter signs to mint one item.
 *
 * **Built and simulated here, and returned only if it can succeed**
 * (`docs/wallet-warnings.md`). Its absence is what stops the wallet opening.
 * That matters more on this surface than on any other: a candy machine mint
 * that fails a guard still costs the minter the `botTax`, so handing somebody a
 * transaction that cannot succeed takes their money AND shows them a red
 * screen.
 *
 * **Everything the transaction pays comes from the collection row**, which was
 * only written after the deployed machine was read back and agreed with it
 * (spec §5.3). The minter names nothing but their own wallet.
 *
 * WHO CALLS THIS: the mint panel on `/c/[chain]/[slug]`.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/collections/[slug]/mint">,
): Promise<Response> {
  const foreign = refuseForeignOrigin(request);
  if (foreign) return foreign;

  const { slug } = await context.params;
  const launch = await launchBySlug(slug);
  if (!launch) return json({ error: "No such collection." }, { status: 404, headers: NO_STORE });

  // `buy_tickets` rather than `launch_collection`: this is somebody paying, and
  // what it needs is an RPC and a payment wallet, not a launch fee.
  const closed = surfaceRefusal("buy_tickets", "solana", `POST /api/collections/${slug}/mint`);
  if (closed) return json({ error: closed.message }, { status: 503, headers: NO_STORE });

  if (launch.status !== "live" || !launch.candyMachine || !launch.collectionMint) {
    return json(
      { error: "This collection is not open for minting." },
      { status: 409, headers: NO_STORE },
    );
  }
  if (launch.startsAt && launch.startsAt.getTime() > Date.now()) {
    return json(
      { error: "This mint has not started yet. Nothing has been charged." },
      { status: 409, headers: NO_STORE },
    );
  }

  const payment = paymentWallet("solana");
  if (!payment.ok) {
    console.error(`mint ${slug}: configuration incomplete.`);
    return json({ error: "Minting is not available right now." }, { status: 503, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON." }, { status: 400, headers: NO_STORE });
  }
  const { minter } = (body ?? {}) as Record<string, unknown>;
  if (typeof minter !== "string" || !isAddressShaped(minter)) {
    return json({ error: "minter must be a Solana address." }, { status: 400, headers: NO_STORE });
  }

  const caller = identify(request);
  if (!caller.ok) return json({ error: caller.message }, { status: 400, headers: NO_STORE });
  const limit = await meterListingAttempt(caller.ipHash);
  if (limit.limited) {
    return json(
      { error: limit.message },
      { status: 429, headers: { ...NO_STORE, "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  let built;
  try {
    built = await buildMintTransaction({
      minter,
      candyMachine: launch.candyMachine,
      collection: launch.collectionMint,
      creator: launch.creatorWallet,
      paymentWallet: payment.address,
    });
  } catch (error) {
    console.error(`mint ${slug}: could not build (${error instanceof Error ? error.name : "unknown"})`);
    return json(
      { error: "This mint could not be prepared just now. Nothing has been charged." },
      { status: 503, headers: NO_STORE },
    );
  }

  const wire = Buffer.from(built.transaction, "base64");
  const numSignatures = wire[0]!;
  const verdict = await preflightPayment({
    payer: minter,
    // What leaves the minter's wallet beyond the network fee: the creator's
    // price and the platform's fee, both charged by the program's own guards.
    amountLamports: launch.priceNative + launch.mintFeeNative,
    base64Transaction: built.transaction,
    base64Message: Buffer.from(wire.subarray(1 + 64 * numSignatures)).toString("base64"),
  });
  if (!verdict.ok) {
    return json({ error: verdict.message, reason: verdict.reason }, { status: 409, headers: NO_STORE });
  }

  return json(
    { transaction: built.transaction, asset: built.asset },
    { status: 200, headers: NO_STORE },
  );
}
