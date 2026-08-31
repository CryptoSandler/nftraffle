import type { EscrowTransfer } from "../../raffles/escrow";
import { RPC_COMMITMENT } from "./constants";
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
 * `TransferV1`'s account order: asset, collection, payer, authority, newOwner,
 * systemProgram, logWrapper.
 *
 * **OPTIONAL ACCOUNTS ARE FILLED WITH THE PROGRAM ID, NOT OMITTED**, so the
 * positions never shift — and that is the trap this constant list exists to
 * document. `authority` is optional: when the owner signs for themselves it is
 * left unset and Core writes its own program address into slot 3. An ordinary
 * self-transfer therefore looks like this on chain:
 *
 *     [0] asset
 *     [1] collection
 *     [2] payer          <- the actual sender
 *     [3] CoREENxT6t...  <- placeholder, NOT the authority
 *     [4] newOwner
 *
 * Reading slot 3 as the sender was a real bug, caught by the devnet rehearsal:
 * it compared the Core program id against the seller's wallet and refused every
 * legitimate deposit with `wrong_sender`. Nothing in a unit test written from
 * the IDL would have found it, because the IDL says the account is "authority"
 * and does not say what fills it when absent.
 */
const CORE_PROGRAM_PLACEHOLDER = CORE_PROGRAM_ID;
const ASSET_INDEX = 0;
const PAYER_INDEX = 2;
const AUTHORITY_INDEX = 3;
const NEW_OWNER_INDEX = 4;

/**
 * Who parted with the asset.
 *
 * The authority when one was supplied — a delegate moving somebody else's
 * asset — and the payer otherwise, which is the ordinary case of an owner
 * transferring their own. The placeholder check is what tells the two apart.
 */
function senderOf(accounts: string[]): string | null {
  const authority = accounts[AUTHORITY_INDEX];
  if (authority && authority !== CORE_PROGRAM_PLACEHOLDER) return authority;
  return accounts[PAYER_INDEX] ?? null;
}

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
  asset: string,
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
    if (accounts[ASSET_INDEX] !== asset) continue;

    const from = senderOf(accounts);
    if (!from) continue;

    return {
      ok: true,
      asset,
      from,
      to: accounts[NEW_OWNER_INDEX],
      blockTimeMs: transaction.blockTime * 1000,
    };
  }

  return { ok: false, reason: "no_transfer" };
}

/** Fetches the transaction and reads the movement out of it. */
export async function readAssetTransfer(
  signature: string,
  asset: string,
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

  return readAssetTransferFrom(parsed as ParsedTransaction, asset);
}
