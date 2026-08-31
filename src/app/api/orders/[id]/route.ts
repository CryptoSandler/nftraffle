import { json, NO_STORE } from "../../../../lib/http";
import { orderById } from "../../../../lib/raffles/tickets";

export const dynamic = "force-dynamic";

/**
 * One order's status.
 *
 * **Exists for exactly one question, and it is the most important one the buy
 * panel asks:** a `/confirm` that failed with `signature_reused` means either
 * "this order already settled and your retry raced a dropped response" — good
 * news — or "that signature paid for something else" — bad news. The two are
 * indistinguishable from the failure alone, and `checkout.ts` needs the order's
 * own status to tell them apart. Getting it wrong means telling somebody their
 * payment failed when it succeeded.
 *
 * **Returns only the status and the counts.** No `ip_hash`, no
 * `reference_pubkey`, no payer. An order id is a bearer token of sorts — anyone
 * who has the URL has it — so this answers the one question the panel needs and
 * nothing that would make holding an id worth more than it already is.
 *
 * WHO CALLS THIS: `src/components/BuyTickets.tsx`, after a failed confirm.
 */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/orders/[id]">,
): Promise<Response> {
  const { id } = await context.params;
  const order = await orderById(id);
  if (!order) return json({ error: "No such order." }, { status: 404, headers: NO_STORE });

  return json(
    {
      status: order.status,
      quantity: order.quantity,
      expiresAt: order.expiresAt.toISOString(),
    },
    { status: 200, headers: NO_STORE },
  );
}
