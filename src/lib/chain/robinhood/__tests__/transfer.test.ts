import { describe, expect, it } from "vitest";
import { readErc721Transfer, readNativeTransfer } from "../transfer";
import { ERC721_TRANSFER_TOPIC } from "../erc721";

/**
 * Reading money and assets out of an EVM receipt.
 *
 * The Solana verifier has to reconstruct a transfer from positional balance
 * deltas that include the fee. A receipt states `from`, `to` and `value`
 * outright, and an ERC-721 movement is an explicit `Transfer` event. So these
 * tests are mostly about the cases where the receipt is present but does NOT
 * mean what a careless reader would take it to mean.
 */

const PAYER = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const OTHER = "0x3333333333333333333333333333333333333333";
const NFT = "0x4444444444444444444444444444444444444444";

/** 32-byte topic encoding of an address, as a log carries it. */
function topicAddr(address: string): string {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    status: "0x1",
    from: PAYER,
    to: RECIPIENT,
    blockNumber: "0x64",
    logs: [],
    ...overrides,
  };
}

const tx = (overrides: Record<string, unknown> = {}) => ({
  from: PAYER,
  to: RECIPIENT,
  value: "0xde0b6b3a7640000", // 1 ETH
  ...overrides,
});

describe("readNativeTransfer", () => {
  it("reads a plain ETH transfer", () => {
    expect(readNativeTransfer(receipt(), tx(), RECIPIENT, 1_700_000_000)).toEqual({
      ok: true,
      payer: PAYER.toLowerCase(),
      amount: 1_000_000_000_000_000_000n,
      blockTimeMs: 1_700_000_000_000,
    });
  });

  it("refuses a reverted transaction, which still has a receipt", () => {
    // status 0x0 is a mined, reverted transaction. It has a from, a to and a
    // value, and it moved nothing. Reading only the tx object would credit it.
    expect(readNativeTransfer(receipt({ status: "0x0" }), tx(), RECIPIENT, 1)).toMatchObject({
      ok: false,
      reason: "failed_on_chain",
    });
  });

  it("refuses a transfer to a different address", () => {
    expect(readNativeTransfer(receipt({ to: OTHER }), tx({ to: OTHER }), RECIPIENT, 1)).toMatchObject({
      ok: false,
      reason: "no_transfer",
    });
  });

  it("refuses a zero-value transaction to the right address", () => {
    // A contract call to our wallet is not a payment.
    expect(readNativeTransfer(receipt(), tx({ value: "0x0" }), RECIPIENT, 1)).toMatchObject({
      ok: false,
      reason: "no_transfer",
    });
  });

  it("compares the recipient case-insensitively", () => {
    // EIP-55 checksummed addresses differ from lowercase ones by case alone.
    // A case-sensitive comparison would refuse a real payment depending on how
    // the wallet happened to spell the destination.
    const result = readNativeTransfer(receipt(), tx(), RECIPIENT.toUpperCase().replace("0X", "0x"), 1);
    expect(result.ok).toBe(true);
  });

  it("refuses a null receipt", () => {
    expect(readNativeTransfer(null, tx(), RECIPIENT, 1)).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("refuses when the transaction is missing even though the receipt is present", () => {
    expect(readNativeTransfer(receipt(), null, RECIPIENT, 1)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });

  it("refuses without a block timestamp rather than assuming one", () => {
    // Same discipline as Solana: a transfer whose age cannot be established
    // cannot be checked against any window, and guessing in the payer's favour
    // is the hole the window check exists to close.
    expect(readNativeTransfer(receipt(), tx(), RECIPIENT, null)).toMatchObject({
      ok: false,
      reason: "no_block_time",
    });
  });
});

describe("readErc721Transfer", () => {
  function transferLog(from: string, to: string, tokenId: bigint, contract = NFT) {
    return {
      address: contract,
      topics: [
        ERC721_TRANSFER_TOPIC,
        topicAddr(from),
        topicAddr(to),
        `0x${tokenId.toString(16).padStart(64, "0")}`,
      ],
    };
  }

  const asset = { contract: NFT, tokenId: 42n };

  it("reads a Transfer event for the asset we asked about", () => {
    const r = receipt({ logs: [transferLog(PAYER, RECIPIENT, 42n)] });
    expect(readErc721Transfer(r, asset, 1_700_000_000)).toEqual({
      ok: true,
      asset: `${NFT.toLowerCase()}/42`,
      from: PAYER.toLowerCase(),
      to: RECIPIENT.toLowerCase(),
      blockTimeMs: 1_700_000_000_000,
    });
  });

  it("ignores a Transfer of a different token id in the same transaction", () => {
    // A batch transfer emits several events. Matching the first would let a
    // transaction that moved a worthless token satisfy a check about a
    // valuable one.
    const r = receipt({ logs: [transferLog(PAYER, RECIPIENT, 7n), transferLog(PAYER, RECIPIENT, 42n)] });
    expect(readErc721Transfer(r, asset, 1)).toMatchObject({ ok: true, asset: `${NFT.toLowerCase()}/42` });
  });

  it("ignores a Transfer from a different contract", () => {
    // tokenId 42 exists in almost every collection. The contract is half the
    // identity and dropping it would be the most likely way to accept the
    // wrong asset.
    const r = receipt({ logs: [transferLog(PAYER, RECIPIENT, 42n, OTHER)] });
    expect(readErc721Transfer(r, asset, 1)).toMatchObject({ ok: false, reason: "no_transfer" });
  });

  it("ignores an ERC-20 Transfer, which shares the topic but has three topics", () => {
    // ERC-20 and ERC-721 share the Transfer signature. The difference is that
    // ERC-721 indexes the tokenId, so it has four topics and ERC-20 has three.
    // Without that check an ERC-20 movement of the right value could be read
    // as an NFT transfer.
    const erc20 = {
      address: NFT,
      topics: [ERC721_TRANSFER_TOPIC, topicAddr(PAYER), topicAddr(RECIPIENT)],
    };
    expect(readErc721Transfer(receipt({ logs: [erc20] }), asset, 1)).toMatchObject({
      ok: false,
      reason: "no_transfer",
    });
  });

  it("refuses a reverted transaction", () => {
    const r = receipt({ status: "0x0", logs: [transferLog(PAYER, RECIPIENT, 42n)] });
    expect(readErc721Transfer(r, asset, 1)).toMatchObject({ ok: false, reason: "failed_on_chain" });
  });

  it("refuses a transaction with no Transfer at all", () => {
    expect(readErc721Transfer(receipt(), asset, 1)).toMatchObject({ ok: false, reason: "no_transfer" });
  });

  it("refuses without a block timestamp", () => {
    const r = receipt({ logs: [transferLog(PAYER, RECIPIENT, 42n)] });
    expect(readErc721Transfer(r, asset, null)).toMatchObject({ ok: false, reason: "not_found" });
  });
});
