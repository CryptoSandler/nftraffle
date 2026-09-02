import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { CORE_PROGRAM_ID } from "./asset-transfer";

/**
 * The transaction a seller signs to list a raffle: the listing fee to the
 * payment wallet and the prize into escrow, in one.
 *
 * **ONE TRANSACTION, NOT TWO, AND THAT IS THE POINT.** Two transactions make a
 * state reachable that this product has no way to resolve: the fee paid and the
 * prize never sent, by a seller who signed the first prompt and closed the tab.
 * Atomicity is free here — same signer, same blockhash — and `publish` verifies
 * the two legs independently either way, so it accepts the same signature
 * twice without knowing anything about this file.
 *
 * **WHY THIS IS HAND-ENCODED AND `@metaplex-foundation/mpl-core` IS NOT A
 * DEPENDENCY.** That client is built on umi, which is a second transaction
 * stack alongside `@solana/kit` — a large dependency for one instruction, in a
 * project that dropped `@solana/wallet-adapter-react` for exactly this reason
 * (`wallet/solana-standard.ts` records that trade and the audit result). What
 * is actually needed is two bytes and seven accounts.
 *
 * **The two bytes are pinned by a test and were verified against the program,
 * not remembered.** `TransferV1` is variant 14 of `MplAssetInstruction`,
 * confirmed on 2026-09-01 from mpl-core's own `instruction.rs` enum order and
 * from the `14` its generated JS client writes. A wrong discriminator produces
 * a transaction that fails simulation, which is why nothing here reaches a
 * wallet until `listing-intent.ts` has simulated it.
 *
 * Pure: it takes a blockhash rather than fetching one, like `payment-tx.ts`.
 *
 * WHO CALLS THIS: `buildListingDeposit` in `listing-intent.ts`.
 */

/** `Option::None`. An uncompressed asset carries no compression proof. */
const TRANSFER_V1 = new Uint8Array([14, 0]);


export function buildListingDepositMessage(input: {
  seller: string;
  escrow: string;
  paymentWallet: string;
  /** Zero switches the fee leg off entirely — see the test that names why. */
  feeLamports: bigint;
  asset: string;
  /** The asset's collection, or null. Core validates it when the asset has one. */
  collection: string | null;
  blockhash: string;
  lastValidBlockHeight: bigint;
}) {
  const seller = address(input.seller);

  /**
   * ABSENT OPTIONAL ACCOUNTS ARE FILLED WITH THE PROGRAM ID, NEVER DROPPED.
   *
   * Core reads its accounts positionally, so omitting `collection` would slide
   * `payer` into its slot and `authority` into `payer`'s — which is not an
   * error, it is a different instruction. `asset-transfer.ts` documents having
   * seen this convention on chain while reading real transfers back, and a bug
   * from misreading the same convention is what the devnet rehearsal caught.
   */
  const core = address(CORE_PROGRAM_ID);
  const transfer = {
    programAddress: core,
    accounts: [
      { address: address(input.asset), role: AccountRole.WRITABLE },
      { address: input.collection ? address(input.collection) : core, role: AccountRole.READONLY },
      { address: seller, role: AccountRole.WRITABLE_SIGNER },
      // `authority` unset: the owner is signing for themselves, which is what
      // the payer slot above already says.
      { address: core, role: AccountRole.READONLY },
      { address: address(input.escrow), role: AccountRole.READONLY },
      // The placeholder, not the real System Program: that is what a transfer
      // built by mplx carries, and Core only checks this account when it is
      // present. See the test that pins it.
      { address: core, role: AccountRole.READONLY },
      // `logWrapper` unset: this project reads transfers from the transaction
      // itself, never from an SPL Noop log.
      { address: core, role: AccountRole.READONLY },
    ],
    data: TRANSFER_V1,
  };

  const fee =
    input.feeLamports > 0n
      ? getTransferSolInstruction({
          // kit types `source` as a signer because kit can sign; this server
          // never signs, so the address is all there is. The cast says that
          // rather than inventing a signer object that would be a lie.
          source: { address: seller } as Parameters<typeof getTransferSolInstruction>[0]["source"],
          destination: address(input.paymentWallet),
          amount: input.feeLamports,
        })
      : null;

  return pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(seller, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: input.blockhash as Parameters<
            typeof setTransactionMessageLifetimeUsingBlockhash
          >[0]["blockhash"],
          lastValidBlockHeight: input.lastValidBlockHeight,
        },
        m,
      ),
    (m) => appendTransactionMessageInstructions(fee ? [fee, transfer] : [transfer], m),
  );
}
