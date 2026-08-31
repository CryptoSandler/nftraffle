import { isChainId } from "../../../../lib/chain/adapter";
import { json, NO_STORE } from "../../../../lib/http";
import { proxyRpc } from "../../../../lib/rpc-proxy";

export const dynamic = "force-dynamic";

/**
 * The RPC proxy, one route per chain in the URL and one implementation behind
 * it.
 *
 * **All this file does is validate the chain and hand over.** Every rule that
 * matters — the method whitelist, the batch check, the body cap, the rate
 * limit, and the discipline that no upstream byte is ever relayed — lives in
 * `lib/rpc-proxy.ts`, so there is one copy of each rather than one per chain.
 *
 * `isChainId` is what stops this being a caller-selected upstream: the segment
 * must be one of the two compile-time chain ids, and each maps to a fixed
 * environment variable. An unrecognised segment is refused here, before any
 * configuration is read.
 *
 * WHO CALLS THIS: the browser, same-origin — `components/BuyTickets.tsx` and
 * `components/useSolanaWallet.ts` today.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/rpc/[chain]">,
): Promise<Response> {
  const { chain } = await context.params;
  if (!isChainId(chain)) {
    return json({ error: "No such chain." }, { status: 404, headers: NO_STORE });
  }
  return proxyRpc(request, chain);
}
