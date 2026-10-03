import type { Account, AssetRef, ChainContext, DappRequest, Network } from "@clip-wallet/core";
import {
  AVNU_EXCHANGE,
  ETH_ADDRESS,
  STARKNET_MAINNET,
  STARKNET_SEPOLIA,
  STRK_ADDRESS,
  describeCalls,
  normalizeCalls,
  parseApprove,
  parseMultiRouteSwap,
  type StarknetRpc,
} from "@clip-wallet/chains-starknet";
import { describe, expect, it } from "vitest";
import { AvnuSwap, checkAvnuRequest } from "../src/swap/avnu.js";
import { mockFetch } from "./helpers.js";

/** A public address label (no key). */
const ME = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd";
const MAIN: Network = { ...STARKNET_MAINNET, rpcUrls: ["https://starknet.rpc.test"] };
const SEP: Network = { ...STARKNET_SEPOLIA, rpcUrls: ["https://sepolia.rpc.test"] };
const account: Account = { id: "starknet:0", family: "starknet", index: 0, curve: "stark", derivationPath: "m/44'/9004'/0'/0/0", publicKey: "0x1", address: ME };
const ctx = (f: typeof fetch, network = MAIN): ChainContext => ({ network, account, fetch: f });
const strk = (n = MAIN.id): AssetRef => ({ key: "strk", symbol: "STRK", name: "Starknet Token", decimals: 18, networkId: n });
const eth = (n = MAIN.id): AssetRef => ({ key: "eth", symbol: "ETH", name: "Ether", decimals: 18, networkId: n, address: ETH_ADDRESS });

const NOW = 1_790_000_000_000;
const QUOTE = {
  quoteId: "197f4a1e-3ee8-46c4-a34a-27f81daf232b",
  sellTokenAddress: "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  sellAmount: "0xde0b6b3a7640000",
  buyTokenAddress: "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  buyAmount: "0xf0073b84dcd",
  chainId: "0x534e5f4d41494e",
  routes: [{ name: "Ekubo", percent: 1 }],
};

/** POST /swap/v3/build (live mainnet answer on 2026-10-03, taker swapped for ME). */
function buildAnswer(o: { contract?: string; beneficiary?: string; min?: string; feeBps?: string; sellAmount?: string; extraCall?: boolean } = {}) {
  const calldata = [
    "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    o.sellAmount ?? "0xde0b6b3a7640000",
    "0x0",
    "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    "0xf0073b84dcd",
    "0x0",
    o.min ?? "0xeed3ff0fb7d",
    "0x0",
    o.beneficiary ?? ME,
    o.feeBps ?? "0x0",
    "0x0",
    "0x1",
    "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    "0x5dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b",
    "0xe8d4a51000",
    "0x6",
    "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    "0x20c49ba5e353f80000000000000000",
    "0x56a4c",
    "0x43e4f09c32d13d43a880e85f69f7de93ceda62d6cf2581a582c6db635548fdc",
    "0x9baa764f7ff38000000000000000000",
  ];
  const calls = [{ contractAddress: o.contract ?? "0x4270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f", entrypoint: "multi_route_swap", calldata }];
  if (o.extraCall) calls.push({ contractAddress: STRK_ADDRESS, entrypoint: "transfer", calldata: [ME, "0x1", "0x0"] });
  return { chainId: "0x534e5f4d41494e", calls, executorAddress: null };
}

const avnu = () => new AvnuSwap({ now: () => NOW });
const ONE = "1000000000000000000";

async function quoteAndBuild(build: unknown, slippageBps = 50) {
  const { fetch, calls } = mockFetch([
    [/\/swap\/v3\/quotes/, [QUOTE]],
    [/\/swap\/v3\/build/, build],
  ]);
  const p = avnu();
  const q = await p.quote({ sell: strk(), buy: eth(), amount: ONE, slippageBps }, ctx(fetch));
  return { p, q, calls, steps: () => p.build(q, ctx(fetch)) };
}

