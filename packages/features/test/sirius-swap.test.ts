import { TEZOS_MAINNET, TEZOS_SHADOWNET, xtzAsset } from "@clip-wallet/chains-tezos";
import type { AssetRef, DappRequest } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { SiriusSwap, verifySiriusRequest } from "../src/swap/sirius.js";
import { BASE_MAINNET, mockFetch, type Route } from "./helpers.js";
import { NODE_ROUTES, TZKT_DEFAULTS, TZ_ME, decodeTitle, forgeAndParse, tezosCtx } from "./tezos-fixtures.js";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const CPMM = "KT1TxqZ8QtKvLu3V3JH7Gx58n7Co8pgtpQU5";
const TZBTC = "KT1PWx2mnDueood7fEmfbBDKx1D9BAnnXitn";
/** Mainnet GET …/contracts/KT1TxqZ8…/storage, 2026-10-03: tokenPool, xtzPool, lqtTotal, tokenAddress, lqtAddress. */
const storage = (token = TZBTC) => ({
  prim: "Pair",
  args: [{ int: "1194877609" }, { int: "3209092800671" }, { int: "22257176" }, { string: token }, { string: "KT1AafHA1C1vk959wvHWBispY9Y2f3fxBUUo" }],
});

const XTZ = xtzAsset(TEZOS_MAINNET.id);
const tzBTC: AssetRef = { key: `fa:${TZBTC}:0`, symbol: "tzBTC", name: "tzBTC", decimals: 8, networkId: TEZOS_MAINNET.id, address: TZBTC };
const USDT: AssetRef = { key: "usdt", symbol: "USDt", name: "Tether USD", decimals: 6, networkId: TEZOS_MAINNET.id, address: "KT1XnTn74bUtxHfDtBmm2bGZAQfhPbvKWR8o" };

function setup(opts: { cpmm?: string; token?: string } = {}) {
  const routes: Route[] = [
    ...NODE_ROUTES,
    [/\/context\/liquidity_baking\/cpmm_address$/, opts.cpmm ?? CPMM],
    [/\/contracts\/KT1\w+\/storage$/, storage(opts.token)],
    [new RegExp(`/v1/accounts/${CPMM}$`), { alias: "Sirius DEX" }],
    [/\/v1\/tokens\?contract=KT1PWx2mnDueood7fEmfbBDKx1D9BAnnXitn/, [{ contract: { address: TZBTC, alias: "tzBTC" }, tokenId: "0", standard: "fa1.2", totalSupply: "2100000000000000", metadata: { name: "tzBTC", symbol: "tzBTC", decimals: "8" } }]],
    ...TZKT_DEFAULTS,
  ];
  const { fetch, calls } = mockFetch(routes);
  return { ctx: tezosCtx(TEZOS_MAINNET, fetch), calls, swap: new SiriusSwap({ now: () => NOW }) };
}

const entry = (o: Record<string, unknown>) => o.parameters as { entrypoint: string; value: unknown };

