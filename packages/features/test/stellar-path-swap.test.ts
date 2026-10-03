import type { Account, ChainContext, TokenBalance } from "@clip-wallet/core";
import { STELLAR_TESTNET, USDC_ISSUERS, classicAsset, createStellarModule, parseStellarTransaction, xlmAsset } from "@clip-wallet/chains-stellar";
import { describe, expect, it } from "vitest";
import { refineDecoded } from "../src/steps.js";
import { SwapService } from "../src/swap/service.js";
import { StellarPathSwap, amountOf, stroopsOf } from "../src/swap/stellar-path.js";
import { fakeHost, flush, mockFetch } from "./helpers.js";

/** SEP-0005 test 5 public address ("abandon … about", m/44'/148'/0'). Public only, no key anywhere. */
const ME = "GB3JDWCQJCWMJ3IILWIGDTQJJC5567PGVEVXSCVPEQOTDN64VJBDQBYX";
const NET = STELLAR_TESTNET.id;
const USDC_T = USDC_ISSUERS.testnet;
const AQUA_ISSUER = "GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA";
const NOW = 1_790_000_000_000;
const xlm = xlmAsset(NET);
const usdc = classicAsset(NET, "USDC", USDC_T);
const account: Account = { id: "stellar:0", family: "stellar", index: 0, curve: "ed25519", derivationPath: "m/44'/148'/0'", publicKey: "00".repeat(32), address: ME };

const meAccount = (withUsdc = false) => ({
  id: ME,
  sequence: "8680382308286645",
  subentry_count: withUsdc ? 1 : 0,
  balances: [
    ...(withUsdc ? [{ balance: "25.0000000", asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: USDC_T, selling_liabilities: "0.0000000" }] : []),
    { balance: "19931.6990286", asset_type: "native", selling_liabilities: "0.0000000" },
  ],
  signers: [{ weight: 1, key: ME, type: "ed25519_public_key" }],
  data: {},
});

/** Captured from horizon-testnet.stellar.org /paths/strict-send on 2026-10-03 (XLM → USDC), plus a worse multi-hop record. */
const PATHS_XLM_USDC = {
  _embedded: {
    records: [
      { source_asset_type: "native", source_amount: "10.0000000", destination_asset_type: "credit_alphanum4", destination_asset_code: "USDC", destination_asset_issuer: USDC_T, destination_amount: "9.4100000", path: [{ asset_type: "credit_alphanum4", asset_code: "AQUA", asset_issuer: AQUA_ISSUER }] },
      { source_asset_type: "native", source_amount: "10.0000000", destination_asset_type: "credit_alphanum4", destination_asset_code: "USDC", destination_asset_issuer: USDC_T, destination_amount: "9.4657912", path: [] },
      // A record for a look-alike USDC must never be picked even if it pays more.
      { source_asset_type: "native", source_amount: "10.0000000", destination_asset_type: "credit_alphanum4", destination_asset_code: "USDC", destination_asset_issuer: AQUA_ISSUER, destination_amount: "99.0000000", path: [] },
    ],
  },
};

function horizon(p: { paths?: unknown; withUsdc?: boolean } = {}) {
  return mockFetch([
    [/\/paths\/strict-send/, p.paths ?? PATHS_XLM_USDC],
    [new RegExp(`/accounts/${ME}$`), meAccount(p.withUsdc)],
    [/\/fee_stats/, { last_ledger_base_fee: "100", fee_charged: { p50: "100" } }],
    [/\/ledgers\?order=desc&limit=1/, { _embedded: { records: [{ base_reserve_in_stroops: 5000000 }] } }],
  ]);
}
const ctxOf = (f: typeof fetch): ChainContext => ({ network: STELLAR_TESTNET, account, fetch: f });

