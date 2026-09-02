import { adapterFor } from "../../../../../lib/chain/registry";
import { readDeployedLaunch } from "../../../../../lib/launch/candy";
import { launchBySlug, publishLaunch } from "../../../../../lib/launch/lifecycle";
import { checkDeployedLaunch } from "../../../../../lib/launch/verify";
import { json, NO_STORE, refuseForeignOrigin } from "../../../../../lib/http";
import { launchFee, paymentWallet } from "../../../../../lib/payments/config";
import { verifyListingFee } from "../../../../../lib/raffles/escrow";
import { surfaceRefusal } from "../../../../../lib/surfaces";

export const dynamic = "force-dynamic";

/**
 * Publishes a launch, once the chain agrees the fee was paid AND the deployed
 * candy machine is the one this collection may be published as.
 *
 * **Two verdicts, both read off the chain, and the second is the one that is
 * easy to skip.** The fee is ours and we know to check it. The guard read-back
 * is about a machine the CREATOR assembled: the transaction this server built
 * is a suggestion until the account is read back (spec §5.3 step 4, §0.1). A
 * launch whose `solFixedFee` was dropped, redirected or shrunk does not go
 * live.
 *
 * **It retries the read.** An account created seconds ago is not always visible
 * to the next RPC call, and "not there yet" and "not there" have to be told
 * apart — the first is a wait, the second is a refusal.
 *
 * WHO CALLS THIS: the launch form on `/launch`, after the creator's wallet
 * confirms the transaction.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/collections/[slug]/publish">,
): Promise<Response> {
  const foreign = refuseForeignOrigin(request);
  if (foreign) return foreign;

  const { slug } = await context.params;
  const launch = await launchBySlug(slug);
  if (!launch) return json({ error: "No such collection." }, { status: 404, headers: NO_STORE });

  const closed = surfaceRefusal("launch_collection", "solana", `POST /api/collections/${slug}/publish`);
  if (closed) return json({ error: closed.message }, { status: 503, headers: NO_STORE });

  if (launch.status !== "draft") {
    return json(
      { error: `This collection is ${launch.status}, so it cannot be published.` },
      { status: 409, headers: NO_STORE },
    );
  }
  if (!launch.candyMachine || !launch.collectionMint) {
    console.error(`publish ${slug}: draft has no addresses.`);
    return json({ error: "This collection cannot be published." }, { status: 409, headers: NO_STORE });
  }

  const payment = paymentWallet("solana");
  const fee = launchFee("solana");
  if (!payment.ok || !fee.ok) {
    console.error(`publish ${slug}: configuration incomplete.`);
    return json({ error: "Launching is not available right now." }, { status: 503, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON." }, { status: 400, headers: NO_STORE });
  }
  const chain = adapterFor("solana");
  const { launchFeeSignature } = (body ?? {}) as Record<string, unknown>;
  if (fee.amount > 0n && (typeof launchFeeSignature !== "string" || !chain.isTxId(launchFeeSignature))) {
    return json(
      { error: "launchFeeSignature must be a transaction id on Solana." },
      { status: 400, headers: NO_STORE },
    );
  }

  // The fee first: it is the cheaper verdict, and the one a creator is most
  // likely to have got wrong by paying from a different wallet.
  const feeVerdict = await verifyListingFee({
    signature: typeof launchFeeSignature === "string" ? launchFeeSignature : "",
    sellerWallet: launch.creatorWallet,
    paymentWallet: payment.address,
    feeAmount: fee.amount,
    verify: (input) =>
      chain.verifyNativeTransfer({
        txId: input.signature,
        recipient: input.recipient,
        minAmount: input.minAmount,
        expectedPayer: input.expectedPayer,
      }),
  });
  if (!feeVerdict.ok) {
    return json({ error: feeVerdict.message, reason: feeVerdict.reason }, { status: 409, headers: NO_STORE });
  }

  const deployed = await readWithRetry(launch.candyMachine);
  if (!deployed) {
    return json(
      {
        error:
          "That candy machine could not be read on chain. If the transaction has just gone " +
          "through, try again in a moment.",
        reason: "not_readable",
      },
      { status: 409, headers: NO_STORE },
    );
  }

  const verdict = checkDeployedLaunch({
    deployed,
    expected: {
      collection: launch.collectionMint,
      creator: launch.creatorWallet,
      paymentWallet: payment.address,
      itemsAvailable: launch.itemsAvailable,
      mintFeeNative: launch.mintFeeNative,
      priceNative: launch.priceNative,
    },
  });
  if (!verdict.ok) {
    console.error(`publish ${slug}: deployed machine refused (${verdict.reason}).`);
    return json({ error: verdict.message, reason: verdict.reason }, { status: 409, headers: NO_STORE });
  }

  const published = await publishLaunch(launch.id, {
    launchFeeSignature: typeof launchFeeSignature === "string" ? launchFeeSignature : `nofee-${launch.id}`,
  });
  if (!published.ok) {
    return json({ error: `Could not publish: ${published.reason}.`, reason: published.reason }, { status: 409, headers: NO_STORE });
  }

  return json({ slug: published.launch.slug, status: published.launch.status }, { status: 200, headers: NO_STORE });
}

/**
 * Reads the deployed machine, allowing for propagation.
 *
 * Four attempts over about six seconds. A creator whose wallet has just
 * confirmed is standing at the screen, and the difference between "wait a
 * moment" and "your launch failed" is entirely this loop.
 */
async function readWithRetry(address: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const deployed = await readDeployedLaunch(address);
    if (deployed) return deployed;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return null;
}
