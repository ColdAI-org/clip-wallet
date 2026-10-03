import { blake2b } from "@noble/hashes/blake2.js";
import { describe, expect, it } from "vitest";
import { CborMap, CborTag, addressesIn, constrOf, encodeCbor, outputDatum, parseTransaction, plutusAddress, witnessDatums } from "../src/index.js";
import { hex } from "../src/util.js";

const pkh = new Uint8Array(28).fill(1);
const skh = new Uint8Array(28).fill(2);
const addr = new CborTag(121, [new CborTag(121, [pkh]), new CborTag(121, [new CborTag(121, [new CborTag(121, [skh])])])]);

describe("plutus data", () => {
  it("reads constructors in all three encodings", () => {
    expect(constrOf(new CborTag(122, [1]))).toEqual({ index: 1, fields: [1] });
    expect(constrOf(new CborTag(1280, []))).toEqual({ index: 7, fields: [] });
    expect(constrOf(new CborTag(102, [200, [5]]))).toEqual({ index: 200, fields: [5] });
    expect(constrOf(new CborTag(24, new Uint8Array()))).toBeNull();
  });

  it("reads Plutus addresses and finds them inside a datum", () => {
    expect(plutusAddress(addr)).toEqual({ payment: { kind: "key", hash: pkh }, stake: { kind: "key", hash: skh } });
    const enterprise = new CborTag(121, [new CborTag(122, [skh]), new CborTag(122, [])]);
    expect(plutusAddress(enterprise)).toEqual({ payment: { kind: "script", hash: skh } });
    const datum = new CborTag(121, [new CborTag(121, [pkh]), addr, new CborTag(121, [enterprise, 5])]);
    expect(addressesIn(datum).map((a) => a.payment.kind)).toEqual(["key", "script"]);
  });

  it("resolves inline and witness-set datums for outputs", () => {
    const datum = new CborTag(121, [addr, 42]);
    const datumBytes = encodeCbor(datum);
    const hash = blake2b(datumBytes, { dkLen: 32 });
    const out = (d: unknown) => new CborMap([[0, Uint8Array.of(0x61, ...pkh)], [1, 2_000_000], [2, d as never]]);
    const body = new CborMap([
      [0, new CborTag(258, [[new Uint8Array(32), 0]])],
      [1, [out([0, hash]), out([1, new CborTag(24, datumBytes)])]],
      [2, 1],
    ]);
    const tx = parseTransaction(encodeCbor([body, new CborMap([[4, new CborTag(258, [datum])]]), true, null]));
    expect([...witnessDatums(tx).keys()]).toEqual([hex(hash)]);
    expect(tx.body.outputs[0]!.datumHash).toEqual(hash);
    expect(tx.body.outputs[1]!.inlineDatum).toEqual(datumBytes);
    for (const o of tx.body.outputs) expect(constrOf(outputDatum(tx, o)!)!.fields[1]).toBe(42);
  });
});
