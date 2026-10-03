import type { Account, AssetRef, ChainContext } from "@clip-wallet/core";
import { SUI_MAINNET, SUI_TESTNET, type TransactionData, inspectTransaction, normalizeSuiAddress, pureAddressOf } from "@clip-wallet/chains-sui";
import { afterEach, describe, expect, it } from "vitest";
import { AFTERMATH_PACKAGES, AftermathSwap, checkAftermathTrade } from "../src/swap/aftermath.js";
import { mockFetch } from "./helpers.js";
import { AFTERMATH_TX_KINDS, ME_SUI, SUI_PUBKEY, USDC_SUI } from "./sui-fixtures.js";

const ACCOUNT: Account = { id: "sui:0", family: "sui", index: 0, curve: "ed25519", derivationPath: "m/44'/784'/0'/0'/0'", publicKey: SUI_PUBKEY, address: ME_SUI };
const SUI_T = "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI";
const sui: AssetRef = { key: "sui", symbol: "SUI", name: "Sui", decimals: 9, networkId: "sui:mainnet" };
const usdc: AssetRef = { key: "usdc", symbol: "USDC", name: "USDC", decimals: 6, networkId: "sui:mainnet", address: USDC_SUI };
const NOW = 1_790_000_000_000;

function route(inType: string, inAmount: string, outType: string, outAmount: string, protocols = ["CetusDlmm", "Cetus"]) {
  return { routes: [{ paths: protocols.map((protocolName) => ({ protocolName })) }], coinIn: { type: inType, amount: `${inAmount}n` }, coinOut: { type: outType, amount: `${outAmount}n` }, spotPrice: 1 };
}

function aftermathFetch(r: unknown, txKind: string) {
  return mockFetch([
    [/aftermath\.finance\/api\/router\/trade-route$/, r],
    [/aftermath\.finance\/api\/router\/v1\/transactions\/trade$/, { txKind }],
  ]);
}

const ctxWith = (f: typeof fetch, network = SUI_MAINNET): ChainContext => ({ network, account: ACCOUNT, fetch: f });

/** Pure address bytes (base64) for tampering with a parsed transaction. */
const addrB64 = (a: string) => btoa(String.fromCharCode(...a.slice(2).match(/../g)!.map((h) => parseInt(h, 16))));
const clone = (d: TransactionData): TransactionData => structuredClone(d);

