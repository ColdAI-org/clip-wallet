import type { Account, AssetRef, ChainContext, DappRequest } from "@clip-wallet/core";
import { APTOS_DEVNET, APTOS_MAINNET, APTOS_TESTNET, type EntryAbi, bcsAddress, bcsAddressVector, bcsU64, createAptosModule, decodeEntryPayload, encodeEntryPayload } from "@clip-wallet/chains-aptos";
import { describe, expect, it } from "vitest";
import { HYPERION, HyperionSwap } from "../src/swap/hyperion.js";
import { mockFetch } from "./helpers.js";

const ME_APT = "0xeb663b681209e7087d681c5d3eed12aaa8e1915e7c87794542c3f96e94b3d3bf";
const ACCOUNT: Account = { id: "aptos:0", family: "aptos", index: 0, curve: "ed25519", derivationPath: "m/44'/637'/0'/0'/0'", publicKey: "a686f0309ab80312979606cfccc10ea2740147ae6888351488d11c46f08fbf60", address: ME_APT };

/** router_v3 entry ABIs from GET /v1/accounts/{router}/module/router_v3 (identical on mainnet and testnet, 2026-10-03). */
const META = "0x1::object::Object<0x1::fungible_asset::Metadata>";
const ROUTER_ABI: Record<"swap_batch" | "swap_batch_coin_entry", EntryAbi> = {
  swap_batch: { generic_type_params: [], params: ["&signer", "vector<address>", META, META, "u64", "u64", "address"] },
  swap_batch_coin_entry: { generic_type_params: [{ constraints: [] }], params: ["&signer", "vector<address>", META, META, "u64", "u64", "address"] },
};

const APT_FA = `0x${"a".padStart(64, "0")}`;
const USDC_FA = "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b";
// The two pools getSwapInfo returned for 1 APT → USDC on mainnet (2026-10-03).
const POOLS = ["0x18269b1090d668fbbc01902fa6a5ac6e75565d61860ddae636ac89741c883cbc", "0xd3894aca06d5f42b27c89e6f448114b3ed6a1ba07f992a58b2126c71dd83c127"];
const apt = (n: string): AssetRef => ({ key: "apt", symbol: "APT", name: "Aptos", decimals: 8, networkId: n });
const usdc = (n: string): AssetRef => ({ key: "usdc", symbol: "USDC", name: "USDC", decimals: 6, networkId: n, address: USDC_FA });
const MOON = "0x00000000000000000000000000000000000000000000000000000000000000b0::moon::MOON";
const MOON_FA = `0x${"bf".repeat(32)}`;
const moon = (n: string): AssetRef => ({ key: `aptos:${MOON}`, symbol: "MOON", name: "Moon", decimals: 6, networkId: n, address: MOON });

function hyperionFetch(info: unknown, opts: { poolOk?: (pool: string) => boolean } = {}) {
  return mockFetch([
    [/hyperion\.xyz\/base\/rate\/getSwapInfo/, info],
    [
      /\/v1\/accounts\/(0x[0-9a-f]+)\/resource\/(0x[0-9a-f]+)::pool_v3::LiquidityPoolV3$/,
      (u: string) => {
        const pool = /accounts\/(0x[0-9a-f]+)\//.exec(u)![1]!;
        return (opts.poolOk ?? (() => true))(pool) ? { type: "pool_v3::LiquidityPoolV3", data: {} } : undefined;
      },
    ],
    [
      /\/v1\/view$/,
      (_u: string, init?: RequestInit) => {
        const b = JSON.parse(String(init!.body)) as { function: string; type_arguments: string[] };
        expect(b.function).toBe("0x1::coin::paired_metadata");
        return b.type_arguments[0] === MOON ? [{ vec: [{ inner: MOON_FA }] }] : [{ vec: [] }];
      },
    ],
  ]);
}

const ctxWith = (f: typeof fetch, network = APTOS_MAINNET): ChainContext => ({ network, account: ACCOUNT, fetch: f });

function payloadOf(r: DappRequest, network: string) {
  expect(r).toMatchObject({ family: "aptos", networkId: network, method: "aptos:signAndSubmitTransaction", origin: "clip-wallet" });
  const input = (r.params as { inputs: { account: string; payload: { function: `${string}::${string}::${string}`; typeArguments: string[]; functionArguments: unknown[] } }[] }).inputs[0]!;
  expect(input.account).toBe(ME_APT);
  expect(createAptosModule().normalize(r, ME_APT)).toMatchObject({ kind: "build" });
  return input.payload;
}

