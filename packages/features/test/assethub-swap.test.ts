import type { AssetRef } from "@clip-wallet/core";
import { POLKADOT_ASSET_HUB, WESTEND, WESTEND_ASSET_HUB, Enum, createSubstrateModule, locationAsset } from "@clip-wallet/chains-substrate";
import { describe, expect, it } from "vitest";
import { AssetHubSwap } from "../src/swap/assethub.js";
import { SwapService } from "../src/swap/service.js";
import { HEDERA_TESTNET } from "@clip-wallet/chains-hedera";
import { fakeHost, flush } from "./helpers.js";
import { ME, WND, callOf, ctxFor, enc, mockRpc, seed, systemAccount } from "./polkadot-fixtures.js";

const NET = WESTEND_ASSET_HUB.id;
const wnd = WESTEND_ASSET_HUB.nativeAsset;
const tusd: AssetRef = { key: "asset:1337", symbol: "TUSD", name: "Test Dollar", decimals: 6, networkId: NET, address: "1337" };
const teur: AssetRef = { key: "asset:1984", symbol: "TEUR", name: "Test Euro", decimals: 6, networkId: NET, address: "1984" };

/** Pools: WND/TUSD (1 WND ≈ 4 TUSD) and WND/TEUR (1 WND ≈ 3.6 TEUR); reserves give the spot price. */
const RESERVES: Record<string, [bigint, bigint]> = {
  "native>1337": [WND(10_000), 40_000_000_000n],
  "1337>native": [40_000_000_000n, WND(10_000)],
  "native>1984": [WND(10_000), 36_000_000_000n],
  "1984>native": [36_000_000_000n, WND(10_000)],
};
const ida = (l: unknown) => String(locationAsset(l));
/** x·y=k with a 0.3 % fee, like the pallet's get_amount_out. */
function amountOut(amountIn: bigint, [rIn, rOut]: [bigint, bigint]): bigint {
  const withFee = amountIn * 997n;
  return (withFee * rOut) / (rIn * 1000n + withFee);
}

function world(over: { free?: bigint; tusd?: bigint | null; teur?: bigint | null; noPool?: boolean } = {}) {
  seed();
  const assetDetails = (min: bigint) => ({
    owner: ME,
    issuer: ME,
    admin: ME,
    freezer: ME,
    supply: 10n ** 15n,
    deposit: 0n,
    min_balance: min,
    is_sufficient: true,
    accounts: 1,
    sufficients: 1,
    approvals: 0,
    status: Enum("Live"),
  });
  const assetAccount = (balance: bigint) => ({ balance, status: Enum("Liquid"), reason: Enum("Sufficient"), extra: undefined });
  const storage: Record<string, string> = {
    [enc.key("System", "Account", ME)]: enc.value("System", "Account", systemAccount(over.free ?? WND(100))),
    [enc.key("Assets", "Asset", 1337)]: enc.value("Assets", "Asset", assetDetails(10_000n)),
    [enc.key("Assets", "Asset", 1984)]: enc.value("Assets", "Asset", assetDetails(70_000n)),
    [enc.key("Assets", "Metadata", 1337)]: enc.value("Assets", "Metadata", { deposit: 0n, name: new TextEncoder().encode("Test Dollar"), symbol: new TextEncoder().encode("TUSD"), decimals: 6, is_frozen: false }),
  };
  if (over.tusd !== null) storage[enc.key("Assets", "Account", 1337, ME)] = enc.value("Assets", "Account", assetAccount(over.tusd ?? 50_000_000n));
  if (over.teur != null) storage[enc.key("Assets", "Account", 1984, ME)] = enc.value("Assets", "Account", assetAccount(over.teur));
  const quotes: string[] = [];
  const rpc = mockRpc(storage, {
    AssetConversionApi_quote_price_exact_tokens_for_tokens: ([a, b, amount, includeFee]) => {
      const k = `${ida(a)}>${ida(b)}`;
      quotes.push(`${k}:${String(amount)}:${String(includeFee)}`);
      const r = over.noPool ? undefined : RESERVES[k];
      return enc.api("AssetConversionApi", "quote_price_exact_tokens_for_tokens", r ? amountOut(amount as bigint, r) : undefined);
    },
    AssetConversionApi_get_reserves: ([a, b]) => enc.api("AssetConversionApi", "get_reserves", RESERVES[`${ida(a)}>${ida(b)}`]),
    TransactionPaymentApi_query_info: enc.api("TransactionPaymentApi", "query_info", { weight: { ref_time: 1n, proof_size: 1n }, class: Enum("Normal"), partial_fee: 15_000_000_000n }),
  });
  return { ctx: ctxFor(rpc.fetch), rpc, quotes };
}

