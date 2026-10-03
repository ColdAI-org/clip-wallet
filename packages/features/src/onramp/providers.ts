import { ClipError } from "@clip-wallet/core";
import { fetchJson } from "../http.js";
import type { Unavailable } from "../views.js";
import type { ChainKey, OnRampProvider, OnRampRequest } from "./types.js";

/**
 * MoonPay hosted buy widget (https://dev.moonpay.com/widget/on-ramp/customization/parameters.md).
 * buy.moonpay.com (pk_live_) / buy-sandbox.moonpay.com (pk_test_). Passing walletAddress REQUIRES a signature:
 * HMAC-SHA256 of the query string (with "?") keyed by the SECRET key, base64, appended last as `signature`
 * (https://dev.moonpay.com/widget/on-ramp/customization/url-signing.md). The secret must never ship in a wallet,
 * so this plugin calls your signing endpoint: POST { url } → { signature }.
 * Currency codes checked against https://api.moonpay.com/v3/currencies (2026-10-03). `hbar`, `eth_base` and
 * `usdc_base` don't support test mode, so they're offered only outside the sandbox.
 */
const MOONPAY_CODES: Record<string, { code: string; testMode: boolean }> = {
  "sol@solana": { code: "sol", testMode: true },
  "usdc@solana": { code: "usdc_sol", testMode: true },
  "eth@ethereum": { code: "eth", testMode: true },
  "usdc@ethereum": { code: "usdc", testMode: true },
  "eth@base": { code: "eth_base", testMode: false },
  "usdc@base": { code: "usdc_base", testMode: false },
  "hbar@hedera": { code: "hbar", testMode: false },
};

export class MoonPayOnRamp implements OnRampProvider {
  readonly id = "moonpay";
  readonly name = "MoonPay";
  readonly methods = "Card, bank transfer, Apple Pay, Google Pay";
  constructor(private readonly cfg?: { apiKey: string; signerUrl: string }) {}

  configured(): Unavailable | null {
    if (!this.cfg?.apiKey || !this.cfg.signerUrl) return { code: "onramp/not-configured", message: "Buying with MoonPay isn't switched on in this build." };
    return null;
  }

  supports(assetKey: string, chain: ChainKey, sandbox: boolean): boolean {
    const c = MOONPAY_CODES[`${assetKey}@${chain}`];
    return !!c && (!sandbox || c.testMode);
  }

  async buildUrl(r: OnRampRequest, fetchImpl: typeof fetch): Promise<string> {
    const why = this.configured();
    if (why) throw new ClipError(why.message, why.code);
    const c = MOONPAY_CODES[`${r.assetKey}@${r.chain}`];
    if (!c) throw new ClipError("MoonPay can't deliver that here.", "onramp/unsupported");
    const u = new URL(r.sandbox ? "https://buy-sandbox.moonpay.com/" : "https://buy.moonpay.com/");
    u.searchParams.set("apiKey", this.cfg!.apiKey);
    u.searchParams.set("currencyCode", c.code);
    u.searchParams.set("walletAddress", r.address);
    u.searchParams.set("baseCurrencyCode", r.fiatCurrency.toLowerCase());
    u.searchParams.set("baseCurrencyAmount", String(r.fiatAmount));
    const { signature } = await fetchJson<{ signature?: string }>(fetchImpl, this.cfg!.signerUrl, "MoonPay", { body: { url: u.toString() } });
    if (!signature) throw new ClipError("MoonPay isn't available right now. Try again later.", "onramp/no-signature");
    u.searchParams.set("signature", signature);
    return u.toString();
  }
}

/**
 * Banxa referral checkout (https://docs.banxa.com/products/hosted-checkout/docs/referral-integration/constructing-referral-urls.md):
 * https://{partner}.banxa.com/?… (sandbox: {partner}.banxa-sandbox.com). No signing. Case-sensitive params:
 * coinType, blockchain, fiatType, fiatAmount, walletAddress, returnUrl. Blockchain codes from
 * …/reference/supported-cryptocurrencies-and-blockchains.md: SOL, ETH, BASE, HBAR (USDC on HBAR is buy-only).
 */
