import { describe, expect, it } from "vitest";
import { type Utxo, DUST_SATS, selectLargestFirst } from "../src/coinselect.js";

const u = (value: number, kind: "wpkh" | "tr" = "wpkh", id = String(value)): Utxo => ({ txid: id.padStart(64, "0"), vout: 0, value: BigInt(value), script: new Uint8Array(), kind });

describe("largest-first coin selection", () => {
  it("takes the largest coin first and returns change", () => {
    const s = selectLargestFirst([u(10_000), u(80_000), u(30_000)], [{ amount: 50_000n, type: "wpkh" }], 2, "wpkh");
    expect(s.inputs.map((x) => Number(x.value))).toEqual([80_000]);
    // 10.5 + 68 + 31 + 31 = 140.5 → 141 vB × 2
    expect(s.vsize).toBe(141);
    expect(s.fee).toBe(282n);
    expect(s.change).toBe(80_000n - 50_000n - 282n);
  });

  it("adds coins until amount + fee is covered", () => {
    const s = selectLargestFirst([u(40_000), u(30_000), u(20_000)], [{ amount: 65_000n, type: "tr" }], 1, "wpkh");
    expect(s.inputs.map((x) => Number(x.value))).toEqual([40_000, 30_000]);
    expect(s.inputs.reduce((a, x) => a + x.value, 0n)).toBe(65_000n + s.fee + s.change);
  });

  it("drops dust change into the fee", () => {
    const s = selectLargestFirst([u(50_300)], [{ amount: 50_000n, type: "wpkh" }], 1, "wpkh");
    expect(s.change).toBe(0n);
    expect(s.fee).toBe(300n);
    expect(s.fee < DUST_SATS + 200n).toBe(true);
  });

  it("uses deprioritised (possibly inscribed) coins last", () => {
    const s = selectLargestFirst([u(9_000), u(600_000)], [{ amount: 1_000n, type: "wpkh" }], 1, "wpkh", (x) => x.value <= 10_000n);
    expect(s.inputs.map((x) => Number(x.value))).toEqual([600_000]);
    const big = selectLargestFirst([u(9_000), u(20_000)], [{ amount: 25_000n, type: "wpkh" }], 1, "wpkh", (x) => x.value <= 10_000n);
    expect(big.inputs.map((x) => Number(x.value))).toEqual([20_000, 9_000]);
  });

  it("taproot inputs are cheaper", () => {
    const a = selectLargestFirst([u(100_000, "tr")], [{ amount: 1_000n, type: "wpkh" }], 10, "wpkh");
    const b = selectLargestFirst([u(100_000, "wpkh")], [{ amount: 1_000n, type: "wpkh" }], 10, "wpkh");
    expect(a.fee < b.fee).toBe(true);
  });

  it("fails in plain words when funds are short", () => {
    expect(() => selectLargestFirst([u(1_000)], [{ amount: 5_000n, type: "wpkh" }], 1, "wpkh")).toThrow(/enough BTC/);
    expect(() => selectLargestFirst([u(1_000)], [{ amount: 0n, type: "wpkh" }], 1, "wpkh")).toThrow(/above zero/);
  });
});
