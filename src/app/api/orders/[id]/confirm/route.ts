import { identify, json, NO_STORE, refuseForeignOrigin } from "../../../../../lib/http";
import { fetchTransaction } from "../../../../../lib/chain/rpc";
import { paymentWallet } from "../../../../../lib/payments/config";
import { isSignatureShaped } from "../../../../../lib/payments/signature";
import { verifySolTransfer } from "../../../../../lib/payments/sol-transfer";
import { orderById, settleTicketOrder } from "../../../../../lib/raffles/tickets";
import { checkVerificationLimits, recordVerificationAttempt } from "../../../../../lib/rate-limit";
import { surfaceRefusal } from "../../../../../lib/surfaces";

export const dynamic = "force-dynamic";

/**
 * Confirms a ticket order against a transaction signature.
 *
 * The signature-shape check runs BEFORE an attempt is recorded, deliberately:
 * a typo that is obviously not base58 should not spend one of the ten
 * verifications an order gets in ten minutes. Everything after that point does
 * count, because everything after that point can cost an RPC call.
 *
 * WHO CALLS THIS: the buy panel on `/r/[slug]`, after the wallet returns a
 * signature.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/orders/[id]/confirm">,
): Promise<Response> {
  const foreign = refuseForeignOrigin(request);
  if (foreign) return foreign;

  const { id } = await context.params;

  const closed = surfaceRefusal("buy_tickets", `POST /api/orders/${id}/confirm`);
  if (closed) return json({ error: closed.message }, { status: 503, headers: NO_STORE });

  const wallet = paymentWallet();
  if (!wallet.ok) {
    console.error(`POST /api/orders/${id}/confirm: ${wallet.reason}`);
    return json({ error: "Payments are not available right now." }, { status: 503, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON." }, { status: 400, headers: NO_STORE });
  }

  const { signature } = (body ?? {}) as Record<string, unknown>;
  if (typeof signature !== "string" || !isSignatureShaped(signature)) {
    return json(
      { error: "That does not look like a Solana transaction signature." },
      { status: 400, headers: NO_STORE },
    );
  }

  const caller = identify(request);
  if (!caller.ok) return json({ error: caller.message }, { status: 400, headers: NO_STORE });

  const order = await orderById(id);
  if (!order) return json({ error: "No such order." }, { status: 404, headers: NO_STORE });

  const limit = await checkVerificationLimits(order.id, caller.ipHash);
  if (limit.limited) {
    return json(
      { error: limit.message },
      { status: 429, headers: { ...NO_STORE, "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  // Recorded before the verification it meters, never after: the expensive
  // path is the outbound RPC request, and that is spent whether or not the
  // payment turns out to exist.
  await recordVerificationAttempt(order.id, caller.ipHash);

  const result = await settleTicketOrder({
    orderId: order.id,
    signature: signature.trim(),
    paymentWallet: wallet.address,
    verify: (input) =>
      verifySolTransfer({
        signature: input.signature,
        recipient: input.recipient,
        minLamports: input.minLamports,
        expectedPayer: input.expectedPayer,
        window: input.window,
        fetchTransaction,
      }),
  });

  if (!result.ok) {
    return json(
      { error: result.message, reason: result.reason },
      { status: 409, headers: NO_STORE },
    );
  }

  return json({ ticketNumbers: result.ticketNumbers }, { status: 200, headers: NO_STORE });
}