describe("Aftermath swap", () => {
  it("is mainnet-only, in plain words", () => {
    const p = new AftermathSwap();
    expect(p.availability(SUI_MAINNET)).toBeNull();
    expect(p.availability(SUI_TESTNET)).toEqual({ code: "swap/mainnet-only", message: "Swapping these tokens isn't available in this test version yet." });
  });

  it("quotes SUI → USDC with the on-chain floor read from the router call", async () => {
    const m = aftermathFetch(route(SUI_T, "1000000000", USDC_SUI, "1186655"), AFTERMATH_TX_KINDS.suiToUsdc);
    const q = await new AftermathSwap({ now: () => NOW }).quote({ sell: sui, buy: usdc, amount: "1000000000", slippageBps: 50 }, ctxWith(m.fetch));
    expect(q).toMatchObject({ provider: "Aftermath", sellAmount: "1000000000", buyAmount: "1186655", slippageBps: 50, route: ["CetusDlmm", "Cetus"], expiresAt: NOW + 30_000 });
    // 1186655 × (1 − 0.005), as end_router_tx enforces it.
    expect(q.minBuyAmount).toBe(((1186655n * (10n ** 18n - 5n * 10n ** 15n)) / 10n ** 18n).toString());
    const [routeCall, txCall] = m.calls;
    expect(JSON.parse(String(routeCall!.init!.body))).toEqual({ coinInType: SUI_T, coinOutType: USDC_SUI, coinInAmount: "1000000000n" });
    const body = JSON.parse(String(txCall!.init!.body));
    expect(body.walletAddress).toBe(ME_SUI);
    expect(body.slippage).toBe(0.005);
  });

  it("builds sui:signAndExecuteTransaction whose PTB (parsed with @mysten/sui) only pays you", async () => {
    const m = aftermathFetch(route(SUI_T, "1000000000", USDC_SUI, "1186655"), AFTERMATH_TX_KINDS.suiToUsdc);
    const p = new AftermathSwap({ now: () => NOW });
    const ctx = ctxWith(m.fetch);
    const q = await p.quote({ sell: sui, buy: usdc, amount: "1000000000", slippageBps: 50 }, ctx);
    const [step] = await p.build(q, ctx);
    expect(step!.title).toBe("Swap SUI for USDC");
    const req = step!.request as { method: string; family: string; networkId: string; params: { inputs: { account: string; transaction: string; chain: string }[] } };
    expect(req).toMatchObject({ method: "sui:signAndExecuteTransaction", family: "sui", networkId: "sui:mainnet" });
    const data = inspectTransaction(req.params.inputs[0]!.transaction);
    expect(normalizeSuiAddress(data.sender!)).toBe(ME_SUI);
    const transfers = data.commands.filter((c) => c.$kind === "TransferObjects");
    expect(transfers).toHaveLength(1);
    expect(pureAddressOf(data.inputs[(transfers[0]!.TransferObjects!.address as { Input: number }).Input])).toBe(ME_SUI);
    const pkgs = new Set(data.commands.filter((c) => c.$kind === "MoveCall").map((c) => normalizeSuiAddress(c.MoveCall!.package)));
    for (const pkg of pkgs) expect(pkg === normalizeSuiAddress("0x2") || AFTERMATH_PACKAGES.has(pkg)).toBe(true);
    const begin = data.commands.find((c) => c.MoveCall?.function.startsWith("begin_router_tx"))!.MoveCall!;
    expect([begin.module, begin.function]).toEqual(["router", "begin_router_tx_r1_w1_varied_in"]);
  });

  it("accepts USDC sold from your coins or from your address balance", async () => {
    for (const kind of [AFTERMATH_TX_KINDS.usdcToSuiCoins, AFTERMATH_TX_KINDS.usdcToSuiBalance]) {
      const m = aftermathFetch(route(USDC_SUI, "300000", SUI_T, "252326214", ["Bluefin", "Cetus"]), kind);
      const q = await new AftermathSwap().quote({ sell: usdc, buy: sui, amount: "300000", slippageBps: 100 }, ctxWith(m.fetch));
      expect(q.minBuyAmount).toBe(((252326214n * 99n) / 100n).toString());
    }
  });

  it("refuses when the transaction doesn't match what you asked", async () => {
    const data = inspectTransaction(AFTERMATH_TX_KINDS.suiToUsdc, true);
    const ok = { me: ME_SUI, sellType: SUI_T, sellAmount: 1_000_000_000n, expectedOut: 1_186_655n, slippageBps: 50 };
    expect(checkAftermathTrade(data, ok).packages.length).toBeGreaterThan(0);

    const refusal = { code: "swap/aftermath-refused" };
    expect(() => checkAftermathTrade(data, { ...ok, slippageBps: 30 })).toThrow(expect.objectContaining(refusal));
    expect(() => checkAftermathTrade(data, { ...ok, expectedOut: 1_186_656n })).toThrow(expect.objectContaining(refusal));
    expect(() => checkAftermathTrade(data, { ...ok, sellAmount: 999_999_999n })).toThrow(expect.objectContaining(refusal));
    expect(() => checkAftermathTrade(data, { ...ok, sellType: USDC_SUI })).toThrow(/spends SUI you aren't selling/);

    // Output sent to someone else.
    const stolen = clone(data);
    const t = stolen.commands.find((c) => c.$kind === "TransferObjects")!;
    (stolen.inputs[(t.TransferObjects!.address as { Input: number }).Input] as { Pure: { bytes: string } }).Pure.bytes = addrB64(`0x${"bb".repeat(32)}`);
    expect(() => checkAftermathTrade(stolen, ok)).toThrow(/sends coins to someone else/);

    // A non-plumbing framework call.
    const extra = clone(data);
    extra.commands.push({ $kind: "MoveCall", MoveCall: { package: "0x2", module: "transfer", function: "public_transfer", typeArguments: [], arguments: [] } } as never);
    expect(() => checkAftermathTrade(extra, ok)).toThrow(/0x2::transfer::public_transfer/);

    // Gas coin handed straight to a contract.
    const gas = clone(data);
    const call = gas.commands.find((c) => c.$kind === "MoveCall")!;
    call.MoveCall!.arguments = [{ $kind: "GasCoin", GasCoin: true } as never];
    expect(() => checkAftermathTrade(gas, ok)).toThrow(/hands your coins to a contract/);
  });

  it("refuses an address-balance withdrawal larger than the sale", () => {
    const data = inspectTransaction(AFTERMATH_TX_KINDS.usdcToSuiBalance, true);
    const ok = { me: ME_SUI, sellType: USDC_SUI, sellAmount: 300_000n, expectedOut: 252_326_214n, slippageBps: 100 };
    expect(() => checkAftermathTrade(data, ok)).not.toThrow();
    const more = clone(data);
    (more.inputs[0] as { FundsWithdrawal: { reservation: { MaxAmountU64: string } } }).FundsWithdrawal.reservation.MaxAmountU64 = "300001";
    expect(() => checkAftermathTrade(more, ok)).toThrow(/takes more than you're selling/);
  });

  describe("unknown packages", () => {
    const WRAPPER = normalizeSuiAddress("0xbb2f1bc0c032aa7237ead35cbdd42d49ee7b04e1269c37af1ca5ec8e099793cb");
    afterEach(() => void AFTERMATH_PACKAGES.add(WRAPPER));

    const gqlAnswer = (sender: string, linkTo: string) =>
      mockFetch([
        [
          /graphql/,
          (_u: string, init?: RequestInit) => {
            expect(JSON.parse(String(init!.body)).variables.id).toBe(WRAPPER);
            return { data: { object: { previousTransaction: { sender: { address: sender } }, asMovePackage: { linkage: [{ originalId: "0x2" }, { originalId: linkTo }], typeOrigins: [] } } } };
          },
        ],
      ]);

    it("accepts a package Aftermath's deployer published that links to the router", async () => {
      AFTERMATH_PACKAGES.delete(WRAPPER);
      const m = gqlAnswer("0x4b02b9b45f2a9597363fbaacb2fd6e7fb8ed9329bb6f716631b5717048908ace", "0xe5099fcd45747074d0ef5eabce07a9bd1c3b0c1862435bf2a09c3a81e0604373");
      expect(await new AftermathSwap().packageAllowed(WRAPPER, ctxWith(m.fetch))).toBe(true);
    });

    it("refuses the same package from anyone else, and a quote that uses it", async () => {
      AFTERMATH_PACKAGES.delete(WRAPPER);
      const other = gqlAnswer(`0x${"cc".repeat(32)}`, "0xe5099fcd45747074d0ef5eabce07a9bd1c3b0c1862435bf2a09c3a81e0604373");
      expect(await new AftermathSwap().packageAllowed(WRAPPER, ctxWith(other.fetch))).toBe(false);
      const unlinked = gqlAnswer("0x4b02b9b45f2a9597363fbaacb2fd6e7fb8ed9329bb6f716631b5717048908ace", "0x3");
      expect(await new AftermathSwap().packageAllowed(WRAPPER, ctxWith(unlinked.fetch))).toBe(false);
    });
  });

  it("says there's no route in plain words", async () => {
    const m = mockFetch([[/trade-route$/, "Error 2005: no route", 500]]);
    await expect(new AftermathSwap().quote({ sell: sui, buy: usdc, amount: "1", slippageBps: 50 }, ctxWith(m.fetch))).rejects.toMatchObject({ code: "swap/no-route" });
    const empty = mockFetch([[/trade-route$/, { routes: [], coinIn: { amount: "1n" }, coinOut: { amount: "0n" } }]]);
    await expect(new AftermathSwap().quote({ sell: sui, buy: usdc, amount: "1", slippageBps: 50 }, ctxWith(empty.fetch))).rejects.toMatchObject({ code: "swap/no-route" });
    await expect(new AftermathSwap().quote({ sell: sui, buy: usdc, amount: "1", slippageBps: 50 }, ctxWith(empty.fetch, SUI_TESTNET))).rejects.toMatchObject({ code: "swap/mainnet-only" });
  });
});

