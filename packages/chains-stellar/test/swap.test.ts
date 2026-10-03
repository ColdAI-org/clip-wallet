import { ClipError } from "@clip-wallet/core";
import { Asset, type Operation, type Transaction, TransactionBuilder } from "@stellar/stellar-base";
import { describe, expect, it } from "vitest";
import { STELLAR_TESTNET, USDC_ISSUERS, buildPathSwap, checkPathSwap, classicAsset, createStellarModule, networkPassphrase, xlmAsset } from "../src/index.js";
import { feeStats, meAccount } from "./fixtures.js";
import { ctxFor, makeAccount, mockStellar } from "./helpers.js";
import { FIX } from "./signatures.js";

const ME = FIX.me;
const NET = STELLAR_TESTNET.id;
const PASS = networkPassphrase(NET);
const USDC_T = USDC_ISSUERS.testnet;
const NOW = 1_790_000_000_000;
const AQUA = { code: "AQUA", issuer: "GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA" };
const fee = { ...feeStats, last_ledger_base_fee: "100", fee_charged: { ...feeStats.fee_charged, p50: "100" } };
const ledgers = { _embedded: { records: [{ sequence: 4999259, base_reserve_in_stroops: 5000000 }] } };
const meNoUsdc = { ...meAccount, subentry_count: 1, balances: meAccount.balances.filter((b) => b.asset_issuer !== USDC_T) };
const meWithUsdc = { ...meAccount, balances: meAccount.balances.map((b) => (b.asset_issuer === USDC_T ? { ...b, balance: "25.0000000" } : b)) };

function setup(me: unknown = meNoUsdc) {
  const mock = mockStellar({ [`/accounts/${ME}`]: me, "/fee_stats": fee, "/ledgers?order=desc&limit=1": ledgers });
  return { ctx: ctxFor(makeAccount(ME), mock.fetch), calls: mock.calls };
}

async function rejects(p: Promise<unknown>, code: string) {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(ClipError);
  expect((e as ClipError).code).toBe(code);
}

const usdcRef = classicAsset(NET, "USDC", USDC_T);

describe("buildPathSwap", () => {
  it("XLM → USDC without a trustline: changeTrust then pathPaymentStrictSend to yourself, one transaction", async () => {
    const { ctx } = setup();
    const { request, addsTrustline } = await buildPathSwap({ sell: xlmAsset(NET), buy: usdcRef, sendAmount: "100000000", destMin: "94184622", path: [AQUA] }, ctx, { now: () => NOW });
    expect(addsTrustline).toBe(true);
    expect(request).toMatchObject({ family: "stellar", networkId: NET, method: "stellar_signAndSubmitXDR", params: { networkPassphrase: PASS, address: ME } });
    const tx = TransactionBuilder.fromXDR((request.params as { xdr: string }).xdr, PASS) as Transaction;
    expect(tx.source).toBe(ME);
    expect(tx.sequence).toBe((BigInt(meAccount.sequence) + 1n).toString());
    expect(tx.fee).toBe("200");
    expect(tx.timeBounds).toEqual({ minTime: "0", maxTime: String(NOW / 1000 + 300) });
    expect(tx.operations).toHaveLength(2);
    const ct = tx.operations[0] as Operation.ChangeTrust;
    expect(ct.type).toBe("changeTrust");
    expect((ct.line as Asset).equals(new Asset("USDC", USDC_T))).toBe(true);
    expect(ct.limit).toBe("922337203685.4775807");
    const pp = tx.operations[1] as Operation.PathPaymentStrictSend;
    expect(pp).toMatchObject({ type: "pathPaymentStrictSend", sendAmount: "10.0000000", destination: ME, destMin: "9.4184622" });
    expect(pp.sendAsset.isNative()).toBe(true);
    expect(pp.destAsset.equals(new Asset("USDC", USDC_T))).toBe(true);
    expect(pp.path.map((a) => `${a.getCode()}:${a.getIssuer()}`)).toEqual([`${AQUA.code}:${AQUA.issuer}`]);
    expect(pp.source).toBeUndefined();

    const m = createStellarModule({ now: () => NOW });
    const d = await m.decode(request, ctx);
    expect(d.blind).toBe(false);
    expect(d.title).toBe("Add USDC to your account and swap 10 XLM for at least 9.4184622 USDC");
  });

  it("USDC → XLM with the trustline already there: just the path payment", async () => {
    const { ctx } = setup(meWithUsdc);
    const { request, addsTrustline } = await buildPathSwap({ sell: usdcRef, buy: xlmAsset(NET), sendAmount: "50000000", destMin: "1", path: [] }, ctx, { now: () => NOW });
    expect(addsTrustline).toBe(false);
    const tx = TransactionBuilder.fromXDR((request.params as { xdr: string }).xdr, PASS) as Transaction;
    expect(tx.fee).toBe("100");
    expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0]).toMatchObject({ type: "pathPaymentStrictSend", sendAmount: "5.0000000", destMin: "0.0000001", destination: ME, path: [] });
  });

  it("checks balances, the minimum balance and the assets", async () => {
    await rejects(checkPathSwap({ sell: usdcRef, buy: xlmAsset(NET), sendAmount: "1" }, setup().ctx), "stellar/insufficient-token");
    await rejects(checkPathSwap({ sell: usdcRef, buy: xlmAsset(NET), sendAmount: "250000001" }, setup(meWithUsdc).ctx), "stellar/insufficient-token");
    await rejects(checkPathSwap({ sell: xlmAsset(NET), buy: usdcRef, sendAmount: "199310000000" }, setup().ctx), "stellar/insufficient-balance");
    await rejects(checkPathSwap({ sell: xlmAsset(NET), buy: xlmAsset(NET), sendAmount: "1" }, setup().ctx), "stellar/same-asset");
    await rejects(checkPathSwap({ sell: xlmAsset(NET), buy: usdcRef, sendAmount: "0" }, setup().ctx), "stellar/bad-amount");
    const sac = { ...usdcRef, key: "sep41:C", address: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC" };
    await rejects(checkPathSwap({ sell: xlmAsset(NET), buy: sac, sendAmount: "1" }, setup().ctx), "stellar/swap-unsupported-asset");
    const fresh = mockStellar({});
    await rejects(checkPathSwap({ sell: xlmAsset(NET), buy: usdcRef, sendAmount: "1" }, ctxFor(makeAccount(ME), fresh.fetch)), "stellar/not-activated");
    const c = await checkPathSwap({ sell: xlmAsset(NET), buy: usdcRef, sendAmount: "10000000" }, setup().ctx);
    expect(c).toEqual({ addsTrustline: true, reserve: 5_000_000n, feePerOp: 100n });
    await rejects(buildPathSwap({ sell: xlmAsset(NET), buy: usdcRef, sendAmount: "1", destMin: "1", path: Array(6).fill(AQUA) }, setup().ctx), "stellar/path-too-long");
  });
});
