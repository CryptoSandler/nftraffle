import { isAllowedImageHost } from "../image-hosts";

/**
 * What a creator may ask for, and the sentence they get when they ask for
 * something else.
 *
 * **Pure, and the server's answer rather than the browser's** (spec §5.3). The
 * form checks the same things so nobody fills in a page and then loses it, but
 * the browser is the half an attacker writes, so this is the one that decides.
 *
 * WHO CALLS THIS: `POST /api/collections`, before it builds any transaction.
 */

export const LAUNCH_LIMITS = {
  /**
   * Spec §5.3's cap, and it is about the mint page rather than the chain: a
   * launch is one candy machine account whatever its supply, but a collection
   * page that has to render ten thousand items is a page that does not load.
   */
  maxItems: 1_000,
  /**
   * `mintLimit`'s `limit` is a u8 in the guard. 256 is not a large limit, it is
   * a number that does not fit — and the value the program would store is not
   * the one the creator typed.
   */
  maxMintLimit: 255,
  /** A start date further out than this is almost always a typo in the year. */
  maxStartDays: 90,
  maxNameLength: 32,
  maxSymbolLength: 10,
} as const;

export type LaunchRefusal =
  | "too_many_items"
  | "too_few_items"
  | "bad_mint_limit"
  | "starts_in_past"
  | "starts_too_late"
  | "bad_uri"
  | "bad_name"
  | "bad_symbol"
  | "bad_price";

export type LaunchChoices =
  | { ok: true; startsAt: Date }
  | { ok: false; reason: LaunchRefusal; message: string };

export function checkLaunchChoices(input: {
  name: string;
  symbol: string;
  uri: string;
  itemsAvailable: number;
  priceLamports: bigint;
  mintLimit: number;
  startsAtMs: number;
  nowMs: number;
}): LaunchChoices {
  const name = input.name.trim();
  if (!name || name.length > LAUNCH_LIMITS.maxNameLength) {
    return refuse("bad_name", `A name is required, at most ${LAUNCH_LIMITS.maxNameLength} characters.`);
  }
  const symbol = input.symbol.trim();
  if (!symbol || symbol.length > LAUNCH_LIMITS.maxSymbolLength) {
    return refuse("bad_symbol", `A symbol is required, at most ${LAUNCH_LIMITS.maxSymbolLength} characters.`);
  }

  /**
   * The metadata has to live somewhere this project will actually render.
   *
   * Not a security check — it is the difference between a mint page with art on
   * it and one with a blank square. `image-hosts.ts` is the same list the CSP
   * and `next.config.ts` are built from, so a URI that passes here is one the
   * browser will be allowed to load.
   */
  if (!isAllowedImageHost(input.uri)) {
    return refuse(
      "bad_uri",
      "That metadata address is not on a host this site can display. Upload through this page.",
    );
  }

  if (!Number.isInteger(input.itemsAvailable) || input.itemsAvailable < 1) {
    return refuse("too_few_items", "A collection needs at least one item.");
  }
  if (input.itemsAvailable > LAUNCH_LIMITS.maxItems) {
    return refuse("too_many_items", `A launch can offer at most ${LAUNCH_LIMITS.maxItems} items.`);
  }

  if (!Number.isInteger(input.mintLimit) || input.mintLimit < 1 || input.mintLimit > LAUNCH_LIMITS.maxMintLimit) {
    return refuse("bad_mint_limit", `The per-wallet limit must be between 1 and ${LAUNCH_LIMITS.maxMintLimit}.`);
  }

  // Zero is a price. A free mint is a launch strategy, and refusing it would be
  // this project deciding what a creator's collection is worth.
  if (input.priceLamports < 0n) {
    return refuse("bad_price", "A price cannot be negative.");
  }

  if (input.startsAtMs < input.nowMs) {
    return refuse("starts_in_past", "A launch cannot start in the past.");
  }
  if (input.startsAtMs > input.nowMs + LAUNCH_LIMITS.maxStartDays * 24 * 60 * 60 * 1000) {
    return refuse("starts_too_late", `A launch must start within ${LAUNCH_LIMITS.maxStartDays} days.`);
  }

  return { ok: true, startsAt: new Date(input.startsAtMs) };
}

function refuse(reason: LaunchRefusal, message: string): LaunchChoices {
  return { ok: false, reason, message };
}
