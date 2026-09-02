import { createHash } from "node:crypto";
import {
  createNoopSigner,
  dateTime,
  generateSigner,
  lamports,
  publicKey,
  some,
  type Signer,
  type Umi,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { createCollectionV1, mplCore } from "@metaplex-foundation/mpl-core";
import {
  create,
  fetchCandyGuard,
  fetchCandyMachine,
  mintV1,
  mplCandyMachine,
} from "@metaplex-foundation/mpl-core-candy-machine";
import { transferSol } from "@metaplex-foundation/mpl-toolbox";
import { primaryEndpoint } from "../chain/solana/rpc";

/**
 * The launchpad's on-chain half: building the transaction a creator signs to
 * launch a collection, and reading the result back to see what was actually
 * deployed.
 *
 * **SERVER ONLY.** `docs/decisions.md` Q21 is the owner's exception letting umi
 * into this project at all, and it stops at this boundary.
 * `src/lib/__tests__/client-bundle.test.ts` walks the client import graph from
 * every `"use client"` entry and fails if any `@metaplex-foundation` package is
 * reachable — including three files down, which is how it would happen.
 *
 * **The `server-only` package was tried here and removed.** It throws on
 * `require` outside Next's react-server condition, which means the rehearsal
 * script and any test that drives this module cannot import it — so the price
 * of that guard is that the code it guards stops being verifiable. The import
 * walk catches strictly more (transitive paths, not just direct imports) and
 * costs nothing at runtime.
 *
 * **THE SERVER SIGNS FOR THE TWO ACCOUNTS IT CREATES, AND FOR NOTHING ELSE.**
 * A Core collection and a candy machine are new accounts, and a new account's
 * own keypair has to sign its creation. Those two keypairs are generated inside
 * one request, sign that request's transaction, and are never written down —
 * the same shape as the Solana Pay reference in `chain/solana/reference.ts`,
 * one step further. What the signatures authorise is the creation of the
 * accounts themselves: they are not authorities on anything afterwards (the
 * creator is), they hold no lamports, and no code path here can move money with
 * them. CLAUDE.md's rule that nothing in this repository holds a private key is
 * about `ESCROW_WALLET` and `PAYMENT_WALLET`, which remain untouched and
 * unreachable from this file.
 *
 * **The creator pays and signs everything else**, as a noop signer here whose
 * signature the browser supplies. That is why the transaction comes back
 * partially signed rather than sent.
 *
 * WHO CALLS THIS: `POST /api/collections` builds, `POST
 * /api/collections/[slug]/publish` reads back, `POST
 * /api/collections/[slug]/mint` builds a mint.
 */

/**
 * What a failed mint costs a bot, in lamports.
 *
 * Not revenue: `botTax` exists so that a mint that fails a guard still burns
 * something, which is what makes hammering the machine expensive. 0.001 SOL is
 * Metaplex's own documented default and is deliberately small — a person who
 * mistimes the start date pays it too, and it should sting a script rather than
 * a human.
 */
const BOT_TAX_LAMPORTS = 1_000_000n;

function umiFor(): Umi {
  return createUmi(primaryEndpoint()).use(mplCore()).use(mplCandyMachine());
}

export type LaunchPlan = {
  /** The partially signed transaction, base64, for the creator's wallet. */
  transaction: string;
  collection: string;
  candyMachine: string;
};

export async function buildLaunchTransaction(input: {
  creator: string;
  name: string;
  /** The collection's metadata JSON, already on Irys. */
  uri: string;
  itemsAvailable: number;
  priceLamports: bigint;
  /** Frozen for this machine's life. See `docs/decisions.md` Q21 and spec §0.1. */
  mintFeeLamports: bigint;
  mintLimit: number;
  startsAtMs: number;
  paymentWallet: string;
  launchFeeLamports: bigint;
}): Promise<LaunchPlan> {
  const umi = umiFor();
  const creator = createNoopSigner(publicKey(input.creator));
  umi.identity = creator;
  umi.payer = creator;

  const collection = generateSigner(umi);
  const candyMachine = generateSigner(umi);

  /**
   * Every item shares one metadata URI, and that is v1's shape rather than a
   * shortcut around config lines.
   *
   * `hiddenSettings` names the collection's metadata once and stamps an index
   * into each minted asset's name. The alternative — a config line per item —
   * is one more transaction per ~10 items, so a 1,000-item launch would be a
   * hundred wallet prompts, and "instant launch" (DESIGN.md §1, arrow one) is
   * the thing that would pay for it.
   * // ponytail: identical items with an index. Per-item art needs config lines
   * // and the batching that goes with them; add it when a creator asks for it.
   */
  const hidden = some({
    name: `${input.name} #$ID+1$`,
    uri: input.uri,
    // A 32-byte commitment to the metadata the machine was created with, which
    // is what makes a later swap of the URI detectable.
    hash: new Uint8Array(createHash("sha256").update(input.uri).digest()),
  });

  const builder = transferSol(umi, {
    source: creator,
    destination: publicKey(input.paymentWallet),
    amount: lamports(input.launchFeeLamports),
  })
    .add(
      createCollectionV1(umi, {
        collection,
        name: input.name,
        uri: input.uri,
        updateAuthority: publicKey(input.creator),
      }),
    )
    .add(
      await create(umi, {
        candyMachine,
        collection: collection.publicKey,
        collectionUpdateAuthority: creator,
        itemsAvailable: BigInt(input.itemsAvailable),
        isMutable: false,
        hiddenSettings: hidden,
        guards: {
          /** The mint price, straight to the creator. This server never holds it. */
          solPayment: some({
            lamports: lamports(input.priceLamports),
            destination: publicKey(input.creator),
          }),
          /**
           * OUR FEE, ENFORCED BY THE PROGRAM AND NOT BY OUR CODE (spec §0.1).
           * A minter who assembles their own transaction still pays it, because
           * without it the candy machine's own guard evaluation fails the mint.
           */
          solFixedFee: some({
            lamports: lamports(input.mintFeeLamports),
            destination: publicKey(input.paymentWallet),
          }),
          startDate: some({ date: dateTime(new Date(input.startsAtMs)) }),
          mintLimit: some({ id: 1, limit: input.mintLimit }),
          botTax: some({ lamports: lamports(BOT_TAX_LAMPORTS), lastInstruction: true }),
        },
      }),
    );

  const built = await builder.setFeePayer(creator).buildWithLatestBlockhash(umi);
  const signed = await signWith(built, [collection, candyMachine]);

  return {
    transaction: Buffer.from(umi.transactions.serialize(signed)).toString("base64"),
    collection: collection.publicKey.toString(),
    candyMachine: candyMachine.publicKey.toString(),
  };
}

/** Applies the ephemeral account signatures, in order, leaving the creator's slot empty. */
async function signWith<T>(transaction: T, signers: Signer[]): Promise<T> {
  let signed = transaction;
  for (const signer of signers) {
    // @ts-expect-error umi's Transaction type is structural; the loop is the point.
    signed = await signer.signTransaction(signed);
  }
  return signed;
}

export type DeployedLaunch = {
  itemsAvailable: bigint;
  itemsRedeemed: bigint;
  collection: string;
  authority: string;
  /** null when the guard is absent — which is the case this exists to catch. */
  fee: { destination: string; lamports: bigint } | null;
  price: { destination: string; lamports: bigint } | null;
  startsAtMs: number | null;
};

/**
 * What is ACTUALLY deployed at `address`, read from the chain.
 *
 * **This is the check that makes the platform fee true rather than intended**
 * (spec §5.3 step 4). The creator assembles and signs the launch transaction,
 * so the creator can also assemble one without our guard — the transaction we
 * handed them is a suggestion until the account is read back. A launch whose
 * `solFixedFee` is missing, points somewhere else, or is smaller than the
 * amount the collection was quoted at does not go live.
 */
export async function readDeployedLaunch(address: string): Promise<DeployedLaunch | null> {
  const umi = umiFor();
  try {
    const machine = await fetchCandyMachine(umi, publicKey(address));
    const guard = await fetchCandyGuard(umi, machine.mintAuthority);
    const guards = guard.guards;
    return {
      itemsAvailable: machine.data.itemsAvailable,
      itemsRedeemed: machine.itemsRedeemed,
      collection: machine.collectionMint.toString(),
      authority: machine.authority.toString(),
      fee:
        guards.solFixedFee.__option === "Some"
          ? {
              destination: guards.solFixedFee.value.destination.toString(),
              lamports: guards.solFixedFee.value.lamports.basisPoints,
            }
          : null,
      price:
        guards.solPayment.__option === "Some"
          ? {
              destination: guards.solPayment.value.destination.toString(),
              lamports: guards.solPayment.value.lamports.basisPoints,
            }
          : null,
      startsAtMs:
        guards.startDate.__option === "Some" ? Number(guards.startDate.value.date) * 1000 : null,
    };
  } catch {
    // A machine that cannot be read is not a machine that is fine. The caller
    // refuses rather than publishing.
    return null;
  }
}

/**
 * The transaction a minter signs.
 *
 * Partially signed here for the same reason as the launch: the minted asset is
 * a new account and its keypair has to sign its own creation. The minter pays,
 * and both guards — the creator's price and our fee — are charged by the
 * program.
 */
export async function buildMintTransaction(input: {
  minter: string;
  candyMachine: string;
  collection: string;
  creator: string;
  paymentWallet: string;
}): Promise<{ transaction: string; asset: string }> {
  const umi = umiFor();
  const minter = createNoopSigner(publicKey(input.minter));
  umi.identity = minter;
  umi.payer = minter;

  const asset = generateSigner(umi);

  const builder = mintV1(umi, {
    candyMachine: publicKey(input.candyMachine),
    asset,
    collection: publicKey(input.collection),
    mintArgs: {
      solPayment: some({ destination: publicKey(input.creator) }),
      solFixedFee: some({ destination: publicKey(input.paymentWallet) }),
      mintLimit: some({ id: 1 }),
    },
  });

  const built = await builder.setFeePayer(minter).buildWithLatestBlockhash(umi);
  const signed = await signWith(built, [asset]);

  return {
    transaction: Buffer.from(umi.transactions.serialize(signed)).toString("base64"),
    asset: asset.publicKey.toString(),
  };
}