const BANXA: Record<string, { coin: string; chain: string }> = {
  "sol@solana": { coin: "SOL", chain: "SOL" },
  "usdc@solana": { coin: "USDC", chain: "SOL" },
  "eth@ethereum": { coin: "ETH", chain: "ETH" },
  "usdc@ethereum": { coin: "USDC", chain: "ETH" },
  "eth@base": { coin: "ETH", chain: "BASE" },
  "usdc@base": { coin: "USDC", chain: "BASE" },
  "hbar@hedera": { coin: "HBAR", chain: "HBAR" },
  "usdc@hedera": { coin: "USDC", chain: "HBAR" },
};

export class BanxaOnRamp implements OnRampProvider {
  readonly id = "banxa";
  readonly name = "Banxa";
  readonly methods = "Card, bank transfer, Apple Pay, Google Pay";
  constructor(private readonly cfg?: { partner: string }) {}

  configured(): Unavailable | null {
    if (!this.cfg?.partner || !/^[a-z0-9-]+$/i.test(this.cfg.partner)) return { code: "onramp/not-configured", message: "Buying with Banxa isn't switched on in this build." };
    return null;
  }

  supports(assetKey: string, chain: ChainKey): boolean {
    return !!BANXA[`${assetKey}@${chain}`];
  }

  async buildUrl(r: OnRampRequest): Promise<string> {
    const why = this.configured();
    if (why) throw new ClipError(why.message, why.code);
    const b = BANXA[`${r.assetKey}@${r.chain}`];
    if (!b) throw new ClipError("Banxa can't deliver that here.", "onramp/unsupported");
    const u = new URL(`https://${this.cfg!.partner}.${r.sandbox ? "banxa-sandbox" : "banxa"}.com/`);
    u.searchParams.set("coinType", b.coin);
    u.searchParams.set("blockchain", b.chain);
    u.searchParams.set("fiatType", r.fiatCurrency.toUpperCase());
    u.searchParams.set("fiatAmount", String(r.fiatAmount));
    u.searchParams.set("walletAddress", r.address);
    return u.toString();
  }
}

/**
 * C14 hosted widget (https://pay.c14.money/). C14's docs host (docs.c14.money) didn't resolve on 2026-10-03, so
 * these parameter names come from the live widget's bundle: clientId, targetAssetId(+Lock), targetAddress(+Lock),
 * sourceAmount, sourceCurrencyCode. Asset ids are UUIDs C14 issues per asset; they come from config
 * (asset key or "assetKey@chain" → id) because none are published. Re-verify with C14 before enabling.
 */
export class C14OnRamp implements OnRampProvider {
  readonly id = "c14";
  readonly name = "C14";
  readonly methods = "Card";
  constructor(private readonly cfg?: { clientId: string; assetIds: Record<string, string> }) {}

  configured(): Unavailable | null {
    if (!this.cfg?.clientId) return { code: "onramp/not-configured", message: "Buying with C14 isn't switched on in this build." };
    return null;
  }

  private assetId(assetKey: string, chain: ChainKey): string | undefined {
    return this.cfg?.assetIds[`${assetKey}@${chain}`] ?? this.cfg?.assetIds[assetKey];
  }

  supports(assetKey: string, chain: ChainKey, sandbox: boolean): boolean {
    return !sandbox && !!this.assetId(assetKey, chain);
  }

  async buildUrl(r: OnRampRequest): Promise<string> {
    const why = this.configured();
    if (why) throw new ClipError(why.message, why.code);
    const id = this.assetId(r.assetKey, r.chain);
    if (!id) throw new ClipError("C14 can't deliver that here.", "onramp/unsupported");
    const u = new URL("https://pay.c14.money/");
    u.searchParams.set("clientId", this.cfg!.clientId);
    u.searchParams.set("targetAssetId", id);
    u.searchParams.set("targetAssetIdLock", "true");
    u.searchParams.set("targetAddress", r.address);
    u.searchParams.set("targetAddressLock", "true");
    u.searchParams.set("sourceAmount", String(r.fiatAmount));
    u.searchParams.set("sourceCurrencyCode", r.fiatCurrency.toUpperCase());
    return u.toString();
  }
}
