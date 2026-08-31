import { json, NO_STORE, refuseForeignOrigin } from "../../../../../lib/http";
import { isAddressShaped } from "../../../../../lib/payments/config";
import { cancelRaffleAsSeller, raffleBySlug } from "../../../../../lib/raffles/lifecycle";

export const dynamic = "force-dynamic";

/**
 * A seller withdraws their own raffle.
 *
 * The owner's answer to open question Q3: allowed, but only while nobody has
 * bought in. `cancelRaffleAsSeller` enforces both bounds under a row lock; this
 * route only carries the request to it.
 *
 * **The seller wallet is asserted by the caller and that is deliberate, not an
 * oversight.** Everywhere else in this product an identity claim is refused
 * unless the chain confirms it — but the two things this can do are both
 * harmless to the claimant's victim. Naming somebody else's wallet cancels
 * nothing, because the raffle's own `seller_wallet` must match; and a raffle
 * with zero tickets sold has nobody with a claim on it, so the worst outcome is
 * that a seller's own asset stops being raffled and stays in escrow, where an
 * operator returns it.
 *
 * That reasoning stops holding the moment the zero-ticket bound moves. If a
 * future change lets a seller cancel a raffle with tickets sold, this route
 * needs a signature proving wallet control — the challenge/verify shape the
 * sibling project uses for wallet linking — before it is allowed to.
 *
 * WHO CALLS THIS: the seller's own raffle view, which is Batch D. Nothing calls
 * it today.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/raffles/[slug]/cancel">,
): Promise<Response> {
  const foreign = refuseForeignOrigin(request);
  if (foreign) return foreign;

  const { slug } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON." }, { status: 400, headers: NO_STORE });
  }

  const { sellerWallet, reason } = (body ?? {}) as Record<string, unknown>;
  if (typeof sellerWallet !== "string" || !isAddressShaped(sellerWallet)) {
    return json({ error: "sellerWallet must be a Solana address." }, { status: 400, headers: NO_STORE });
  }
  if (typeof reason !== "string" || !reason.trim()) {
    // Mandatory for the seller's path too: a cancelled raffle's page shows the
    // reason, and "the seller withdrew it" with no further word is still more
    // than an empty box.
    return json({ error: "A reason is required." }, { status: 400, headers: NO_STORE });
  }

  const raffle = await raffleBySlug(slug);
  if (!raffle) return json({ error: "No such raffle." }, { status: 404, headers: NO_STORE });

  const result = await cancelRaffleAsSeller(raffle.id, sellerWallet.trim(), reason);
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : result.reason === "not_seller" ? 403 : 409;
    return json({ error: FAILURES[result.reason], reason: result.reason }, { status, headers: NO_STORE });
  }

  return json({ slug: result.raffle.slug, status: result.raffle.status }, { status: 200, headers: NO_STORE });
}

const FAILURES: Record<string, string> = {
  not_found: "No such raffle.",
  not_seller: "This raffle was not listed by that wallet.",
  tickets_sold:
    "Tickets have already been sold, so this raffle can no longer be withdrawn. Contact support "
    + "if it has to be stopped.",
  already_paid: "This raffle has already paid out.",
  reason_required: "A reason is required.",
};
