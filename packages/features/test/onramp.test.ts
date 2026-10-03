import { HEDERA_TESTNET } from "@clip-wallet/chains-hedera";
import { describe, expect, it } from "vitest";
import { BanxaOnRamp, C14OnRamp, MoonPayOnRamp } from "../src/onramp/providers.js";
import { OnRampService } from "../src/onramp/service.js";
import { BASE_MAINNET, DEVNET, SOL_MAIN, ME_SOL, fakeHost, hbar, mockFetch, sol, usdcEvm, usdcHedera, usdcSol } from "./helpers.js";

describe("on-ramp widget URLs", () => {
  it("Banxa referral checkout: case-sensitive params, sandbox domain on test builds", async () => {
    const url = new URL(await new BanxaOnRamp({ partner: "clipwallet" }).buildUrl({ assetKey: "sol", chain: "solana", address: ME_SOL, fiatAmount: 50, fiatCurrency: "usd", sandbox: true }));
    expect(url.origin).toBe("https://clipwallet.banxa-sandbox.com");
    expect(Object.fromEntries(url.searchParams)).toEqual({ coinType: "SOL", blockchain: "SOL", fiatType: "USD", fiatAmount: "50", walletAddress: ME_SOL });
    expect(new BanxaOnRamp({ partner: "clipwallet" }).supports("usdc", "hedera")).toBe(true);
    expect(new BanxaOnRamp().configured()?.message).toBe("Buying with Banxa isn't switched on in this build.");
  });

  it("MoonPay: signature comes from your signing endpoint, never from a secret in the wallet", async () => {
    const { fetch, calls } = mockFetch([[/sign\.example/, { signature: "c2ln+/=" }]]);
    const mp = new MoonPayOnRamp({ apiKey: "pk_test_123", signerUrl: "https://sign.example/moonpay" });
    const url = new URL(await mp.buildUrl({ assetKey: "usdc", chain: "solana", address: ME_SOL, fiatAmount: 25, fiatCurrency: "EUR", sandbox: true }, fetch));
    expect(url.origin).toBe("https://buy-sandbox.moonpay.com");
    expect(url.searchParams.get("currencyCode")).toBe("usdc_sol");
    expect(url.searchParams.get("baseCurrencyCode")).toBe("eur");
    expect(url.searchParams.get("signature")).toBe("c2ln+/=");
    expect([...url.searchParams.keys()].at(-1)).toBe("signature");
    const signed = JSON.parse(String(calls[0]!.init!.body)).url as string;
    expect(signed).toContain("walletAddress=" + ME_SOL);
    expect(signed).not.toContain("signature");
    // Test mode: HBAR can't be bought in MoonPay's sandbox.
    expect(mp.supports("hbar", "hedera", true)).toBe(false);
    expect(mp.supports("hbar", "hedera", false)).toBe(true);
    expect(new MoonPayOnRamp({ apiKey: "pk", signerUrl: "" }).configured()?.code).toBe("onramp/not-configured");
  });

  it("C14: locked asset and address; asset ids only from config", async () => {
    const c = new C14OnRamp({ clientId: "client-1", assetIds: { "hbar@hedera": "11111111-2222-3333-4444-555555555555" } });
    expect(c.supports("hbar", "hedera", false)).toBe(true);
    expect(c.supports("sol", "solana", false)).toBe(false);
    const url = new URL(await c.buildUrl({ assetKey: "hbar", chain: "hedera", address: "0.0.1001", fiatAmount: 100, fiatCurrency: "usd", sandbox: false }));
    expect(url.origin).toBe("https://pay.c14.money");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ clientId: "client-1", targetAssetIdLock: "true", targetAddress: "0.0.1001", targetAddressLock: "true", sourceAmount: "100", sourceCurrencyCode: "USD" });
  });
});

describe("OnRampService", () => {
  it("asks only what and how much; picks the cheapest network the provider delivers to", async () => {
    const { fetch } = mockFetch([]);
    const host = fakeHost({ networks: [BASE_MAINNET, SOL_MAIN, HEDERA_TESTNET], assets: [usdcEvm(BASE_MAINNET), usdcSol(SOL_MAIN.id), usdcHedera(), hbar(), sol(SOL_MAIN.id)], fetch });
    const svc = new OnRampService(host, [new BanxaOnRamp({ partner: "clipwallet" }), new MoonPayOnRamp(), new C14OnRamp()], { testnet: false });
    const view = await svc.options({ assetKey: "usdc", fiatAmount: 40, fiatCurrency: "USD" });
    const banxa = view.options.find((o) => o.provider === "banxa")!;
    // Hedera is cheapest to receive on and Banxa delivers USDC there.
    expect(new URL(banxa.url!).searchParams.get("blockchain")).toBe("HBAR");
    expect(new URL(banxa.url!).searchParams.get("walletAddress")).toBe("0.0.1001");
    expect(view.networkId).toBe(HEDERA_TESTNET.id);
    expect(view.options.find((o) => o.provider === "moonpay")!.unavailable?.message).toBe("Buying with MoonPay isn't switched on in this build.");
    expect(view.explainer).toBe("Your USDC arrives in this wallet. Clip Wallet picked the cheapest way to receive it.");
    expect(svc.buyable().map((b) => b.assetKey).sort()).toEqual(["hbar", "sol", "usdc"]);
  });

  it("test builds say test mode plainly and skip what the sandbox can't do", async () => {
    const { fetch } = mockFetch([]);
    const host = fakeHost({ networks: [DEVNET], assets: [sol(DEVNET.id)], fetch });
    const svc = new OnRampService(host, [new C14OnRamp({ clientId: "c", assetIds: { sol: "id" } })], { testnet: true });
    const view = await svc.options({ assetKey: "sol", fiatAmount: 10, fiatCurrency: "USD" });
    expect(view.options[0]!.unavailable?.message).toBe("C14 can't deliver SOL to this wallet in this test version.");
    expect(view.explainer).toContain("no real money moves");
    await expect(svc.options({ assetKey: "sol", fiatAmount: 0, fiatCurrency: "USD" })).rejects.toMatchObject({ code: "onramp/bad-amount" });
  });
});