describe("Sirius (Liquidity Baking) swap", () => {
  it("mainnet only, Tezos only", () => {
    const s = new SiriusSwap();
    expect(s.availability(TEZOS_MAINNET)).toBeNull();
    expect(s.availability(TEZOS_SHADOWNET)).toEqual({ code: "swap/mainnet-only", message: "Swapping these tokens isn't available in this test version yet." });
    expect(s.availability(BASE_MAINNET)?.code).toBe("swap/wrong-family");
  });

  it("quotes XTZ → tzBTC with the contract's own maths and a 30 s expiry", async () => {
    const { ctx, calls, swap } = setup();
    const q = await swap.quote({ sell: XTZ, buy: tzBTC, amount: "10000000", slippageBps: 50 }, ctx);
    expect(q).toMatchObject({ providerId: "sirius", provider: "Sirius", sellAmount: "10000000", buyAmount: "3715", minBuyAmount: "3696", route: ["Sirius"], expiresAt: NOW + 30_000 });
    expect(q.approval).toBeUndefined();
    expect(q.priceImpactPct).toBeGreaterThan(0.19);
    expect(q.priceImpactPct).toBeLessThan(0.25);
    expect(calls.map((c) => c.url)).toContain("https://rpc.tzbeta.net/chains/main/blocks/head/context/liquidity_baking/cpmm_address");
  });

  it("builds xtzToToken with the minimum and a 10-minute deadline (forged and parsed back)", async () => {
    const { ctx, swap } = setup();
    const q = await swap.quote({ sell: XTZ, buy: tzBTC, amount: "10000000", slippageBps: 50 }, ctx);
    const steps = await swap.build(q, ctx);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.title).toBe("Swap 10 XTZ for ~0.00003715 tzBTC");
    expect(steps[0]!.lines).toEqual([{ label: "You get at least", value: "0.00003696 tzBTC" }]);
    const r = steps[0]!.request as DappRequest;
    const ops = await forgeAndParse(r, ctx);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: "transaction", destination: CPMM, amount: "10000000" });
    expect(entry(ops[0]!)).toEqual({
      entrypoint: "xtzToToken",
      value: { prim: "Pair", args: [{ string: TZ_ME }, { prim: "Pair", args: [{ int: "3696" }, { int: String(NOW / 1000 + 600) }] }] },
    });
    expect(steps[0]!.verify!(r)).toBe(true);
    const d = await decodeTitle(r, ctx);
    expect(d.blind).toBe(false);
    expect(d.title).toBe("Call xtzToToken on Sirius DEX with 10 XTZ");
  });

  it("tzBTC → XTZ: approve 0, approve exactly the amount, tokenToXtz (allowance ends at 0)", async () => {
    const { ctx, swap } = setup();
    const q = await swap.quote({ sell: tzBTC, buy: XTZ, amount: "100000", slippageBps: 50 }, ctx);
    expect(q).toMatchObject({ buyAmount: "268011556", minBuyAmount: "266671498" });
    expect(q.approval).toEqual({ spender: CPMM, spenderName: "Sirius", amount: "100000" });
    const steps = await swap.build(q, ctx);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.title).toBe("Swap 0.001 tzBTC for ~268.011556 XTZ");
    expect(steps[0]!.lines).toContainEqual({ label: "Permission", value: "Sirius may use exactly 0.001 tzBTC, only in this swap" });
    const r = steps[0]!.request as DappRequest;
    const ops = await forgeAndParse(r, ctx);
    expect(ops.map((o) => [o.destination, o.amount, entry(o).entrypoint])).toEqual([
      [TZBTC, "0", "approve"],
      [TZBTC, "0", "approve"],
      [CPMM, "0", "tokenToXtz"],
    ]);
    expect(entry(ops[0]!).value).toEqual({ prim: "Pair", args: [{ string: CPMM }, { int: "0" }] });
    expect(entry(ops[1]!).value).toEqual({ prim: "Pair", args: [{ string: CPMM }, { int: "100000" }] });
    expect(entry(ops[2]!).value).toEqual({
      prim: "Pair",
      args: [{ string: TZ_ME }, { prim: "Pair", args: [{ int: "100000" }, { prim: "Pair", args: [{ int: "266671498" }, { int: String(NOW / 1000 + 600) }] }] }],
    });
    expect(steps[0]!.verify!(r)).toBe(true);
    const d = await decodeTitle(r, ctx);
    expect(d.blind).toBe(false);
    expect(d.lines.map((l) => l.value)).toContain("Let Sirius DEX spend up to 0.001 tzBTC");
  });

  it("refuses an exchange or token that isn't on the allow-list", async () => {
    const other = setup({ cpmm: "KT1XnTn74bUtxHfDtBmm2bGZAQfhPbvKWR8o" });
    await expect(other.swap.quote({ sell: XTZ, buy: tzBTC, amount: "1000000", slippageBps: 50 }, other.ctx)).rejects.toMatchObject({ code: "swap/unexpected-target" });
    const fake = setup({ token: "KT1XnTn74bUtxHfDtBmm2bGZAQfhPbvKWR8o" });
    await expect(fake.swap.quote({ sell: XTZ, buy: tzBTC, amount: "1000000", slippageBps: 50 }, fake.ctx)).rejects.toMatchObject({ code: "swap/unexpected-target" });
  });

  it("only XTZ ↔ tzBTC, sensible amounts, and mainnet", async () => {
    const { ctx, swap } = setup();
    await expect(swap.quote({ sell: XTZ, buy: USDT, amount: "1000000", slippageBps: 50 }, ctx)).rejects.toMatchObject({ code: "swap/no-route" });
    await expect(swap.quote({ sell: XTZ, buy: tzBTC, amount: "1", slippageBps: 50 }, ctx)).rejects.toMatchObject({ code: "swap/too-small" });
    await expect(swap.quote({ sell: XTZ, buy: tzBTC, amount: "400000000000000", slippageBps: 50 }, ctx)).rejects.toMatchObject({ code: "swap/too-large" });
    const test = { ...ctx, network: TEZOS_SHADOWNET };
    await expect(swap.quote({ sell: xtzAsset(TEZOS_SHADOWNET.id), buy: tzBTC, amount: "1000000", slippageBps: 50 }, test)).rejects.toMatchObject({ code: "swap/mainnet-only" });
  });

  it("verify rejects batches that send elsewhere or pay someone else", async () => {
    const { ctx, swap } = setup();
    const q = await swap.quote({ sell: tzBTC, buy: XTZ, amount: "100000", slippageBps: 50 }, ctx);
    const r = (await swap.build(q, ctx))[0]!.request as DappRequest;
    const a = { me: TZ_ME, cpmm: CPMM, token: TZBTC };
    const ops = (r.params as { operations: Record<string, unknown>[] }).operations;
    const tamper = (i: number, patch: Record<string, unknown>) => ({ ...r, params: { ...(r.params as object), operations: ops.map((o, j) => (j === i ? { ...o, ...patch } : o)) } });
    expect(verifySiriusRequest(r, a)).toBe(true);
    expect(verifySiriusRequest(tamper(2, { destination: "KT1XnTn74bUtxHfDtBmm2bGZAQfhPbvKWR8o" }), a)).toBe(false);
    expect(verifySiriusRequest(tamper(1, { parameters: { entrypoint: "approve", value: { prim: "Pair", args: [{ string: "tz1cJ9Bi4ygAYUvL31fmMCgK2GmWiTQ6ioGP" }, { int: "100000" }] } } }), a)).toBe(false);
    const payElsewhere = { entrypoint: "tokenToXtz", value: { prim: "Pair", args: [{ string: "tz1cJ9Bi4ygAYUvL31fmMCgK2GmWiTQ6ioGP" }, { prim: "Pair", args: [{ int: "1" }, { prim: "Pair", args: [{ int: "1" }, { int: "1" }] }] }] } };
    expect(verifySiriusRequest(tamper(2, { parameters: payElsewhere }), a)).toBe(false);
    expect(verifySiriusRequest(tamper(0, { kind: "delegation" }), a)).toBe(false);
  });

  it("refuses a quote whose data was changed", async () => {
    const { ctx, swap } = setup();
    const q = await swap.quote({ sell: XTZ, buy: tzBTC, amount: "10000000", slippageBps: 50 }, ctx);
    await expect(swap.build({ ...q, data: { cpmm: "KT1XnTn74bUtxHfDtBmm2bGZAQfhPbvKWR8o", token: TZBTC, direction: "xtz-to-token" } }, ctx)).rejects.toMatchObject({ code: "swap/unexpected-target" });
    await expect(swap.build({ ...q, data: { cpmm: CPMM, token: TZBTC, direction: "token-to-xtz" } }, ctx)).rejects.toMatchObject({ code: "swap/unexpected-target" });
  });
});
