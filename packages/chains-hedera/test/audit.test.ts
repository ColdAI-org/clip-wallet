/**
 * Internal audit 2026-10 (docs/audit/internal-audit-2026-10.md): Hedera transaction-list integrity.
 *  HED-01  every body in a TransactionList must be the same transaction (only the node may differ).
 *  HED-02  a body may not repeat a singular field or carry two data cases.
 */
import { describe, expect, it } from "vitest";
import { BODY, decodeBody, encodeBody, encodeSignedTransaction, encodeTransactionList } from "../src/proto/hapi.js";
import { parseTransaction } from "../src/tx.js";
import { concat } from "../src/proto/wire.js";

const txId = { accountId: { shard: 0n, realm: 0n, num: 1234n }, validStart: { seconds: 1790000000n, nanos: 1 } };
const node = (num: bigint) => ({ shard: 0n, realm: 0n, num });
const list = (bodies: Uint8Array[]) => encodeTransactionList(bodies.map((bodyBytes) => encodeSignedTransaction({ bodyBytes, sigPairs: [] })));
const body = (nodeNum: bigint, data: Uint8Array) =>
  encodeBody({ transactionId: txId as never, nodeAccountId: node(nodeNum) as never, fee: 100_000_000n, validDuration: 120, kind: BODY.cryptoTransfer, data });

describe("audit: Hedera transaction lists", () => {
  it("HED-01: accepts the same transaction for different nodes", () => {
    const data = new Uint8Array([0x0a, 0x00]);
    const parsed = parseTransaction(list([body(3n, data), body(4n, data), body(5n, data)]));
    expect(parsed.entries).toHaveLength(3);
  });

  it("HED-01: refuses a list whose later body is a different transaction", () => {
    const shown = new Uint8Array([0x0a, 0x00]);
    const hidden = new Uint8Array([0x0a, 0x02, 0x0a, 0x00]);
    expect(() => parseTransaction(list([body(999999n, shown), body(3n, hidden)]))).toThrow(/differ/);
  });

  it("HED-02: refuses a body with two data cases or a repeated header field", () => {
    const one = body(3n, new Uint8Array([0x0a, 0x00]));
    // Append a second cryptoTransfer (field 14, length-delimited, empty).
    const twice = concat([one, new Uint8Array([(BODY.cryptoTransfer << 3) | 2, 0])]);
    expect(() => decodeBody(twice)).toThrow(/repeats/);
    const twoMemos = concat([one, new Uint8Array([(6 << 3) | 2, 1, 0x41]), new Uint8Array([(6 << 3) | 2, 1, 0x42])]);
    expect(() => decodeBody(twoMemos)).toThrow(/repeats/);
    expect(decodeBody(one).kind).toBe(BODY.cryptoTransfer);
  });
});

describe("audit: Hedera wallet-only methods", () => {
  it("HED-03: a site can't call clip_hedera_signTransactionBytes", async () => {
    const { createHederaModule } = await import("../src/index.js");
    const mod = createHederaModule();
    const req = { id: "x", origin: "https://evil.example", via: "injected" as const, family: "hedera" as const, networkId: "hedera:testnet", method: "clip_hedera_signTransactionBytes", params: {} };
    const ctx = { network: { id: "hedera:testnet" }, account: { id: "hedera:0", publicKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", address: "0x" + "00".repeat(20) }, fetch } as never;
    await expect(mod.decode(req, ctx)).rejects.toMatchObject({ code: "hedera/unsupported-method" });
    await expect(mod.prepare(req, ctx, "a")).rejects.toMatchObject({ code: "hedera/unsupported-method" });
  });
});