describe("Hyperion swap", () => {
  it("works on Aptos mainnet and testnet only", () => {
    const p = new HyperionSwap();
    expect(p.availability(APTOS_MAINNET)).toBeNull();
    expect(p.availability(APTOS_TESTNET)).toBeNull();
    expect(p.availability(APTOS_DEVNET)).toEqual({ code: "swap/unsupported-network", message: "Swapping these tokens isn't available in this test version yet." });
  });

  it("quotes APT → USDC from getSwapInfo and checks every pool is Hyperion's", async () => {
    const m = hyperionFetch({ path: POOLS, amountOut: "806327", amountIn: "100000000", fee: "60000" });
    const q = await new HyperionSwap({ now: () => 1000 }).quote({ sell: apt("aptos:1"), buy: usdc("aptos:1"), amount: "100000000", slippageBps: 50 }, ctxWith(m.fetch));
    expect(q).toMatchObject({ provider: "Hyperion", buyAmount: "806327", minBuyAmount: "802295", route: ["Hyperion"], expiresAt: 31_000 });
    const quoteUrl = new URL(m.calls[0]!.url);
    expect(quoteUrl.origin + quoteUrl.pathname).toBe("https://api.hyperion.xyz/base/rate/getSwapInfo");
    expect(Object.fromEntries(quoteUrl.searchParams)).toEqual({ amount: "100000000", from: APT_FA, to: USDC_FA, safeMode: "false", flag: "in" });
    expect(m.calls.filter((c) => c.url.includes("LiquidityPoolV3")).map((c) => c.url)).toEqual(POOLS.map((p) => `https://api.mainnet.aptoslabs.com/v1/accounts/${p}/resource/${HYPERION.mainnet.router}::pool_v3::LiquidityPoolV3`));
  });

  it("builds router_v3::swap_batch(path, from, to, amount, min out, you), parsed back with the Aptos SDK", async () => {
    const m = hyperionFetch({ path: POOLS, amountOut: "806327", amountIn: "100000000" });
    const p = new HyperionSwap();
    const ctx = ctxWith(m.fetch);
    const q = await p.quote({ sell: apt("aptos:1"), buy: usdc("aptos:1"), amount: "100000000", slippageBps: 50 }, ctx);
    const [step] = await p.build(q, ctx);
    expect(step!.title).toBe("Swap APT for USDC");
    const payload = payloadOf(step!.request as DappRequest, "aptos:1");
    const d = decodeEntryPayload(encodeEntryPayload(payload, ROUTER_ABI.swap_batch));
    expect(d.function).toBe(`${HYPERION.mainnet.router}::router_v3::swap_batch`);
    expect(d.typeArguments).toEqual([]);
    expect(bcsAddressVector(d.args[0]!)).toEqual(POOLS);
    expect(bcsAddress(d.args[1]!)).toBe(APT_FA);
    expect(bcsAddress(d.args[2]!)).toBe(USDC_FA);
    expect(bcsU64(d.args[3]!)).toBe(100_000_000n);
    expect(bcsU64(d.args[4]!)).toBe(802_295n);
    expect(bcsAddress(d.args[5]!)).toBe(ME_APT);
  });

  it("sells a legacy coin with swap_batch_coin_entry<Coin> and its paired fungible asset (testnet deployment)", async () => {
    const m = hyperionFetch({ path: [POOLS[0]], amountOut: "5000", amountIn: "7000000" });
    const p = new HyperionSwap();
    const ctx = ctxWith(m.fetch, APTOS_TESTNET);
    const q = await p.quote({ sell: moon("aptos:2"), buy: apt("aptos:2"), amount: "7000000", slippageBps: 100 }, ctx);
    expect(new URL(m.calls.find((c) => c.url.includes("getSwapInfo"))!.url).host).toBe("api-testnet.hyperion.xyz");
    const payload = payloadOf((await p.build(q, ctx))[0]!.request as DappRequest, "aptos:2");
    const d = decodeEntryPayload(encodeEntryPayload(payload, ROUTER_ABI.swap_batch_coin_entry));
    expect(d.function).toBe(`${HYPERION.testnet.router}::router_v3::swap_batch_coin_entry`);
    expect(d.typeArguments).toEqual([MOON]);
    expect(bcsAddress(d.args[1]!)).toBe(MOON_FA);
    expect(bcsAddress(d.args[2]!)).toBe(APT_FA);
    expect(bcsU64(d.args[4]!)).toBe(4950n);
    expect(bcsAddress(d.args[5]!)).toBe(ME_APT);
  });

  it("refuses empty routes, odd routes and pools that aren't Hyperion's, in plain words", async () => {
    const req = { sell: apt("aptos:1"), buy: usdc("aptos:1"), amount: "100000000", slippageBps: 50 };
    await expect(new HyperionSwap().quote(req, ctxWith(hyperionFetch({ path: [], amountOut: "0", amountIn: "100000000" }).fetch))).rejects.toMatchObject({ code: "swap/no-route" });
    await expect(new HyperionSwap().quote(req, ctxWith(hyperionFetch({ path: POOLS, amountOut: "5", amountIn: "1" }).fetch))).rejects.toMatchObject({ code: "swap/hyperion-refused" });
    await expect(new HyperionSwap().quote(req, ctxWith(hyperionFetch({ path: ["not-an-address"], amountOut: "5" }).fetch))).rejects.toMatchObject({ code: "swap/hyperion-refused" });
    const fake = hyperionFetch({ path: POOLS, amountOut: "806327", amountIn: "100000000" }, { poolOk: (p) => p !== POOLS[1] });
    await expect(new HyperionSwap().quote(req, ctxWith(fake.fetch))).rejects.toMatchObject({ code: "swap/hyperion-refused" });
    const noPair = hyperionFetch({ path: POOLS, amountOut: "1" });
    await expect(
      new HyperionSwap().quote({ ...req, sell: { ...moon("aptos:1"), address: "0x00000000000000000000000000000000000000000000000000000000000000c0::x::X" } }, ctxWith(noPair.fetch)),
    ).rejects.toMatchObject({ code: "swap/no-route" });
  });
});