describe("Asset Hub swaps (AssetConversion)", () => {
  it("is available on Asset Hubs only", () => {
    const s = new AssetHubSwap();
    expect(s.availability(WESTEND_ASSET_HUB)).toBeNull();
    expect(s.availability(POLKADOT_ASSET_HUB)).toBeNull();
    expect(s.availability(WESTEND)).toMatchObject({ code: "swap/unsupported", message: "Swapping these tokens isn't available in this test version yet." });
    expect(s.availability(HEDERA_TESTNET)).toMatchObject({ code: "swap/wrong-family" });
  });

  it("quotes WND → token on-chain with the fee included, slippage floor and price impact", async () => {
    const { ctx, quotes } = world();
    const q = await new AssetHubSwap().quote({ sell: wnd, buy: tusd, amount: WND(10).toString(), slippageBps: 50 }, ctx);
    const expected = amountOut(WND(10), RESERVES["native>1337"]!);
    expect(quotes).toEqual([`native>1337:${WND(10)}:true`]);
    expect(q).toMatchObject({
      providerId: "assethub",
      provider: "Asset Hub",
      networkId: NET,
      sellAmount: WND(10).toString(),
      buyAmount: expected.toString(),
      minBuyAmount: ((expected * 9950n) / 10000n).toString(),
      slippageBps: 50,
      route: ["Asset Hub pool"],
      data: { path: ["native", 1337], keepAlive: true },
    });
    expect(q.approval).toBeUndefined();
    expect(q.priceImpactPct).toBeGreaterThan(0.3);
    expect(q.priceImpactPct).toBeLessThan(0.5); // 0.3 % fee + 0.1 % of the pool
    expect(q.expiresAt - Date.now()).toBeLessThanOrEqual(30_000);
  });

  it("routes token → token through WND, hop by hop", async () => {
    const { ctx, quotes } = world();
    const q = await new AssetHubSwap().quote({ sell: tusd, buy: teur, amount: "8000000", slippageBps: 100 }, ctx);
    const mid = amountOut(8_000_000n, RESERVES["1337>native"]!);
    const out = amountOut(mid, RESERVES["native>1984"]!);
    expect(quotes).toEqual([`1337>native:8000000:true`, `native>1984:${mid}:true`]);
    expect(q.buyAmount).toBe(out.toString());
    expect(q.route).toEqual(["Asset Hub pools (via WND)"]);
    expect(q.data).toEqual({ path: [1337, "native", 1984], keepAlive: true });
  });

  it("refuses plainly: no pool, balances, minimums", async () => {
    const s = new AssetHubSwap();
    await expect(s.quote({ sell: wnd, buy: tusd, amount: WND(1).toString(), slippageBps: 50 }, world({ noPool: true }).ctx)).rejects.toMatchObject({
      code: "swap/no-route",
      userMessage: "There's no way to swap WND for TUSD right now. Try a smaller amount or another token.",
    });
    await expect(s.quote({ sell: wnd, buy: tusd, amount: WND(99.995).toString(), slippageBps: 50 }, world().ctx)).rejects.toMatchObject({ code: "swap/insufficient" });
    await expect(s.quote({ sell: tusd, buy: wnd, amount: "49995000", slippageBps: 50 }, world().ctx)).rejects.toMatchObject({ code: "swap/below-minimum" });
    // Buying TEUR you don't hold yet: the floor must reach its 0.07 minimum balance.
    await expect(s.quote({ sell: wnd, buy: teur, amount: WND(0.01).toString(), slippageBps: 50 }, world().ctx)).rejects.toMatchObject({ code: "swap/below-minimum" });
    await expect(s.quote({ sell: wnd, buy: wnd, amount: "1", slippageBps: 50 }, world().ctx)).rejects.toMatchObject({ code: "swap/same-token" });
  });

  it("sells a whole token balance with keep_alive off", async () => {
    const { ctx } = world({ tusd: 8_000_000n });
    const q = await new AssetHubSwap().quote({ sell: tusd, buy: wnd, amount: "8000000", slippageBps: 50 }, ctx);
    expect(q.data).toEqual({ path: [1337, "native"], keepAlive: false });
  });

  it("builds swap_exact_tokens_for_tokens to you with the on-chain minimum, decoded back with the metadata", async () => {
    const { ctx } = world();
    const m = createSubstrateModule();
    const s = new AssetHubSwap({ module: m });
    const q = await s.quote({ sell: wnd, buy: tusd, amount: WND(10).toString(), slippageBps: 50 }, ctx);
    const steps = await s.build(q, ctx);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.title).toBe(`Swap 10 WND for ~${(Number(q.buyAmount) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 })} TUSD`);
    const r = await (steps[0]!.request as () => Promise<never>)();
    expect(r).toMatchObject({ method: "substrate_signAndSubmit", family: "substrate", networkId: NET, origin: "clip-wallet" });
    const c = callOf(r);
    expect([c.pallet, c.call]).toEqual(["AssetConversion", "swap_exact_tokens_for_tokens"]);
    expect((c.args.path as unknown[]).map(locationAsset)).toEqual(["native", 1337]);
    expect(c.args.path).toEqual([
      { parents: 1, interior: { type: "Here", value: undefined } },
      { parents: 0, interior: { type: "X2", value: [{ type: "PalletInstance", value: 50 }, { type: "GeneralIndex", value: 1337n }] } },
    ]);
    expect(c.args.amount_in).toBe(WND(10));
    expect(c.args.amount_out_min).toBe(BigInt(q.minBuyAmount));
    expect(c.args.send_to).toBe(ME);
    expect(c.args.keep_alive).toBe(true);

    const d = await m.decode(r, ctx);
    expect(d.blind).toBe(false);
    expect(d.title).toMatch(/^Swap 10 WND for at least [\d.]+ TUSD$/);
    expect(d.warnings).toEqual([]);
  });

  it("swaps by asset through SwapService (\"Swap 10 WND for TUSD\")", async () => {
    const { ctx, rpc } = world();
    const base = fakeHost({ networks: [WESTEND_ASSET_HUB], assets: [wnd, tusd], fetch: rpc.fetch, balances: [{ asset: wnd, amount: WND(100).toString() }] });
    const host = { ...base, ctx: async () => ctx };
    const svc = new SwapService(host, [new AssetHubSwap()]);
    const view = await svc.quote({ sell: "wnd", buy: "asset:1337", amount: "10" });
    expect(view.youGet).toMatch(/^You get ~[\d.]+ TUSD$/);
    expect(view.route).toBe("Via Asset Hub pool");
    expect(view.steps).toEqual(["Swap"]);
    const queued = await svc.execute(view.id);
    expect(queued.steps).toHaveLength(1);
    await flush();
    expect(callOf(base.enqueued[0]!.request).call).toBe("swap_exact_tokens_for_tokens");
  });
});
