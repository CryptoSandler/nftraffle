import { describe, expect, it } from "vitest";
import { addEntry, firstAccount, hexToNumber, isUsableEntry, makeNonce } from "../evm-discovery";

/**
 * Reading the browser's EVM wallet list.
 *
 * Everything here arrives from a browser extension we do not control, so every
 * test is about what happens when it is not what we expected. A panel that
 * throws on one malformed announcement is a panel that does not work for anyone
 * who has two wallets installed.
 */

const entry = (rdns: string, name = rdns, uuid = `${rdns}-1`) => ({
  info: { uuid, name, icon: "data:image/svg+xml,x", rdns },
  provider: { request: async () => null },
});

describe("isUsableEntry", () => {
  it("accepts a well-formed announcement", () => {
    expect(isUsableEntry(entry("io.example"))).toBe(true);
  });

  it("drops anything malformed instead of throwing", () => {
    // One broken extension must not take the panel down for the others.
    const bad = [
      null,
      undefined,
      42,
      {},
      { info: {}, provider: {} },
      { info: { uuid: "u", name: "n", rdns: "r" }, provider: {} },
      { info: { uuid: "u", name: "", rdns: "r" }, provider: { request: () => {} } },
      { provider: { request: () => {} } },
    ];
    for (const value of bad) expect(isUsableEntry(value), JSON.stringify(value)).toBe(false);
  });
});

describe("addEntry", () => {
  it("deduplicates by rdns, not by uuid", () => {
    // A wallet re-announces on every request and may use a fresh uuid each
    // time. Keying on uuid gives a list with the same wallet repeated — a bug
    // people actually hit.
    const list = addEntry(addEntry([], entry("io.example", "Example", "u1")), entry("io.example", "Example", "u2"));
    expect(list).toHaveLength(1);
    expect(list[0].info.uuid).toBe("u2");
  });

  it("keeps distinct wallets, sorted by name", () => {
    const list = addEntry(addEntry([], entry("z.wallet", "Zebra")), entry("a.wallet", "Aardvark"));
    expect(list.map((e) => e.info.name)).toEqual(["Aardvark", "Zebra"]);
  });
});

describe("hexToNumber", () => {
  it("reads a chain id", () => {
    expect(hexToNumber("0x1")).toBe(1);
    expect(hexToNumber("0x1234")).toBe(4660);
  });

  it("refuses anything that is not a hex quantity", () => {
    for (const v of ["", "1234", "0x", "0xzz", null, 5, "0x" + "f".repeat(20)]) {
      expect(hexToNumber(v), String(v)).toBeNull();
    }
  });
});

describe("firstAccount", () => {
  it("takes a valid address", () => {
    expect(firstAccount(["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"])).toBe(
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    );
  });

  it("refuses what an order could never settle against", () => {
    // This value becomes the order's payer. Nonsense here is an order nobody
    // can ever pay.
    for (const v of [[], null, ["not an address"], [42], ["0x123"], {}]) {
      expect(firstAccount(v), JSON.stringify(v)).toBeNull();
    }
  });
});

describe("makeNonce", () => {
  it("is 16 hex characters from the platform CSPRNG", () => {
    const nonce = makeNonce(globalThis.crypto);
    expect(nonce).toMatch(/^[0-9a-f]{16}$/);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 200 }, () => makeNonce(globalThis.crypto)));
    expect(seen.size).toBe(200);
  });
});
