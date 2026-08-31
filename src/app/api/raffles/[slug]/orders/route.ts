import { identify, json, NO_STORE, refuseForeignOrigin } from "../../../../../lib/http";
import { adapterFor } from "../../../../../lib/chain/registry";
import { paymentWallet } from "../../../../../lib/payments/config";
import { advanceRaffle, raffleBySlug } from "../../../../../lib/raffles/lifecycle";
import { createTicketOrder } from "../../../../../lib/raffles/tickets";
import { tooManyOrders } from "../../../../../lib/rate-limit";
import { surfaceRefusal } from "../../../../../lib/surfaces";
import { chainIdFor, robinhoodNetwork } from "../../../../../lib/chain/robinhood/network";
import { verifyPayerBinding, type BindingFields } from "../../../../../lib/wallet/evm-binding";
import { buildSolanaPayment } from "../../../../../lib/chain/solana/payment-intent";

export const dynamic = "force-dynamic";

/**
 * Opens a ticket order and quotes what to pay.
 *
 * The order of the checks below is deliberate and each one is cheaper than the
 * next: origin, then configuration, then body shape, then caller identity, then
 * a database round trip for the rate limit, then the raffle itself. Nothing
 * spends a query on a request that a free check would have refused.
 *
 * WHO CALLS THIS: the buy panel on `/r/[slug]`.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/raffles/[slug]/orders">,
): Promise<Response> {
  const foreign = refuseForeignOrigin(request);
  if (foreign) return foreign;

  const { slug } = await context.params;

  // Checked before anything costs a round trip: a deployment with no receiving
  // wallet cannot quote a payTo address, so there is nothing an order created
  // now could tell a payer. The specific reason goes to the server log only.
  const raffle = await raffleBySlug(slug);
  if (!raffle) return json({ error: "No such raffle." }, { status: 404, headers: NO_STORE });

  // The chain comes from the RAFFLE, never from the request: a caller who could
  // name the chain could have an EVM receipt verified against a SOL price.
  const chain = adapterFor(raffle.chain);
  const closed = surfaceRefusal("buy_tickets", raffle.chain, `POST /api/raffles/${slug}/orders`);
  if (closed) return json({ error: closed.message }, { status: 503, headers: NO_STORE });

  const wallet = paymentWallet(raffle.chain);
  if (!wallet.ok) {
    // Unreachable while `surfaceRefusal` above passes, and kept because the
    // alternative is a non-null assertion on a value that decides where money
    // goes.
    console.error(`POST /api/raffles/${slug}/orders: ${wallet.reason}`);
    return json({ error: "Ticket sales are not available right now." }, { status: 503, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON." }, { status: 400, headers: NO_STORE });
  }

  const { quantity, payerPubkey, binding } = (body ?? {}) as Record<string, unknown>;
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
    return json({ error: "quantity must be a whole number of at least 1." }, { status: 400, headers: NO_STORE });
  }
  if (typeof payerPubkey !== "string" || !chain.isAddress(payerPubkey)) {
    return json({ error: "payerPubkey must be an address on this raffle's chain." }, { status: 400, headers: NO_STORE });
  }

  /**
   * ON EVM, THE PAYER MUST PROVE THE ADDRESS IS THEIRS.
   *
   * Settlement already refuses a transfer whose `from` is not this order's
   * payer, which stops an attacker claiming a stranger's transfer. This closes
   * the mirror image: opening an order in a STRANGER'S name and waiting for a
   * transfer they made for their own reasons to land inside its window. The
   * window makes that narrow; on a chain with blocks a tenth of a second apart,
   * narrow is not a word to use about somebody else's money.
   *
   * Not required on Solana, and that is a gap rather than a principle — see
   * docs/decisions.md Q18. It is built here first because this is the chain
   * opening first.
   */
  if (raffle.chain === "robinhood") {
    const network = await robinhoodNetwork();
    const expectedChainId = chainIdFor(network);
    if (expectedChainId === null) {
      // The same rule as refusing to show a cluster we cannot classify: a
      // binding checked against a chain id we had to guess proves nothing.
      console.error(`POST /api/raffles/${slug}/orders: Robinhood network is unknown; refusing.`);
      return json(
        { error: "This deployment could not confirm which network it is on. Nothing has been charged." },
        { status: 503, headers: NO_STORE },
      );
    }

    if (typeof binding !== "object" || binding === null) {
      return json(
        { error: "This chain needs a signature proving you control that wallet." },
        { status: 400, headers: NO_STORE },
      );
    }
    const { signature, ...fields } = binding as Record<string, unknown>;
    if (typeof signature !== "string") {
      return json({ error: "binding.signature is required." }, { status: 400, headers: NO_STORE });
    }

    const verdict = verifyPayerBinding({
      signature,
      fields: fields as unknown as BindingFields,
      // From the REQUEST's own host, not from the body: a caller who could name
      // the domain could satisfy the domain check with a domain they own.
      expectedDomain: new URL(request.url).host,
      expectedSlug: slug,
      expectedChainId,
      nowMs: Date.now(),
    });
    if (!verdict.ok) {
      return json(
        {
          error: "That signature does not prove you control this wallet on this raffle.",
          reason: verdict.reason,
        },
        { status: 400, headers: NO_STORE },
      );
    }
    if (!chain.sameAddress(verdict.address, payerPubkey)) {
      return json(
        { error: "The signature is for a different wallet than the one paying." },
        { status: 400, headers: NO_STORE },
      );
    }
  }

  const caller = identify(request);
  if (!caller.ok) return json({ error: caller.message }, { status: 400, headers: NO_STORE });

  const limit = await tooManyOrders(caller.ipHash);
  if (limit.limited) {
    return json(
      { error: limit.message },
      { status: 429, headers: { ...NO_STORE, "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  // Advance before selling: a raffle whose clock ran out must not take money,
  // and this project has no cron, so reads are what move it (lifecycle.ts).
  await advanceRaffle(raffle.id);

  const result = await createTicketOrder({
    raffleId: raffle.id,
    quantity,
    payerPubkey: payerPubkey.trim(),
    ipHash: caller.ipHash,
    chain: raffle.chain,
    reference: await chain.paymentReference(),
  });

  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 409;
    return json({ error: FAILURES[result.reason], reason: result.reason }, { status, headers: NO_STORE });
  }

  /**
   * THE TRANSACTION IS BUILT AND CHECKED HERE, NOT IN THE BROWSER.
   *
   * It used to be assembled client-side from the quote below. Moving it server
   * side is what makes a preflight possible at all: we run the same simulation
   * Phantom is about to run, against our own node, and if it fails we never open
   * the wallet (`docs/wallet-warnings.md`).
   *
   * The reason is wallet behaviour rather than correctness. A transaction that
   * cannot succeed makes Phantom show a red "this transaction may be malicious"
   * interstitial — which reads to a person as a warning about US, and is in fact
   * a failed simulation. A site that routinely hands wallets transactions that
   * fail simulation is training its own users to click through the warning that
   * exists to protect them.
   *
   * A refusal here is a `409` carrying ONE sentence about what is wrong, and no
   * `transaction` field, so the panel has nothing to sign even if it tried.
   */
  let payment: Awaited<ReturnType<typeof buildSolanaPayment>> | null = null;
  if (raffle.chain === "solana") {
    payment = await buildSolanaPayment({
      payer: payerPubkey.trim(),
      payTo: wallet.address,
      amountLamports: result.order.amountNative,
      reference: result.order.referencePubkey,
    });
    if (!payment.ok) {
      return json(
        { error: payment.message, reason: payment.reason },
        { status: payment.reason === "rpc_unavailable" ? 503 : 409, headers: NO_STORE },
      );
    }
  }

  return json(
    {
      orderId: result.order.id,
      payTo: wallet.address,
      amountNative: result.order.amountNative.toString(),
      amountDisplay: chain.formatNative(result.order.amountNative),
      /**
       * Present only when the preflight passed. Its absence is what stops a
       * wallet being opened, rather than a flag the panel could ignore.
       */
      ...(payment?.ok ? { transaction: payment.base64Transaction, feeLamports: payment.feeLamports.toString() } : {}),
      nativeSymbol: chain.nativeSymbol,
      reference: result.order.referencePubkey,
      expiresAt: result.order.expiresAt.toISOString(),
    },
    { status: 201, headers: NO_STORE },
  );
}

const FAILURES: Record<string, string> = {
  not_found: "No such raffle.",
  not_open: "This raffle is not selling tickets.",
  not_enough_tickets: "There are not that many tickets left.",
  bad_quantity: "That quantity is not valid.",
};
