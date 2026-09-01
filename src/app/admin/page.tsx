import { adminSessionLabel } from "../../lib/admin";
import { adapterFor } from "../../lib/chain/registry";
import { assetDisplays } from "../../lib/chain/asset-display";
import { drawQueue, payoutQueue } from "../../lib/raffles/listing";
import { payoutSplit } from "../../lib/raffles/payout";

export const dynamic = "force-dynamic";

/**
 * The operator's work queue.
 *
 * **This is the one surface in the product where an action has a consequence
 * outside the database** — somebody else's NFT leaves escrow, and somebody
 * else's SOL leaves a wallet. Both of those happen in a wallet this codebase
 * cannot reach; what happens here is that the operator is TOLD what to send, and
 * then proves they sent it.
 *
 * Two queues, in the order the work actually happens:
 *
 *  1. Draws due — closed raffles with no winner yet. Revealing the seed is what
 *     turns a closed raffle into a drawn one.
 *  2. Payouts due — drawn raffles not yet paid. Ordered OLDEST FIRST, which is
 *     the opposite of every other ordering in this product and is deliberate:
 *     this is a list of people waiting, and the one who has waited longest goes
 *     first.
 *
 * Marking a payout `paid` requires both signatures and the server verifies them
 * on chain before accepting (spec §0.5). That is not ceremony: the public
 * raffle page shows this mark to the person who did NOT send the transfers.
 */
export default async function AdminPage() {
  const label = await adminSessionLabel();

  // The sign-in form is deliberately plain HTML posting to the session route: a
  // login that needs client-side JavaScript to work is a login that does not
  // work when the JavaScript fails.
  if (!label) {
    return (
      <main className="mx-auto w-full max-w-sm px-6 py-24">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <form action="/api/admin/session" method="post" className="mt-6 space-y-3">
          <label className="block text-sm" htmlFor="token">
            Admin token
          </label>
          <input
            id="token"
            name="token"
            type="password"
            autoComplete="current-password"
            className="w-full rounded border border-rule px-3 py-2"
          />
          <button className="rounded bg-ink px-4 py-2 text-ground" type="submit">
            Sign in
          </button>
        </form>
      </main>
    );
  }

  const [draws, payouts] = await Promise.all([drawQueue(), payoutQueue()]);
  // Both queues at once: an operator reads them together, and resolving twice
  // would double the calls for the raffles that appear in both.
  const displays = await assetDisplays([...draws, ...payouts]);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Admin</h1>
        <form action="/api/admin/session?_method=DELETE" method="post">
          <button className="text-sm underline underline-offset-4" type="submit">
            Sign out ({label})
          </button>
        </form>
      </header>

      <section className="mt-12">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-quiet">
          Draws due
        </h2>
        {draws.length === 0 ? (
          <p className="mt-3 text-quiet">Nothing to draw.</p>
        ) : (
          <ul className="mt-3 divide-y divide-rule border-y border-rule">
            {draws.map((raffle) => (
              <li key={raffle.id} className="py-4">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-medium">
                    {displays.get(`${raffle.chain}:${raffle.prizeAsset}`)?.name ?? raffle.slug}
                  </span>
                  <span className="figure text-sm text-quiet">
                    {raffle.ticketsSold} tickets
                  </span>
                </div>
                <div className="figure text-xs text-quiet">{raffle.slug}</div>
                <form
                  action={`/api/admin/raffles/${raffle.id}/draw`}
                  method="post"
                  className="mt-2"
                >
                  <button className="rounded border border-rule px-3 py-1 text-sm" type="submit">
                    {/* Disabled by the server, not here: a raffle that sold
                        nothing has no winner, and `recordDraw` refuses it. */}
                    Reveal and draw
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-quiet">
          Payouts due
        </h2>
        {payouts.length === 0 ? (
          <p className="mt-3 text-quiet">Nothing to pay.</p>
        ) : (
          <ul className="mt-3 divide-y divide-rule border-y border-rule">
            {payouts.map((raffle) => {
              // The raffle's OWN fee, not the current setting: it was frozen
              // when the seller listed, and this figure is what an operator is
              // about to send.
              const split = payoutSplit({
                ticketPriceNative: raffle.ticketPriceNative,
                ticketsSold: raffle.ticketsSold,
                houseFeeBps: raffle.houseFeeBps,
              });
              // Every figure below is rendered by the raffle's OWN chain: nine
              // decimals on Solana, eighteen on EVM. One shared formatter would
              // be off by a billion on half the queue, in the direction where
              // the number still looks plausible.
              const chain = adapterFor(raffle.chain);
              return (
                <li key={raffle.id} className="py-5">
                  {/**
                   * NAMED HERE FOR A REASON THAT IS NOT COSMETIC. This queue is
                   * where an operator transfers somebody else's NFT by hand,
                   * and a screen that identifies the prize only by a base58
                   * string is a screen where sending the wrong one is an easy
                   * mistake. The address stays below, because that is what gets
                   * pasted into the transfer.
                   */}
                  <div className="font-medium">
                    {displays.get(`${raffle.chain}:${raffle.prizeAsset}`)?.name ?? raffle.slug}
                  </div>
                  <div className="figure text-xs text-quiet">{raffle.slug}</div>
                  <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
                    <dt className="text-quiet">Send this asset</dt>
                    <dd className="figure break-all">{raffle.prizeAsset}</dd>
                    <dt className="text-quiet">To the winner</dt>
                    <dd className="figure break-all">{raffle.winnerWallet}</dd>
                    <dt className="text-quiet">Gross</dt>
                    <dd className="figure">{chain.formatNative(split.grossNative)} {chain.nativeSymbol}</dd>
                    <dt className="text-quiet">Platform fee</dt>
                    <dd className="figure">
                      {chain.formatNative(split.houseFeeNative)} {chain.nativeSymbol} ({raffle.houseFeeBps} bps)
                    </dd>
                    <dt className="text-quiet">Send the seller</dt>
                    <dd className="figure">
                      {chain.formatNative(split.sellerNetNative)} {chain.nativeSymbol}
                    </dd>
                    <dt className="text-quiet">Seller wallet</dt>
                    <dd className="figure break-all">{raffle.sellerWallet}</dd>
                  </dl>
                  <form
                    action={`/api/admin/raffles/${raffle.id}/paid`}
                    method="post"
                    className="mt-3 space-y-2"
                  >
                    <input
                      name="prizeSignature"
                      placeholder="Prize transfer signature"
                      className="figure w-full rounded border border-rule px-3 py-2 text-sm"
                    />
                    <input
                      name="proceedsSignature"
                      placeholder="Proceeds transfer signature"
                      className="figure w-full rounded border border-rule px-3 py-2 text-sm"
                    />
                    <button
                      className="rounded border border-rule px-3 py-1 text-sm"
                      type="submit"
                    >
                      {/* Both are checked on chain before this is accepted.
                          An operator's word is not evidence. */}
                      Mark paid
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
