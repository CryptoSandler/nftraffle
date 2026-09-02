import type { DeployedLaunch } from "./candy";

/**
 * Whether the candy machine that is actually on chain is the one this
 * collection may be published as.
 *
 * **This is spec §5.3 step 4, and it is the reason §0.1 is true rather than
 * intended.** The creator assembles and signs the launch transaction, so the
 * transaction this server handed them is a suggestion. A creator who edits it —
 * dropping the `solFixedFee` guard, pointing it at their own wallet, or setting
 * it to one lamport — gets a working candy machine that charges this platform
 * nothing, and every check that only reads our own database would call it fine.
 *
 * **Pure, so every refusal is testable without a chain.** `readDeployedLaunch`
 * does the reading; this decides.
 *
 * WHO CALLS THIS: `POST /api/collections/[slug]/publish`.
 */

export type LaunchDefect =
  | "no_fee_guard"
  | "fee_wrong_destination"
  | "fee_too_small"
  | "no_price_guard"
  | "price_wrong_destination"
  | "wrong_price"
  | "wrong_collection"
  | "wrong_supply"
  | "already_minted";

export type LaunchCheck = { ok: true } | { ok: false; reason: LaunchDefect; message: string };

export function checkDeployedLaunch(input: {
  deployed: DeployedLaunch;
  expected: {
    collection: string;
    creator: string;
    paymentWallet: string;
    itemsAvailable: number;
    /** What this collection's page will quote, frozen at draft time. */
    mintFeeNative: bigint;
    priceNative: bigint;
  };
}): LaunchCheck {
  const { deployed, expected } = input;

  if (deployed.collection !== expected.collection) {
    return no("wrong_collection", "That candy machine is not attached to this collection.");
  }
  if (deployed.itemsAvailable !== BigInt(expected.itemsAvailable)) {
    return no("wrong_supply", "That candy machine offers a different supply from this launch.");
  }
  /**
   * A machine with mints already on it was open somewhere before it was
   * published here. Publishing it would present a partly-sold supply as
   * untouched, which is a number on a public page that is not true.
   */
  if (deployed.itemsRedeemed > 0n) {
    return no("already_minted", "That candy machine has already been minted from.");
  }

  // THE FEE. Everything else on this list is honesty about a page; this one is
  // whether the platform is paid at all.
  if (!deployed.fee) {
    return no("no_fee_guard", "That candy machine does not charge this platform's fee.");
  }
  if (deployed.fee.destination !== expected.paymentWallet) {
    return no("fee_wrong_destination", "That candy machine's fee is paid to another wallet.");
  }
  // At least, not exactly: a creator who sets it higher is paying us more than
  // we asked, which is not a defect. Below the quote is.
  if (deployed.fee.lamports < expected.mintFeeNative) {
    return no("fee_too_small", "That candy machine's fee is lower than this launch was quoted at.");
  }

  if (!deployed.price) {
    return no("no_price_guard", "That candy machine does not charge the price this launch names.");
  }
  if (deployed.price.destination !== expected.creator) {
    return no("price_wrong_destination", "That candy machine pays the mint price to another wallet.");
  }
  if (deployed.price.lamports !== expected.priceNative) {
    return no("wrong_price", "That candy machine charges a different price from this launch.");
  }

  return { ok: true };
}

function no(reason: LaunchDefect, message: string): LaunchCheck {
  return { ok: false, reason, message };
}
