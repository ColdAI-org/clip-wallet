import type { AssetRef, DappRequest } from "@clip-wallet/core";
import {
  DEFI_OP,
  cellFromBase64,
  createTonModule,
  opOf,
  parsePtonTransfer,
  parseSendTx,
  parseStonfiSwapPayload,
  rawTonAddress,
  sameTonAddress,
} from "@clip-wallet/chains-ton";
import { describe, expect, it } from "vitest";
import { refineDecoded, registerIntent } from "../src/steps.js";
import { STONFI_V2_ROUTERS, StonfiSwap, checkStonfiRequest } from "../src/swap/stonfi.js";
import { mockFetch } from "./helpers.js";
import { TON_MAIN, TON_TEST, rawOf, tonCtx, tonMe, walletData } from "./ton-fixtures.js";

const NOW_MS = 1_790_000_000_000;
const gram = (n = TON_MAIN.id): AssetRef => ({ key: "gram", symbol: "GRAM", name: "Gram", decimals: 9, networkId: n });
const USDT_RAW = "0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe";
const usdt = (n = TON_MAIN.id): AssetRef => ({ key: "usdt", symbol: "USD₮", name: "Tether USD", decimals: 6, networkId: n, address: USDT_RAW });
const NOT_RAW = rawOf(0x77);
const notcoin = (n = TON_MAIN.id): AssetRef => ({ key: `ton:${NOT_RAW}`, symbol: "NOT", name: "Notcoin", decimals: 9, networkId: n, address: NOT_RAW });

const [ROUTER, PTON_WALLET] = STONFI_V2_ROUTERS.find(([r]) => r === "EQCS4UEa5UaJLzOyyKieqQOQ2P9M-7kXpkO5HnP3Bv250cN3")!;
const ROUTER_USDT_WALLET = "EQCSLWJ9fY7b0A5OI72wxUp27l4fRlc6GvRBeFf6PiPpH4p3";
const ROUTER_NOT_WALLET = rawOf(0x78);

/** Shape of POST /v1/swap/simulate (a live GRAM → USD₮ answer on 2026-10-03, amounts adjusted). */
function simulate(o: Partial<Record<string, unknown>> = {}) {
  return {
    offer_address: "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c",
    ask_address: "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs",
    offer_jetton_wallet: PTON_WALLET,
    ask_jetton_wallet: ROUTER_USDT_WALLET,
    router_address: ROUTER,
    router: { address: ROUTER, major_version: 2, minor_version: 2, pton_master_address: "EQBnGWMCf3-FZZq1W4IWcWiGAc3PHuZ0_H-7sad2oY00o83S", pton_wallet_address: PTON_WALLET, pton_version: "2.1", router_type: "ConstantProduct" },
    pool_address: "EQD8TJ8xEWB1SpnRE4d89YO3jl0W0EiBnNS4IBaHaUmdfizE",
    offer_units: "10000000000",
    ask_units: "14921540",
    min_ask_units: "14772324",
    price_impact: "0.000513",
    ...o,
  };
}

const provider = () => new StonfiSwap({ now: () => NOW_MS });

