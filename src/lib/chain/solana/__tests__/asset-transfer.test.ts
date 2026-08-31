import { describe, expect, it } from "vitest";
import { readAssetTransferFrom } from "../asset-transfer";

/**
 * Reading an NFT movement out of a parsed transaction.
 *
 * The two places this answer is load-bearing are the two places somebody else's
 * property changes hands: publishing a raffle (did the prize really reach
 * escrow) and marking a payout paid (did the prize really reach the winner). A
 * wrong answer in the first sells tickets for an asset nobody deposited; a
 * wrong answer in the second puts a false settlement on a public page.
 *
 * Core assets move by a `TransferV1` instruction naming the asset, its current
 * owner and the new owner. This reads that shape and refuses everything else
 * rather than guessing.
 */

const OWNER = "6dNVEXCsBpisPjcyanBz4qgpm2SXPkR7wRPmuA6cxRLW";
const NEW_OWNER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const ASSET = "8H1yMDsxDs52kZ8kmDzYWiCoTfxLZDvcqcMjxLdbBnRz";
const CORE_PROGRAM = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";

function coreTransfer(overrides: Record<string, unknown> = {}) {
  return {
    blockTime: 1_800_000_000,
    meta: { err: null, innerInstructions: [] },
    transaction: {
      message: {
        accountKeys: [
          { pubkey: OWNER, signer: true },
          { pubkey: ASSET, signer: false },
          { pubkey: NEW_OWNER, signer: false },
          { pubkey: CORE_PROGRAM, signer: false },
        ],
        instructions: [
          {
            programId: CORE_PROGRAM,
            // TransferV1's discriminator is 14; accounts are, in order:
            // asset, collection, payer, authority, newOwner, …
            data: "F",
            accounts: [ASSET, CORE_PROGRAM, OWNER, OWNER, NEW_OWNER],
          },
        ],
        ...overrides,
      },
    },
  };
}

describe("readAssetTransferFrom", () => {
  it("reads a Core TransferV1", () => {
    expect(readAssetTransferFrom(coreTransfer(), ASSET)).toEqual({
      ok: true,
      asset: ASSET,
      from: OWNER,
      to: NEW_OWNER,
      blockTimeMs: 1_800_000_000_000,
    });
  });

  it("refuses a transaction that failed on chain", () => {
    // A failed transaction can still be fetched and still name accounts. It
    // moved nothing.
    const failed = coreTransfer();
    failed.meta = { err: { InstructionError: [0, "Custom"] }, innerInstructions: [] } as never;
    expect(readAssetTransferFrom(failed, ASSET)).toEqual({
      ok: false,
      reason: "failed_on_chain",
    });
  });

  it("refuses a transaction with no block time", () => {
    // The escrow check compares against the draft's timestamp. A transfer whose
    // age cannot be established cannot be checked against any window, and
    // guessing in the seller's favour is the hole that check exists to close.
    const noTime = coreTransfer();
    noTime.blockTime = null as never;
    expect(readAssetTransferFrom(noTime, ASSET)).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a null transaction", () => {
    expect(readAssetTransferFrom(null, ASSET)).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a transaction that moved no asset", () => {
    const noTransfer = coreTransfer();
    noTransfer.transaction.message.instructions = [
      { programId: "11111111111111111111111111111111", data: "3Bxs", accounts: [OWNER, NEW_OWNER] },
    ] as never;
    expect(readAssetTransferFrom(noTransfer, ASSET)).toEqual({ ok: false, reason: "no_transfer" });
  });

  it("refuses a Core instruction that does not name the asset we asked about", () => {
    // The caller always knows which mint it cares about. Returning whatever
    // asset happened to move would let a transaction carrying two transfers
    // satisfy a check about either one.
    expect(readAssetTransferFrom(coreTransfer(), "someOtherMint11111111111111111111111111111")).toEqual({
      ok: false,
      reason: "no_transfer",
    });
  });

  it("finds a transfer nested in an inner instruction", () => {
    // Core transfers routed through another program appear as CPIs, so a reader
    // that only walked the top level would report "no transfer" for a real one.
    const cpi = coreTransfer();
    cpi.transaction.message.instructions = [
      { programId: "someRouter1111111111111111111111111111111", data: "x", accounts: [] },
    ] as never;
    cpi.meta = {
      err: null,
      innerInstructions: [
        {
          index: 0,
          instructions: [
            { programId: CORE_PROGRAM, data: "F", accounts: [ASSET, CORE_PROGRAM, OWNER, OWNER, NEW_OWNER] },
          ],
        },
      ],
    } as never;
    expect(readAssetTransferFrom(cpi, ASSET)).toMatchObject({ ok: true, from: OWNER, to: NEW_OWNER });
  });
});

describe("who parted with the asset", () => {
  /**
   * THE BUG THE DEVNET REHEARSAL FOUND, pinned so it cannot come back.
   *
   * Core fills OPTIONAL accounts with its own program id rather than omitting
   * them, so positions never shift. `authority` is optional, and an owner
   * transferring their own asset leaves it unset — which puts
   * `CoREENxT6t…` in slot 3 and the real sender in slot 2 (`payer`).
   *
   * Reading slot 3 as the sender compared the program id against the seller's
   * wallet and refused every legitimate escrow deposit with `wrong_sender`.
   * These fixtures are the account layout of a real devnet transfer.
   */
  const OWNER = "F7FfSamtLjDwEx4cpHDV6EqtYjXf8HMDyiF98FbNogXE";
  const ESCROW = "FbXES1esmvNemD7ia9VBxiwqqHc7aPjmAaiFZ9FTgRjT";
  const ASSET = "7vijgH3n6ioKknmbnthcg2EsmM5JraX4CNvayAAzyT3H";
  const COLLECTION = "B7uiR1GhtdFUeEiLpnWT6vaN7bdWjkAcou53Eagma2uq";
  const CORE = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";

  function tx(accounts: string[]) {
    return {
      blockTime: 1_800_000_000,
      meta: { err: null, innerInstructions: [] },
      transaction: {
        message: {
          accountKeys: [{ pubkey: OWNER, signer: true }],
          instructions: [{ programId: CORE, data: "F", accounts }],
        },
      },
    };
  }

  it("reads the PAYER as the sender when authority is the program placeholder", () => {
    const t = tx([ASSET, COLLECTION, OWNER, CORE, ESCROW, CORE, CORE]);
    expect(readAssetTransferFrom(t, ASSET)).toMatchObject({
      ok: true,
      from: OWNER,
      to: ESCROW,
    });
  });

  it("reads the AUTHORITY when a real one signed — a delegate transfer", () => {
    const DELEGATE = "3Nq7EtQe3aUZLxRUkzYq9c6DdShxWFRp3wY4qWCTGVAH";
    const t = tx([ASSET, COLLECTION, OWNER, DELEGATE, ESCROW, CORE, CORE]);
    expect(readAssetTransferFrom(t, ASSET)).toMatchObject({ ok: true, from: DELEGATE });
  });

  it("never reports the Core program id as the sender", () => {
    // The specific wrong answer. It can never equal a wallet, so it turns every
    // real deposit into wrong_sender.
    const t = tx([ASSET, COLLECTION, OWNER, CORE, ESCROW, CORE, CORE]);
    const result = readAssetTransferFrom(t, ASSET);
    expect(result.ok && result.from).not.toBe(CORE);
  });
});
