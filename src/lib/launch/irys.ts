import { WebUploader } from "@irys/web-upload";
import { WebSolana } from "@irys/web-upload-solana";

/**
 * Putting a collection's art and metadata on Irys, paid for and signed by the
 * creator.
 *
 * **The bytes never reach this server** (spec §0.2). Hosting art for unvetted
 * strangers would make a no-doxx project into an image host with a moderation
 * obligation and a takedown surface, in exchange for nothing the product needs.
 * So the upload happens in the creator's browser, against Irys directly, with
 * the creator's wallet signing and paying.
 *
 * **This is NOT umi, and that is why it may be here.** `docs/decisions.md` Q21
 * confines `@metaplex-foundation/*` to the server; the Irys client is a
 * different dependency with a different job, and the test that enforces Q21
 * walks for metaplex packages specifically. What it does drag in is
 * `@solana/web3.js`, which this project had otherwise removed — a real cost,
 * recorded in `docs/launch-rehearsal.md`.
 *
 * **The RPC endpoint is OUR PROXY, never a provider's URL.** The Irys client
 * needs somewhere to read balances and submit the funding transfer; the browser
 * is given `/api/rpc/solana`, which is the same endpoint every other signature
 * in this product goes through and the reason no key of ours reaches a browser.
 *
 * WHO CALLS THIS: `src/components/LaunchCollection.tsx`, and
 * `scripts/irys-upload-e2e.mts` with a keypair-backed wallet in place of a
 * browser one.
 */

/**
 * The wallet, in the shape this module needs rather than the shape any
 * particular wallet has.
 *
 * Two capabilities, both of which a Wallet Standard connection can provide and
 * a keypair can imitate — which is what makes this path testable without a
 * browser at all.
 */
export type UploadWallet = {
  /** Base58, as the chain spells it. */
  address: string;
  /** Raw bytes in, raw signature out. Irys signs its own data items. */
  signMessageBytes(message: Uint8Array): Promise<Uint8Array>;
  /**
   * Signs and submits a transaction Irys built, returning its signature.
   *
   * Used only to fund the upload. Irys quotes a price per byte and it is small
   * — a few thousand lamports for a collection image — but it is not zero on
   * either network, measured 2026-09-02.
   */
  signAndSendSerialized(transaction: Uint8Array): Promise<string>;
};

export type UploadResult = { metadataUri: string; imageUri: string };

const GATEWAY = "https://gateway.irys.xyz";

export async function uploadLaunchMetadata(input: {
  wallet: UploadWallet;
  image: { bytes: Uint8Array; contentType: string };
  name: string;
  symbol: string;
  description: string;
  /** Which Irys network. Devnet nodes hold data for a limited time. */
  devnet: boolean;
  /** This deployment's own RPC proxy, e.g. `${origin}/api/rpc/solana`. */
  rpcUrl: string;
  /** Progress, because two uploads and a funding transfer is a long wait. */
  onStep?: (note: string) => void;
}): Promise<UploadResult> {
  const step = input.onStep ?? (() => {});

  /**
   * The adapter wants a web3.js-shaped wallet. Rather than pull web3.js in to
   * make a `PublicKey`, this supplies the three methods it actually calls —
   * which is also exactly what the end-to-end test can imitate with a keypair.
   */
  const provider = {
    publicKey: {
      toBytes: () => decodeBase58(input.wallet.address),
      toBuffer: () => Buffer.from(decodeBase58(input.wallet.address)),
      toBase58: () => input.wallet.address,
      toString: () => input.wallet.address,
    },
    signMessage: (message: Uint8Array) => input.wallet.signMessageBytes(message),
    sendTransaction: async (transaction: { serialize: (o?: unknown) => Uint8Array }) =>
      input.wallet.signAndSendSerialized(
        transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
      ),
  };

  step("Connecting to permanent storage…");
  const builder = WebUploader(WebSolana).withProvider(provider).withRpc(input.rpcUrl);
  const irys = await (input.devnet ? builder.devnet() : builder);

  /**
   * ONE deposit for both uploads, not one each.
   *
   * The Irys client confirms a funding transfer with `getTransaction`, which
   * this deployment's proxy deliberately does not expose to a browser — so it
   * waits its full thirty seconds, prints `didn't finalize`, and then proceeds,
   * because Irys credits the balance regardless. That wait is the cost of not
   * widening the proxy for a progress bar, and paying it once instead of twice
   * is free. The metadata document is a few hundred bytes; a kilobyte of slack
   * covers it.
   */
  step("Uploading the art…");
  await fundFor(irys, input.image.bytes.length + 1024, step);
  const image = await irys.upload(Buffer.from(input.image.bytes), {
    tags: [{ name: "Content-Type", value: input.image.contentType }],
  });
  const imageUri = `${GATEWAY}/${image.id}`;

  step("Uploading the metadata…");
  /**
   * The Metaplex JSON standard, which is what a wallet and every explorer read.
   * `properties.files` repeats the image with its type: readers disagree about
   * which field they honour, and a collection that renders in one place and not
   * another is the failure this shape avoids.
   */
  const metadata = {
    name: input.name,
    symbol: input.symbol,
    description: input.description,
    image: imageUri,
    properties: {
      category: "image",
      files: [{ uri: imageUri, type: input.image.contentType }],
    },
  };
  const document = Buffer.from(JSON.stringify(metadata));
  const receipt = await irys.upload(document, {
    tags: [{ name: "Content-Type", value: "application/json" }],
  });

  return { metadataUri: `${GATEWAY}/${receipt.id}`, imageUri };
}

/**
 * Deposits enough to store `bytes`, if the creator's Irys balance is short.
 *
 * **THE CLIENT DOES NOT DO THIS FOR YOU, which an end-to-end run found rather
 * than a document.** A one-pixel image and a 40 KB one both uploaded on a wallet
 * with nothing deposited, so the first version of this module had no funding
 * step at all and looked complete. A real 322 KB collection image came back
 * `402 error: Not enough balance for transaction` — the size at which every
 * actual launch would have failed, at the last step, after the creator had
 * filled in the form.
 *
 * **It over-deposits by a fifth, deliberately.** The price moves with the
 * network, and a second transfer because the quote drifted between the quote
 * and the upload is a second wallet prompt for a rounding error. What is left
 * over stays in the creator's own Irys balance for their next upload.
 */
async function fundFor(
  // The client's own type: it carries a BigNumber implementation of its own,
  // and restating that shape here would be a second definition to keep in step.
  irys: Awaited<ReturnType<ReturnType<typeof WebUploader>["devnet"]>>,
  bytes: number,
  step: (note: string) => void,
): Promise<void> {
  const price = await irys.getPrice(bytes);
  const balance = await irys.getLoadedBalance();
  if (balance.gte(price)) return;
  step("Paying the storage network…");
  // `fund` opens the wallet: this is the one prompt in the upload half, and it
  // is a transfer of a few thousand lamports rather than an approval.
  await irys.fund(price.minus(balance).multipliedBy(1.2).integerValue());
}

/**
 * Base58 to bytes, inline rather than imported from `lib/base58.ts`.
 *
 * That module's decoder returns `null` for bad input, which is right for a
 * boundary that has to refuse politely. Here the address has already been
 * through the wallet, so anything wrong with it is a bug rather than a bad
 * request, and it should throw where it happens.
 */
function decodeBase58(value: string): Uint8Array {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes: number[] = [0];
  for (const character of value) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) throw new Error(`not base58: ${character}`);
    let carry = index;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const character of value) {
    if (character !== "1") break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}
