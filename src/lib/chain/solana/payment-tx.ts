import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";

/**
 * The transfer a ticket buyer signs.
 *
 * Pure: it takes a blockhash rather than fetching one, so it can be driven from
 * Node and so there is only one place that talks to the RPC. A builder that
 * fetched its own lifetime would be a second path the endpoint could leak
 * through, and `/api/rpc` exists precisely so the browser never learns it.
 *
 * **Every value here comes from the server's own quote.** The amount is the one
 * `POST /api/raffles/[slug]/orders` returned, not one the browser recomputed
 * from a price and a quantity — a client that does its own arithmetic is a
 * client that can disagree with the order it is paying for.
 *
 * WHO CALLS THIS: `src/components/BuyTickets.tsx`.
 */
export function buildTicketPaymentMessage(input: {
  payer: string;
  payTo: string;
  amountLamports: bigint;
  /**
   * The Solana Pay reference, or null on a chain with no such convention.
   *
   * Attached as a READ-ONLY, NON-SIGNER account. It has to be on the
   * transaction so a reconcile pass can find a payment by it — and it must
   * never be a signer, because nobody holds its private key: this project
   * generates the keypair, reads out the public half, and discards the rest
   * (SECURITY.md I1). A transaction demanding its signature could not be signed
   * by anyone.
   */
  reference: string | null;
  blockhash: string;
  lastValidBlockHeight: bigint;
}) {
  if (input.amountLamports <= 0n) {
    throw new RangeError("A ticket payment needs a positive amount.");
  }

  // `address()` validates; a malformed value throws here rather than producing
  // a transaction aimed at something unintended.
  const payer = address(input.payer);
  const destination = address(input.payTo);

  /**
   * `source` takes a signer in kit's typing because kit can sign for you. We
   * never sign — the buyer's wallet does — so the address is all that is
   * needed, and the cast says so rather than inventing a signer object that
   * would be a lie about what this code can do.
   */
  const transfer = getTransferSolInstruction({
    source: { address: payer } as Parameters<typeof getTransferSolInstruction>[0]["source"],
    destination,
    amount: input.amountLamports,
  });

  const withReference = input.reference
    ? {
        ...transfer,
        accounts: [
          ...(transfer.accounts ?? []),
          { address: address(input.reference), role: AccountRole.READONLY },
        ],
      }
    : transfer;

  return pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(payer, m),
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
    (m) => appendTransactionMessageInstruction(withReference, m),
  );
}
