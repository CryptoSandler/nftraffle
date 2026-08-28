import type { EscrowTransfer } from "../raffles/escrow";
import { RPC_COMMITMENT } from "../payments/config";
import { primaryEndpoint, rpcCall } from "./rpc";

/**
 * Reading an NFT movement out of a transaction.
 *
 * **The two callers are the two places somebody else's property changes hands**
 * — publishing a raffle (did the prize really reach escrow) and marking a
 * payout paid (did the prize really reach the winner) — so a wrong answer here
 * either sells tickets for an asset nobody deposited or puts a false settlement
 * on a public page.
 *
 * WHY THIS IS NOT `sol-transfer.ts` WITH A FLAG. That module reads
 * `preBalances`/`postBalances`, which are positional lamport deltas. An NFT
 * transfer moves no lamports worth reading and produces no balance delta that
 * names it. The two verifications share a discipline and share no arithmetic;
 * folding them together would be one body with two disjoint halves and a flag
 * choosing between them, which is two functions wearing one name.
 *
 * WHY THE INSTRUCTION AND NOT A BALANCE, given that this project's other
 * verifier makes the opposite choice on purpose: for SPL transfers the balance
 * delta is the right signal precisely because instruction shape varies. Metaplex
 * Core assets are not token accounts and have no balance — ownership lives in
 * the asset account's own data — so the instruction IS the record of the
 * movement, and there is no delta to read instead.
 *
 * WHAT THIS DOES NOT DO, stated because the gap matters: it does not decode the
 * instruction data, so it does not distinguish `TransferV1` from another Core
 * instruction touching the same accounts. That is why every caller ALSO checks
 * current ownership through DAS (`raffles/escrow.ts`) — the two questions
 * together are what close the gap, and neither closes it alone.
 * // ponytail: account-shape match plus a DAS ownership check. Decode the
 * // discriminator if a Core instruction ever appears that has this shape and
 * // is not a transfer.
 *
 * WHO CALLS THIS: `POST /api/raffles/[slug]/publish` and
 * `POST /api/admin/raffles/[id]/paid`.
 */

/** Metaplex Core. Hardcoded for the reason a token mint would be: it is the standard, not a setting. */
export const CORE_PROGRAM_ID = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";

/**
 * `TransferV1`'s account order: asset, collection, payer, authority, newOwner.
 *
 * The authority is the current owner in the ordinary case, and `newOwner` is
 * the recipient. Read by position because that is what the instruction layout
 * fixes; a named lookup would need the IDL, which is a dependency for one field.
 */
const ASSET_INDEX = 0;
const AUTHORITY_INDEX = 3;
const NEW_OWNER_INDEX = 4;

type Instruction = { programId?: string; accounts?: string[] };

type ParsedTransaction = {
  blockTime?: number | null;
  meta?: {
    err?: unknown;
    innerInstructions?: { instructions?: Instruction[] }[];
  } | null;
  transaction?: { message?: { instructions?: Instruction[] } };
} | null;

/**
 * The asset movement in `transaction` that concerns `mint`, if there is one.
 *
 * Split from the fetch so it can be tested against fixtures without a network,
 * the same way `readSolTransfer` is.
 */
export function readAssetTransferFrom(
  transaction: ParsedTransaction,
  mint: string,
): EscrowTransfer {
  if (!transaction) return { ok: false, reason: "not_found" };

  // A failed transaction can still be fetched and still name accounts. It moved
  // nothing.
  if (transaction.meta?.err) return { ok: false, reason: "failed_on_chain" };

  if (typeof transaction.blockTime !== "number") {
    // The escrow check compares this against the draft's timestamp. A transfer
    // whose age cannot be established cannot be checked against any window.
    return { ok: false, reason: "not_found" };
  }

  // Inner instructions included: a Core transfer routed through another program
  // appears as a CPI, and a reader that only walked the top level would report
  // "no transfer" for a real one.
  const instructions = [
    ...(transaction.transaction?.message?.instructions ?? []),
    ...(transaction.meta?.innerInstructions ?? []).flatMap((inner) => inner.instructions ?? []),
  ];

  for (const instruction of instructions) {
    if (instruction.programId !== CORE_PROGRAM_ID) continue;
    const accounts = instruction.accounts ?? [];
    if (accounts.length <= NEW_OWNER_INDEX) continue;
    // The caller always knows which mint it cares about. Returning whatever
    // asset happened to move would let a transaction carrying two transfers
    // satisfy a check about either one.
    if (accounts[ASSET_INDEX] !== mint) continue;

    return {
      ok: true,
      mint,
      from: accounts[AUTHORITY_INDEX],
      to: accounts[NEW_OWNER_INDEX],
      blockTimeMs: transaction.blockTime * 1000,
    };
  }

  return { ok: false, reason: "no_transfer" };
}

/** Fetches the transaction and reads the movement out of it. */
export async function readAssetTransfer(
  signature: string,
  mint: string,
): Promise<EscrowTransfer> {
  let parsed: unknown;
  try {
    parsed = await rpcCall(primaryEndpoint(), "getTransaction", [
      signature,
      {
        encoding: "jsonParsed",
        commitment: RPC_COMMITMENT,
        maxSupportedTransactionVersion: 0,
      },
    ]);
  } catch (error) {
    // THE NAME, NEVER THE OBJECT. A rejected fetch carries the URL it was
    // given, and on a paid provider that URL has an api-key in its query
    // string. This path wants the signal, so it takes the one field that
    // cannot carry a secret.
    console.error(
      `readAssetTransfer: fetch failed (${error instanceof Error ? error.name : "unknown"})`,
    );
    return { ok: false, reason: "rpc_unavailable" };
  }

  return readAssetTransferFrom(parsed as ParsedTransaction, mint);
}
