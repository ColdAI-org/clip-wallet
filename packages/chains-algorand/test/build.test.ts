import { ClipError } from "@clip-wallet/core";
import { computeGroupID, decodeUnsignedTransaction } from "algosdk";
import { describe, expect, it } from "vitest";
import { buildGroup, createAlgorandModule, decodeTxn, logicSigAddress, readAccount, readLocalState } from "../src/index.js";
import { b64decode } from "../src/util.js";
import { FIX } from "./signatures.js";
import { NOT_OPTED_IN, USDC_ID, baseRoutes, ctxFor, mockFetch, reply } from "./helpers.js";

const kv = (key: string, uint: number) => ({ key: Buffer.from(key).toString("base64"), value: { bytes: "", type: 2, uint } });

describe("wallet-built groups (buildGroup)", () => {
  it("adds params, fees and a correct group id; no rekey or close-to; the module decodes it", async () => {
    const { fetch } = mockFetch(baseRoutes());
    const ctx = ctxFor(fetch);
    const { request, fee } = await buildGroup(
      [
        { type: "axfer", receiver: FIX.me, amount: 0n, assetId: BigInt(USDC_ID) },
        { type: "pay", receiver: FIX.bob, amount: 1_000_000n },
        { type: "appl", appId: 123456n, args: [new TextEncoder().encode("swap")], accounts: [FIX.bob], foreignAssets: [BigInt(USDC_ID), 0n], feeMultiplier: 2 },
      ],
      ctx,
    );
    expect(fee).toBe(4000n);
    expect(request).toMatchObject({ family: "algorand", method: "algo_signAndPostTxn", networkId: ctx.network.id });
    const raw = (request.params as { txn: string }[][])[0]!.map((w) => decodeUnsignedTransaction(b64decode(w.txn)));
    const copies = (request.params as { txn: string }[][])[0]!.map((w) => {
      const c = decodeTxn(w.txn);
      c.group = undefined;
      return c;
    });
    const gid = computeGroupID(copies);
    for (const t of raw) {
      expect(Buffer.from(t.group!).equals(Buffer.from(gid))).toBe(true);
      expect(t.sender.toString()).toBe(FIX.me);
      expect(t.rekeyTo).toBeUndefined();
      expect(t.firstValid).toBe(67902000n);
      expect(t.lastValid).toBe(67903000n);
    }
    expect(raw.map((t) => t.fee)).toEqual([1000n, 1000n, 2000n]);
    expect(raw[1]!.payment!.receiver.toString()).toBe(FIX.bob);
    expect(raw[2]!.applicationCall!.foreignAssets).toEqual([BigInt(USDC_ID), 0n]);
    const d = await createAlgorandModule({ simulate: false }).decode(request, ctx);
    expect(d.blind).toBe(false);
  });

  it("reads app local state and account holdings", async () => {
    const state = { "app-local-state": { id: 7, "key-value": [kv("asset_1_reserves", 42), { key: Buffer.from("k").toString("base64"), value: { bytes: "AQI=", type: 1, uint: 0 } }] } };
    const { fetch } = mockFetch(baseRoutes([
      [/\/applications\/7$/, state],
      [/\/applications\/8$/, reply(404, { message: "not found" })],
      [new RegExp(`/v2/accounts/${FIX.me}/assets/999$`), NOT_OPTED_IN],
    ]));
    const ctx = ctxFor(fetch);
    const s = await readLocalState(ctx, FIX.bob, 7n);
    expect(s!.get("asset_1_reserves")).toBe(42n);
    expect(Array.from(s!.get("k") as Uint8Array)).toEqual([1, 2]);
    expect(await readLocalState(ctx, FIX.bob, 8n)).toBeNull();
    const a = await readAccount(ctx, [BigInt(USDC_ID), 999n]);
    expect(a).toMatchObject({ balance: 4106015n, minBalance: 200000n, rekeyed: false });
    expect(a.holdings.get(USDC_ID)).toEqual({ amount: 10000000n, frozen: false });
    expect(a.holdings.get("999")).toBeNull();
    const down = mockFetch([]);
    await expect(readAccount(ctxFor(down.fetch))).rejects.toBeInstanceOf(ClipError);
  });

  it("logic signature addresses", () => {
    // Tinyman v2 ALGO/USDC testnet pool program (template with app 148607000, assets 10458941 and 0); checked live.
    const t = Buffer.from("BoAYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgQBbNQA0ADEYEkQxGYEBEkSBAUM=", "base64");
    const p = Buffer.concat([t.subarray(0, 3), Buffer.from("0000000008db9018", "hex"), Buffer.from("00000000009f973d", "hex"), Buffer.alloc(8), t.subarray(27)]);
    expect(logicSigAddress(new Uint8Array(p))).toBe("UDFWT5DW3X5RZQYXKQEMZ6MRWAEYHWYP7YUAPZKPW6WJK3JH3OZPL7PO2Y");
  });
});
