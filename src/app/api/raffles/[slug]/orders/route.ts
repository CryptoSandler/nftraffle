import { identify, json, NO_STORE, refuseForeignOrigin } from "../../../../../lib/http";
import { adapterFor } from "../../../../../lib/chain/registry";
import { paymentWallet } from "../../../../../lib/payments/config";
import { advanceRaffle, raffleBySlug } from "../../../../../lib/raffles/lifecycle";
import { createTicketOrder } from "../../../../../lib/raffles/tickets";
import { tooManyOrders } from "../../../../../lib/rate-limit";
import { surfaceRefusal } from "../../../../../lib/surfaces";

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

  const { quantity, payerPubkey } = (body ?? {}) as Record<string, unknown>;
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
    return json({ error: "quantity must be a whole number of at least 1." }, { status: 400, headers: NO_STORE });
  }
  if (typeof payerPubkey !== "string" || !chain.isAddress(payerPubkey)) {
    return json({ error: "payerPubkey must be an address on this raffle's chain." }, { status: 400, headers: NO_STORE });
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

  return json(
    {
      orderId: result.order.id,
      payTo: wallet.address,
      amountNative: result.order.amountNative.toString(),
      amountDisplay: chain.formatNative(result.order.amountNative),
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