describe("Stellar DEX path payments", () => {
  it("is available on Stellar networks only", () => {
    const s = new StellarPathSwap();
    expect(s.availability(STELLAR_TESTNET)).toBeNull();
    expect(s.availability({ ...STELLAR_TESTNET, id: "eip155:1", family: "evm" })?.code).toBe("swap/wrong-family");
  });

  it("converts 7-decimal amounts exactly", () => {
    expect(stroopsOf("9.4657912")).toBe(94657912n);
    expect(stroopsOf("10")).toBe(100000000n);
    expect(amountOf(100000001n)).toBe("10.0000001");
    expect(() => stroopsOf("1.12345678")).toThrow();
  });

  it("quotes from Horizon strict-send paths: right query, best record of the right asset, minimum after slippage", async () => {
    const { fetch, calls } = horizon();
    const q = await new StellarPathSwap({ now: () => NOW }).quote({ sell: xlm, buy: usdc, amount: "100000000", slippageBps: 50 }, ctxOf(fetch));
    const u = new URL(calls.find((c) => c.url.includes("/paths/strict-send"))!.url);
    expect(u.origin).toBe("https://horizon-testnet.stellar.org");
    expect(Object.fromEntries(u.searchParams)).toEqual({ source_asset_type: "native", source_amount: "10.0000000", destination_assets: `USDC:${USDC_T}` });
    expect(q).toMatchObject({
      providerId: "stellar-dex",
      networkId: NET,
      sellAmount: "100000000",
      buyAmount: "94657912",
      minBuyAmount: "94184622", // 94657912 × 0.995, rounded down
      route: ["Stellar DEX"],
      association: { tokenId: `USDC:${USDC_T}`, symbol: "USDC" },
      expiresAt: NOW + 30_000,
      data: { path: [] },
    });
  });

  it("sells a credit asset with credit_alphanum4 + code + issuer, keeps the hop", async () => {
    const paths = { _embedded: { records: [{ source_asset_type: "credit_alphanum4", source_amount: "5.0000000", destination_asset_type: "native", destination_amount: "52.1000000", path: [{ asset_type: "credit_alphanum4", asset_code: "AQUA", asset_issuer: AQUA_ISSUER }] }] } };
    const { fetch, calls } = horizon({ paths, withUsdc: true });
    const q = await new StellarPathSwap().quote({ sell: usdc, buy: xlm, amount: "50000000", slippageBps: 100 }, ctxOf(fetch));
    const u = new URL(calls[0]!.url);
    expect(Object.fromEntries(u.searchParams)).toEqual({ source_asset_type: "credit_alphanum4", source_asset_code: "USDC", source_asset_issuer: USDC_T, source_amount: "5.0000000", destination_assets: "native" });
    expect(q.buyAmount).toBe("521000000");
    expect(q.minBuyAmount).toBe("515790000");
    expect(q.route).toEqual(["Stellar DEX (through AQUA)"]);
    expect(q.association).toBeUndefined();
    expect(q.data).toEqual({ path: [{ code: "AQUA", issuer: AQUA_ISSUER }] });
  });

  it("no path → plain 'no way to swap'", async () => {
    const { fetch } = horizon({ paths: { _embedded: { records: [] } } });
    await expect(new StellarPathSwap().quote({ sell: xlm, buy: usdc, amount: "100000000", slippageBps: 50 }, ctxOf(fetch))).rejects.toMatchObject({
      code: "swap/no-route",
      userMessage: "There's no way to swap these two right now. Try a smaller amount or another asset.",
    });
  });

  it("not enough of the sold asset → plain error at quote time", async () => {
    const { fetch } = horizon({ paths: { _embedded: { records: [{ ...PATHS_XLM_USDC._embedded.records[1], source_amount: "20000.0000000" }] } } });
    await expect(new StellarPathSwap().quote({ sell: xlm, buy: usdc, amount: "200000000000", slippageBps: 50 }, ctxOf(fetch))).rejects.toMatchObject({ code: "stellar/insufficient-balance" });
  });

  it("builds one transaction: changeTrust(USDC) + pathPaymentStrictSend to you with destMin; decodes plainly", async () => {
    const { fetch } = horizon();
    const s = new StellarPathSwap();
    const q = await s.quote({ sell: xlm, buy: usdc, amount: "100000000", slippageBps: 50 }, ctxOf(fetch));
    const steps = await s.build(q, ctxOf(fetch));
    expect(steps).toHaveLength(1);
    expect(steps[0]!.title).toBe("Add USDC and swap XLM for USDC");
    expect(steps[0]!.lines).toContainEqual({ label: "Also", value: "Adds USDC to your account first. That sets aside 0.5 XLM of your balance while USDC is in your account." });
    const request = await (steps[0]!.request as () => Promise<import("@clip-wallet/core").DappRequest>)();
    expect(request).toMatchObject({ family: "stellar", networkId: NET, method: "stellar_signAndSubmitXDR", params: { address: ME, networkPassphrase: "Test SDF Network ; September 2015" } });

    const tx = parseStellarTransaction((request.params as { xdr: string }).xdr, NET) as unknown as {
      source: string;
      fee: string;
      sequence: string;
      operations: Record<string, unknown>[];
    };
    expect(tx.source).toBe(ME);
    expect(tx.sequence).toBe("8680382308286646");
    expect(tx.fee).toBe("200");
    expect(tx.operations).toHaveLength(2);
    const [ct, pp] = tx.operations as [
      { type: string; line: { getCode(): string; getIssuer(): string } },
      { type: string; sendAsset: { isNative(): boolean }; sendAmount: string; destination: string; destAsset: { getCode(): string; getIssuer(): string }; destMin: string; path: unknown[] },
    ];
    expect(ct.type).toBe("changeTrust");
    expect([ct.line.getCode(), ct.line.getIssuer()]).toEqual(["USDC", USDC_T]);
    expect(pp.type).toBe("pathPaymentStrictSend");
    expect(pp.sendAsset.isNative()).toBe(true);
    expect(pp.sendAmount).toBe("10.0000000");
    expect(pp.destination).toBe(ME);
    expect([pp.destAsset.getCode(), pp.destAsset.getIssuer()]).toEqual(["USDC", USDC_T]);
    expect(pp.destMin).toBe("9.4184622");
    expect(pp.path).toEqual([]);

    // The real chains-stellar decode describes it (not blind); refine leads with the plain title.
    const decoded = await createStellarModule().decode(request, ctxOf(fetch));
    expect(decoded.blind).toBe(false);
    expect(decoded.title).toBe("Add USDC to your account and swap 10 XLM for at least 9.4184622 USDC");
    expect(refineDecoded(request, decoded).title).toBe(decoded.title); // not registered here: untouched
  });

  it("runs through SwapService: quote by asset keys, then one approval", async () => {
    const { fetch } = horizon();
    const balances: TokenBalance[] = [{ asset: xlm, amount: "199316990286" }];
    const host = fakeHost({ networks: [STELLAR_TESTNET], assets: [xlm, usdc], balances, fetch });
    host.ctx = async () => ctxOf(fetch);
    const svc = new SwapService(host, [new StellarPathSwap()]);
    const v = await svc.quote({ sell: "xlm", buy: "usdc", amount: "10" });
    expect(v.youGet).toBe("You get ~9.465791 USDC");
    expect(v.atLeast).toBe("At least 9.418462 USDC, or nothing happens");
    expect(v.route).toBe("Via Stellar DEX");
    const queued = await svc.execute(v.id);
    expect(queued.steps).toEqual(["Add USDC and swap XLM for USDC"]);
    await flush();
    expect(host.enqueued).toHaveLength(1);
    expect(host.enqueued[0]!.request.method).toBe("stellar_signAndSubmitXDR");
  });
});