describe("STON.fi (TON)", () => {
  it("is mainnet only, in plain words (the API serves mainnet data only)", () => {
    expect(provider().availability(TON_TEST)?.message).toBe("Swapping these tokens isn't available in this test version yet.");
    expect(provider().availability(TON_MAIN)).toBeNull();
  });

  it("quotes GRAM → USD₮ with dex_version=2, checks the router and its token wallet on-chain, computes min out itself", async () => {
    const { fetch, calls } = mockFetch([
      [/api\.ston\.fi\/v1\/swap\/simulate/, simulate()],
      [/get_wallet_data/, walletData(ROUTER, USDT_RAW)],
    ]);
    const q = await provider().quote({ sell: gram(), buy: usdt(), amount: "10000000000", slippageBps: 100 }, tonCtx(TON_MAIN, fetch));
    const u = new URL(calls[0]!.url);
    expect(calls[0]!.init?.method).toBe("POST");
    expect(u.searchParams.get("offer_address")).toBe("EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c");
    expect(rawTonAddress(u.searchParams.get("ask_address")!)).toBe(USDT_RAW);
    expect(u.searchParams.get("units")).toBe("10000000000");
    expect(u.searchParams.get("slippage_tolerance")).toBe("0.01");
    expect(u.searchParams.get("dex_version")).toBe("2");
    expect(calls[1]!.url).toContain(`/v2/blockchain/accounts/${rawTonAddress(ROUTER_USDT_WALLET)}/methods/get_wallet_data`);
    expect(q).toMatchObject({ buyAmount: "14921540", minBuyAmount: String((14921540n * 9900n) / 10000n), route: ["STON.fi"], expiresAt: NOW_MS + 30_000 });
    expect(q.priceImpactPct).toBeCloseTo(0.0513);
  });

  it("refuses a router that isn't on the allow-list", async () => {
    const evil = "EQD8TJ8xEWB1SpnRE4d89YO3jl0W0EiBnNS4IBaHaUmdfizE";
    const { fetch } = mockFetch([[/simulate/, simulate({ router_address: evil, router: { address: evil, major_version: 2, minor_version: 2 } })]]);
    await expect(provider().quote({ sell: gram(), buy: usdt(), amount: "10000000000", slippageBps: 50 }, tonCtx(TON_MAIN, fetch))).rejects.toMatchObject({ code: "swap/unexpected-target" });
  });

  it("refuses when the router's token wallet isn't really the router's", async () => {
    const { fetch } = mockFetch([
      [/simulate/, simulate()],
      [/get_wallet_data/, walletData(rawOf(0x66), USDT_RAW)],
    ]);
    await expect(provider().quote({ sell: gram(), buy: usdt(), amount: "10000000000", slippageBps: 50 }, tonCtx(TON_MAIN, fetch))).rejects.toMatchObject({ code: "swap/unexpected-target" });
  });

  it("refuses a GRAM offer routed through a different pTON wallet", async () => {
    const { fetch } = mockFetch([[/simulate/, simulate({ offer_jetton_wallet: STONFI_V2_ROUTERS[0]![1] })], [/get_wallet_data/, walletData(ROUTER, USDT_RAW)]]);
    await expect(provider().quote({ sell: gram(), buy: usdt(), amount: "10000000000", slippageBps: 50 }, tonCtx(TON_MAIN, fetch))).rejects.toMatchObject({ code: "swap/unexpected-target" });
  });

  it("no pool → plain no-route", async () => {
    const { fetch } = mockFetch([[/simulate/, { error: "no pool" }, 400]]);
    await expect(provider().quote({ sell: gram(), buy: usdt(), amount: "1", slippageBps: 50 }, tonCtx(TON_MAIN, fetch))).rejects.toMatchObject({ code: "swap/no-route" });
  });

  it("GRAM in: one message to the router's pTON wallet; BoC parsed back (op, amounts, min out, receiver, refund)", async () => {
    const { fetch } = mockFetch([[/simulate/, simulate()], [/get_wallet_data/, walletData(ROUTER, USDT_RAW)]]);
    const ctx = tonCtx(TON_MAIN, fetch);
    const p = provider();
    const q = await p.quote({ sell: gram(), buy: usdt(), amount: "10000000000", slippageBps: 100 }, ctx);
    const [step] = await p.build(q, ctx);
    expect(step!.title).toBe("Swap 10 GRAM for ~14.92154 USD₮");
    const r = step!.request as DappRequest;
    expect(r).toMatchObject({ family: "ton", method: "sendTransaction", networkId: TON_MAIN.id });
    const tx = parseSendTx(r.params);
    expect(tx.network).toBe("-239");
    expect(tx.from).toBe(tonMe(TON_MAIN));
    expect(tx.messages).toHaveLength(1);
    const m = tx.messages![0]!;
    expect(sameTonAddress(m.address, PTON_WALLET)).toBe(true);
    expect(m.address).toBe(PTON_WALLET); // friendly, bounceable (TON Connect refuses raw addresses)
    expect(BigInt(m.amount)).toBe(10_000_000_000n + 300_000_000n + 10_000_000n);
    const body = cellFromBase64(m.payload!);
    expect(opOf(body)).toBe(DEFI_OP.ptonTonTransfer);
    const t = parsePtonTransfer(body);
    expect(t.tonAmount).toBe(10_000_000_000n);
    expect(t.refund).toBe(tonMe(TON_MAIN));
    const s = parseStonfiSwapPayload(t.forwardPayload!);
    expect(s).toMatchObject({
      askJettonWallet: rawTonAddress(ROUTER_USDT_WALLET),
      receiver: tonMe(TON_MAIN),
      refund: tonMe(TON_MAIN),
      excesses: tonMe(TON_MAIN),
      minOut: BigInt(q.minBuyAmount),
      deadline: NOW_MS / 1000 + 20 * 60,
      referral: null,
      hasCustomPayloads: false,
    });
    expect(step!.verify!(r)).toBe(true);
  });

  it("token in: a TEP-74 items entry to the router with the swap as forward payload (jetton → jetton)", async () => {
    const { fetch } = mockFetch([
      [/simulate/, simulate({ offer_address: "x", ask_address: "y", offer_jetton_wallet: rawOf(0x79), ask_jetton_wallet: ROUTER_NOT_WALLET, offer_units: "5000000" })],
      [/get_wallet_data/, walletData(ROUTER, NOT_RAW)],
    ]);
    const ctx = tonCtx(TON_MAIN, fetch);
    const p = provider();
    const q = await p.quote({ sell: usdt(), buy: notcoin(), amount: "5000000", slippageBps: 50 }, ctx);
    const [step] = await p.build(q, ctx);
    const r = step!.request as DappRequest;
    const tx = parseSendTx(r.params);
    expect(tx.messages).toBeUndefined();
    const it0 = tx.items![0]! as Extract<NonNullable<typeof tx.items>[number], { type: "jetton" }>;
    expect(it0).toMatchObject({ type: "jetton", master: USDT_RAW, amount: "5000000", attachAmount: "300000000", forwardAmount: "240000000", responseDestination: tonMe(TON_MAIN) });
    expect(sameTonAddress(it0.destination, ROUTER)).toBe(true);
    const s = parseStonfiSwapPayload(cellFromBase64(it0.forwardPayload!));
    expect(s.askJettonWallet).toBe(ROUTER_NOT_WALLET);
    expect(s.receiver).toBe(tonMe(TON_MAIN));
    expect(s.minOut).toBe(BigInt(q.minBuyAmount));
    expect(step!.verify!(r)).toBe(true);
  });

  it("token → GRAM: the ask wallet must be the router's own pTON wallet", async () => {
    const { fetch } = mockFetch([[/simulate/, simulate({ offer_jetton_wallet: rawOf(0x79), ask_jetton_wallet: PTON_WALLET, offer_units: "5000000", ask_units: "3300000000" })]]);
    const q = await provider().quote({ sell: usdt(), buy: gram(), amount: "5000000", slippageBps: 50 }, tonCtx(TON_MAIN, fetch));
    expect(q.buyAmount).toBe("3300000000");
    const bad = mockFetch([[/simulate/, simulate({ offer_jetton_wallet: rawOf(0x79), ask_jetton_wallet: rawOf(0x55), offer_units: "5000000" })]]);
    await expect(provider().quote({ sell: usdt(), buy: gram(), amount: "5000000", slippageBps: 50 }, tonCtx(TON_MAIN, bad.fetch))).rejects.toMatchObject({ code: "swap/unexpected-target" });
  });

  it("verify refuses tampered requests (receiver, min out, amount, destination)", async () => {
    const { fetch } = mockFetch([[/simulate/, simulate()], [/get_wallet_data/, walletData(ROUTER, USDT_RAW)]]);
    const ctx = tonCtx(TON_MAIN, fetch);
    const p = provider();
    const q = await p.quote({ sell: gram(), buy: usdt(), amount: "10000000000", slippageBps: 100 }, ctx);
    const [step] = await p.build(q, ctx);
    const r = step!.request as DappRequest;
    const base = { me: tonMe(TON_MAIN), kind: "gram-in" as const, router: rawTonAddress(ROUTER), ptonWallet: rawTonAddress(PTON_WALLET), askJettonWallet: rawTonAddress(ROUTER_USDT_WALLET), sellAmount: 10_000_000_000n, minOut: BigInt(q.minBuyAmount) };
    expect(checkStonfiRequest(r, base)).toBe(true);
    expect(checkStonfiRequest(r, { ...base, me: rawOf(0x01) })).toBe(false);
    expect(checkStonfiRequest(r, { ...base, minOut: BigInt(q.minBuyAmount) + 1n })).toBe(false);
    expect(checkStonfiRequest(r, { ...base, sellAmount: 1n })).toBe(false);
    const moved = { ...r, params: { ...(r.params as object), messages: [{ ...(r.params as { messages: object[] }).messages[0], address: STONFI_V2_ROUTERS[0]![1] }] } };
    expect(checkStonfiRequest(moved as DappRequest, base)).toBe(false);
  });

  it("the TON chain module accepts the built request; verify + a clean emulation lift the blind pTON message", async () => {
    const me = tonMe(TON_MAIN);
    const { fetch: qf } = mockFetch([[/simulate/, simulate()], [/get_wallet_data/, walletData(ROUTER, USDT_RAW)]]);
    const p = provider();
    const q = await p.quote({ sell: gram(), buy: usdt(), amount: "10000000000", slippageBps: 100 }, tonCtx(TON_MAIN, qf));
    const [step] = await p.build(q, tonCtx(TON_MAIN, qf));
    const request = step!.request as DappRequest;
    const { fetch } = mockFetch([
      [/\/v3\/walletInformation/, { balance: "20000000000", status: "active", seqno: 4 }],
      [/\/events\/emulate/, { actions: [{ TonTransfer: { sender: { address: me }, recipient: { address: rawTonAddress(PTON_WALLET) }, amount: "10310000000" } }], extra: -12_000_000 }],
    ]);
    const mod = createTonModule({ minIntervalMs: 0, now: () => NOW_MS / 1000 });
    const decoded = await mod.decode(request, tonCtx(TON_MAIN, fetch));
    expect(decoded.blind).toBe(true); // pTON op isn't a standard the module reads
    expect(decoded.simulated).toBe(true);
    registerIntent(request, { title: step!.title, lines: step!.lines ?? [], verify: step!.verify });
    const refined = refineDecoded(request, decoded);
    expect(refined.blind).toBe(false);
    expect(refined.title).toBe("Swap 10 GRAM for ~14.92154 USD₮");
  });

  it("the module builds the jetton transfer from the items entry exactly as STON.fi's SDK lays it out", async () => {
    const me = tonMe(TON_MAIN);
    const MY_USDT_WALLET = rawOf(0x22);
    const { fetch: qf } = mockFetch([
      [/simulate/, simulate({ offer_jetton_wallet: rawOf(0x79), ask_jetton_wallet: ROUTER_NOT_WALLET, offer_units: "5000000" })],
      [/get_wallet_data/, walletData(ROUTER, NOT_RAW)],
    ]);
    const p = provider();
    const q = await p.quote({ sell: usdt(), buy: notcoin(), amount: "5000000", slippageBps: 50 }, tonCtx(TON_MAIN, qf));
    const [step] = await p.build(q, tonCtx(TON_MAIN, qf));
    let emulated: string | undefined;
    const { fetch } = mockFetch([
      [/\/v3\/walletInformation/, { balance: "20000000000", status: "active", seqno: 4 }],
      [/\/v2\/accounts\/[^/]+\/jettons\/[^/?]+/, { balance: "9000000", wallet_address: { address: MY_USDT_WALLET }, jetton: { address: USDT_RAW, name: "Tether USD", symbol: "USD₮", decimals: 6 } }],
      [/get_wallet_data/, walletData(me, USDT_RAW)],
      [/\/v2\/jettons\//, { metadata: { address: USDT_RAW, name: "Tether USD", symbol: "USD₮", decimals: "6" }, verification: "whitelist" }],
      [/\/events\/emulate/, (_u: string, init?: RequestInit) => {
        emulated = (JSON.parse(String(init?.body)) as { boc: string }).boc;
        return { actions: [], extra: -1 };
      }],
    ]);
    const mod = createTonModule({ minIntervalMs: 0, now: () => NOW_MS / 1000 });
    const decoded = await mod.decode(step!.request as DappRequest, tonCtx(TON_MAIN, fetch));
    expect(decoded.blind).toBe(false);
    expect(decoded.lines.find((l) => l.label === "Amount")?.value).toBe("5 USD₮");
    expect(emulated).toBeTruthy();
    // The module resolved YOUR token wallet and sends the TEP-74 transfer to the router.
    expect(sameTonAddress(decoded.lines.find((l) => l.label === "To")!.value, ROUTER)).toBe(true);
    expect(decoded.lines.find((l) => l.label === "Covers token fees")?.value).toBe("0.3 GRAM (unused part comes back)");
    expect(decoded.lines.find((l) => l.label === "Also forwards")?.value).toBe("0.24 GRAM");
  });
});