describe("AVNU (Starknet)", () => {
  it("mainnet on; Sepolia off by default (its API has no liquidity sources), opt-in with sepolia: true", () => {
    expect(avnu().availability(MAIN)).toBeNull();
    expect(avnu().availability(SEP)?.message).toBe("Swapping these tokens isn't available in this test version yet.");
    expect(new AvnuSwap({ sepolia: true }).availability(SEP)).toBeNull();
  });

  it("quotes from /swap/v3/quotes with a hex sell amount and the taker; min out computed by the wallet", async () => {
    const { q, calls } = await quoteAndBuild(buildAnswer());
    const u = new URL(calls[0]!.url);
    expect(u.origin + u.pathname).toBe("https://starknet.api.avnu.fi/swap/v3/quotes");
    expect(u.searchParams.get("sellTokenAddress")).toBe(STRK_ADDRESS);
    expect(u.searchParams.get("buyTokenAddress")).toBe(ETH_ADDRESS);
    expect(u.searchParams.get("sellAmount")).toBe("0xde0b6b3a7640000");
    expect(u.searchParams.get("takerAddress")).toBe(ME);
    expect(q).toMatchObject({
      buyAmount: BigInt("0xf0073b84dcd").toString(),
      minBuyAmount: ((BigInt("0xf0073b84dcd") * 9950n) / 10000n).toString(),
      route: ["Ekubo"],
      approval: { spender: AVNU_EXCHANGE.SN_MAIN, spenderName: "AVNU", amount: ONE },
      expiresAt: NOW + 30_000,
    });
  });

  it("no quotes → plain no-route", async () => {
    const { fetch } = mockFetch([[/quotes/, []]]);
    await expect(avnu().quote({ sell: strk(), buy: eth(), amount: ONE, slippageBps: 50 }, ctx(fetch))).rejects.toMatchObject({ code: "swap/no-route" });
  });

  it("builds one multicall: exact approve to the Exchange, then AVNU's swap; calldata parsed back", async () => {
    const { q, calls, steps } = await quoteAndBuild(buildAnswer());
    const [step] = await steps();
    const body = JSON.parse(String(calls[1]!.init?.body));
    expect(body).toEqual({ quoteId: QUOTE.quoteId, takerAddress: ME, slippage: 0.005, includeApprove: false });
    const r = step!.request as DappRequest;
    expect(r).toMatchObject({ family: "starknet", method: "wallet_addInvokeTransaction", networkId: MAIN.id });
    const norm = normalizeCalls(r.params); // what the chain module reads
    expect(norm.map((c) => c.entrypoint)).toEqual(["approve", "multi_route_swap"]);
    expect(BigInt(norm[0]!.contractAddress)).toBe(BigInt(STRK_ADDRESS));
    expect(parseApprove(norm[0]!.calldata)).toEqual({ spender: AVNU_EXCHANGE.SN_MAIN, amount: 10n ** 18n });
    expect(BigInt(norm[1]!.contractAddress)).toBe(BigInt(AVNU_EXCHANGE.SN_MAIN));
    const s = parseMultiRouteSwap(norm[1]!.calldata);
    expect(BigInt(s.sellToken)).toBe(BigInt(STRK_ADDRESS));
    expect(s.sellAmount).toBe(10n ** 18n);
    expect(BigInt(s.buyToken)).toBe(BigInt(ETH_ADDRESS));
    expect(BigInt(s.beneficiary)).toBe(BigInt(ME));
    expect(s.buyMinAmount).toBeGreaterThanOrEqual(BigInt(q.minBuyAmount));
    expect(s.integratorFeeBps).toBe(0n);
    expect(step!.title).toBe("Swap 1 STRK for ~0.000016 ETH");
    expect(step!.lines).toContainEqual({ label: "Allows AVNU to use", value: "Exactly 1 STRK, for this swap only" });
    expect(step!.verify!(r)).toBe(true);
  });

  it("the chain module's description shows the approve as exactly 1 STRK (not unlimited)", async () => {
    const { steps } = await quoteAndBuild(buildAnswer());
    const [step] = await steps();
    const rpc = { call: async () => { throw new Error("no rpc needed for curated tokens"); } } as unknown as StarknetRpc;
    const d = await describeCalls(normalizeCalls((step!.request as DappRequest).params), { me: ME, host: "Clip Wallet", networkId: MAIN.id, rpc });
    expect(d.blind).toBe(false);
    expect(d.lines).toContainEqual({ label: "Spending limit", value: "1 STRK" });
    expect(d.warnings.some((w) => w.level === "danger")).toBe(false);
  });

  it.each([
    ["a contract that isn't AVNU's Exchange", { contract: "0x0666" }],
    ["a different beneficiary", { beneficiary: "0x0bad" }],
    ["a minimum output below the slippage limit", { min: "0x1" }],
    ["an integrator fee", { feeBps: "0x64" }],
    ["a different sell amount", { sellAmount: "0xde0b6b3a7640001" }],
    ["an extra call", { extraCall: true }],
  ])("refuses AVNU's answer with %s", async (_label, o) => {
    const { steps } = await quoteAndBuild(buildAnswer(o));
    await expect(steps()).rejects.toMatchObject({ code: "swap/unexpected-target" });
  });

  it("verify refuses a tampered approve (unlimited or wrong spender)", async () => {
    const { q, steps } = await quoteAndBuild(buildAnswer());
    const [step] = await steps();
    const r = step!.request as DappRequest;
    const e = { me: ME, exchange: AVNU_EXCHANGE.SN_MAIN, sellToken: STRK_ADDRESS, buyToken: ETH_ADDRESS, sellAmount: 10n ** 18n, minOut: BigInt(q.minBuyAmount) };
    expect(checkAvnuRequest(r, e)).toBe(true);
    const calls = (r.params as { calls: { calldata: string[] }[] }).calls;
    const unlimited = { ...r, params: { calls: [{ ...calls[0], calldata: [AVNU_EXCHANGE.SN_MAIN, "0xffffffffffffffffffffffffffffffff", "0xffffffffffffffffffffffffffffffff"] }, calls[1]] } };
    expect(checkAvnuRequest(unlimited as DappRequest, e)).toBe(false);
    const spender = { ...r, params: { calls: [{ ...calls[0], calldata: ["0x0bad", "0xde0b6b3a7640000", "0x0"] }, calls[1]] } };
    expect(checkAvnuRequest(spender as DappRequest, e)).toBe(false);
  });

  it("uses the Sepolia host and Exchange when switched on", async () => {
    const { fetch, calls } = mockFetch([[/quotes/, [QUOTE]]]);
    const q = await new AvnuSwap({ sepolia: true }).quote({ sell: strk(SEP.id), buy: eth(SEP.id), amount: ONE, slippageBps: 50 }, ctx(fetch, SEP));
    expect(calls[0]!.url.startsWith("https://sepolia.api.avnu.fi/swap/v3/quotes")).toBe(true);
    expect(q.approval?.spender).toBe(AVNU_EXCHANGE.SN_SEPOLIA);
  });
});
