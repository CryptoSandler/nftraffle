import { describe, expect, it } from "vitest";
import { AccountRole } from "@solana/kit";
import { buildListingDepositMessage } from "../listing-tx";
import { CORE_PROGRAM_ID, readAssetTransferFrom } from "../asset-transfer";

/**
 * The transaction a seller signs to list a raffle: the listing fee and the
 * prize, in one.
 *
 * **The discriminator is the number this file exists to pin.** `TransferV1` is
 * variant 14 of `MplAssetInstruction`, checked on 2026-09-01 against two
 * independent sources: the enum's own order in mpl-core's `instruction.rs`, and
 * the `14` written by the generated JS client's `transferV1`. Nothing in this
 * repository can tell a wrong discriminator from a right one at runtime except
 * a simulation, so it is asserted here and simulated on devnet before any
 * wallet is opened.
 */

const SELLER = "3xJ8pmXG6VMcVTQ4b4nJPMRXhVvQZQJ6ZfBUv8w8Yzqp";
const ESCROW = "9dGqKaZjKQq5rzKZDLLbaHwZKQq5rzKZDLLbaHwZKQq5";
const PAYMENT = "7Gk1LKn2yZ8v6VvHtqKQq5rzKZDLLbaHwZKQq5rzKZDL";
const ASSET = "5rzKZDLLbaHwZKQq5rzKZDLLbaHwZKQq5rzKZDLLbaHw";
const COLLECTION = "Cs8KY3PiWrCMAytMsBRQo8EdGbticVtdvufLnb2UhXh";
const BLOCKHASH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";

function build(over: Partial<Parameters<typeof buildListingDepositMessage>[0]> = {}) {
  return buildListingDepositMessage({
    seller: SELLER,
    escrow: ESCROW,
    paymentWallet: PAYMENT,
    feeLamports: 10_000_000n,
    asset: ASSET,
    collection: null,
    blockhash: BLOCKHASH,
    lastValidBlockHeight: 500n,
    ...over,
  });
}

/** The Core instruction, whichever position it ended up in. */
function coreInstruction(message: ReturnType<typeof build>) {
  const found = message.instructions.find((i) => i.programAddress === CORE_PROGRAM_ID);
  if (!found) throw new Error("no Core instruction in the message");
  return found as { accounts: { address: string; role: number }[]; data: Uint8Array };
}

describe("both legs travel together", () => {
  it("puts the fee and the prize in one transaction", () => {
    const message = build();

    // One signature, and a chain state where the fee was paid and the prize
    // never arrived cannot exist. Two transactions would make that state
    // reachable by a seller who signs the first and closes the tab.
    expect(message.instructions).toHaveLength(2);
    expect(message.instructions.map((i) => i.programAddress)).toContain(CORE_PROGRAM_ID);
  });

  it("omits the fee leg when the listing fee is switched off", () => {
    const message = build({ feeLamports: 0n });

    // Zero is the door: a deployment with no listing fee must not ask a seller
    // to sign a transfer of nothing, the way `publish` does not ask for its
    // signature.
    expect(message.instructions).toHaveLength(1);
    expect(message.instructions[0]!.programAddress).toBe(CORE_PROGRAM_ID);
  });

  it("asks for exactly one signature, the seller's", () => {
    const message = build();

    const signers = message.instructions
      .flatMap((i) => i.accounts ?? [])
      .filter((a) => a.role === AccountRole.READONLY_SIGNER || a.role === AccountRole.WRITABLE_SIGNER)
      .map((a) => a.address);

    expect(new Set(signers)).toEqual(new Set([SELLER]));
  });
});

describe("the TransferV1 instruction", () => {
  it("writes discriminator 14 and no compression proof", () => {
    const core = coreInstruction(build());

    // [14] = TransferV1. [0] = Option::None for compressionProof, which is what
    // an uncompressed asset carries. A second byte of 1 would make the program
    // read a proof that is not there.
    expect(Array.from(core.data)).toEqual([14, 0]);
  });

  it("fills the optional accounts with the program id instead of dropping them", () => {
    const core = coreInstruction(build());

    // Core reads its accounts POSITIONALLY. An omitted optional account shifts
    // every account after it, which is how a transfer becomes a transfer to the
    // wrong owner rather than an error. `asset-transfer.ts` documents having
    // seen exactly this on chain.
    expect(core.accounts).toHaveLength(7);
    expect(core.accounts[1]!.address).toBe(CORE_PROGRAM_ID); // no collection
    expect(core.accounts[3]!.address).toBe(CORE_PROGRAM_ID); // owner signs for itself
    /**
     * INCLUDING THE SYSTEM PROGRAM SLOT, which is the one that was guessed
     * wrong. The first version passed the real System Program here, on the
     * reasoning that a payer is present so rent might be needed. Reading a
     * transfer that mplx itself had made on devnet — signature
     * `pQJFwPCgEHaFP4ts…`, the rehearsal prize going into escrow — showed the
     * placeholder in this slot, and that is what this project's own reader has
     * always seen. Core only validates the account when it is present, so both
     * work; matching what the standard client emits means our transactions and
     * everyone else's are read the same way by every indexer.
     */
    expect(core.accounts[5]!.address).toBe(CORE_PROGRAM_ID); // no system program
    expect(core.accounts[6]!.address).toBe(CORE_PROGRAM_ID); // no log wrapper
  });

  it("names the collection when the asset belongs to one", () => {
    const core = coreInstruction(build({ collection: COLLECTION }));

    expect(core.accounts[1]!.address).toBe(COLLECTION);
  });

  it("sends the asset from the seller to escrow", () => {
    const core = coreInstruction(build());

    expect(core.accounts[0]!.address).toBe(ASSET);
    expect(core.accounts[2]!.address).toBe(SELLER);
    expect(core.accounts[4]!.address).toBe(ESCROW);
  });
});

describe("the transaction we build is the transaction our own check accepts", () => {
  it("reads back through readAssetTransferFrom as seller to escrow", () => {
    const core = coreInstruction(build());

    // The closing of the loop, and the reason this test is here rather than a
    // second set of assertions about account indexes: `publish` accepts a
    // deposit only if `readAssetTransferFrom` recognises it. Building a
    // transaction that reader would reject means a seller pays, deposits, and
    // cannot publish — with the prize already in escrow.
    const verdict = readAssetTransferFrom(
      {
        blockTime: 1_800_000_000,
        transaction: {
          message: {
            instructions: [
              { programId: CORE_PROGRAM_ID, accounts: core.accounts.map((a) => a.address) },
            ],
          },
        },
      },
      ASSET,
    );

    expect(verdict).toEqual({
      ok: true,
      asset: ASSET,
      from: SELLER,
      to: ESCROW,
      blockTimeMs: 1_800_000_000_000,
    });
  });
});
