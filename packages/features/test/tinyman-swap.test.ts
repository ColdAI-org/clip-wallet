import type { Account, AssetRef, ChainContext, DappRequest, TokenBalance } from "@clip-wallet/core";
import { ALGORAND_MAINNET, ALGORAND_TESTNET, algoAsset, createAlgorandModule, decodeTxn } from "@clip-wallet/chains-algorand";
import { describe, expect, it } from "vitest";
import { SwapService } from "../src/swap/service.js";
import { TINYMAN_V2_VALIDATOR, TinymanSwap, fixedInputSwap, tinymanPoolAddress } from "../src/swap/tinyman.js";
import { fakeHost, flush, mockFetch } from "./helpers.js";

/** Public "abandon … about" ARC-52 address from chains-algorand's fixtures. No key anywhere. */
const ME = "ACJDJWM7GWMKJFROZP2VSWZBP5FLSSMMMFXL5MPLZQRPQFARUKKRLAZ53E";
const NET = ALGORAND_TESTNET.id;
const USDC_ID = 10458941n;
const APP = 148607000n;
/** Derived below and checked live on 2026-10-03: algod testnet has this account opted into app 148607000 with these assets. */
const POOL = "UDFWT5DW3X5RZQYXKQEMZ6MRWAEYHWYP7YUAPZKPW6WJK3JH3OZPL7PO2Y";
const NOW = 1_790_000_000_000;
const algo = algoAsset(NET);
const usdc: AssetRef = { key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6, networkId: NET, address: USDC_ID.toString() };
const account: Account = { id: "algorand:0", family: "algorand", index: 0, curve: "bip32-ed25519", derivationPath: "m/44'/283'/0'/0/0", publicKey: "009234d99f3598a4962ecbf5595b217f4ab9498c616ebeb1ebcc22f81411a295", address: ME };
const ctxOf = (f: typeof fetch): ChainContext => ({ network: ALGORAND_TESTNET, account, fetch: f });

const kv = (key: string, uint: number) => ({ key: Buffer.from(key).toString("base64"), value: { bytes: "", type: 2, uint } });
/** Trimmed from GET testnet-api.4160.nodely.dev/v2/accounts/<POOL>/applications/148607000 on 2026-10-03. */
const POOL_STATE = {
  "app-local-state": {
    id: 148607000,
    "key-value": [
      kv("asset_1_id", 10458941),
      kv("asset_2_id", 0),
      kv("asset_1_reserves", 42451184765),
      kv("asset_2_reserves", 5432348313),
      kv("total_fee_share", 30),
      kv("protocol_fee_ratio", 6),
      kv("issued_pool_tokens", 14521471701),
      kv("pool_token_asset_id", 148620458),
    ],
  },
  round: 67905655,
};
const PARAMS = { fee: 0, "min-fee": 1000, "last-round": 67905655, "genesis-hash": "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=", "genesis-id": "testnet-v1.0" };

function algod(p: { usdc?: number | null; algo?: number; state?: unknown } = {}) {
  const usdcHolding = p.usdc === undefined || p.usdc === null ? undefined : { "asset-holding": { "asset-id": 10458941, amount: p.usdc, "is-frozen": false } };
  return mockFetch([
    [new RegExp(`/v2/accounts/${POOL}/applications/148607000$`), p.state === undefined ? POOL_STATE : p.state],
    [new RegExp(`/v2/accounts/${ME}/assets/10458941$`), usdcHolding],
    [new RegExp(`/v2/accounts/${ME}$`), { address: ME, amount: p.algo ?? 50_000_000, "min-balance": 100_000 }],
    [/\/v2\/transactions\/params$/, PARAMS],
    [/\/v2\/assets\/10458941$/, { index: 10458941, params: { creator: ME, decimals: 6, total: 1e15, "unit-name": "USDC", name: "USDC" } }],
  ]);
}

describe("Tinyman v2 (on-chain quote, wallet-built group)", () => {
  it("derives pool addresses from the v2 logic-sig template (checked live on testnet and mainnet)", () => {
    expect(tinymanPoolAddress(TINYMAN_V2_VALIDATOR.testnet, 0n, USDC_ID)).toBe(POOL);
    expect(tinymanPoolAddress(TINYMAN_V2_VALIDATOR.testnet, USDC_ID, 0n)).toBe(POOL);
    expect(tinymanPoolAddress(TINYMAN_V2_VALIDATOR.mainnet, 0n, 31566704n)).toBe("2PIFZW53RHCSFSYMCFUBW4XOCXOMB7XOYQSQ6KGT3KVGJTL4HM6COZRNMM");
  });

  it("fixed-input maths matches the SDK formula", () => {
    expect(fixedInputSwap(5432348313n, 42451184765n, 10_000_000n, 30n)).toEqual({ out: 77768018n, fee: 30000n });
  });

  it("is available on Algorand only", () => {
    const t = new TinymanSwap();
    expect(t.availability(ALGORAND_TESTNET)).toBeNull();
    expect(t.availability(ALGORAND_MAINNET)).toBeNull();
    expect(t.availability({ ...ALGORAND_TESTNET, id: "eip155:1", family: "evm" })?.code).toBe("swap/wrong-family");
  });

  it("quotes 10 ALGO → USDC from pool state, with the opt-in when USDC isn't added", async () => {
    const { fetch } = algod();
    const q = await new TinymanSwap({ now: () => NOW }).quote({ sell: algo, buy: usdc, amount: "10000000", slippageBps: 50 }, ctxOf(fetch));
    expect(q).toMatchObject({
      providerId: "tinyman",
      networkId: NET,
      sellAmount: "10000000",
      buyAmount: "77768018",
      minBuyAmount: "77379177",
      route: ["Tinyman"],
      association: { tokenId: "10458941", symbol: "USDC" },
      expiresAt: NOW + 30_000,
      data: { validator: "148607000", pool: POOL, asset1: "10458941", asset2: "0", optIn: true },
    });
    expect(q.priceImpactPct).toBeGreaterThan(0.3);
    expect(q.priceImpactPct).toBeLessThan(0.6);
  });

  it("plain errors: no pool, not enough, too small, wrong pool state", async () => {
    const t = new TinymanSwap();
    const req = { sell: algo, buy: usdc, amount: "10000000", slippageBps: 50 };
    const none = mockFetch([[/applications/, { message: "account application info not found" }, 404]]);
    await expect(t.quote(req, ctxOf(none.fetch))).rejects.toMatchObject({ code: "swap/no-route", userMessage: "There's no way to swap these two right now. Try another token." });
    const fake = { "app-local-state": { id: 148607000, "key-value": [kv("asset_1_id", 999), kv("asset_2_id", 0), kv("asset_1_reserves", 1), kv("asset_2_reserves", 1), kv("total_fee_share", 30)] } };
    await expect(t.quote(req, ctxOf(algod({ state: fake }).fetch))).rejects.toMatchObject({ code: "swap/no-route" });
    await expect(t.quote({ ...req, amount: "100" }, ctxOf(algod().fetch))).rejects.toMatchObject({ code: "swap/too-small" });
    await expect(t.quote(req, ctxOf(algod({ algo: 5_000_000 }).fetch))).rejects.toMatchObject({ code: "swap/insufficient" });
    await expect(t.quote({ ...req, sell: usdc, buy: algo, amount: "5000000" }, ctxOf(algod({ usdc: 1 }).fetch))).rejects.toMatchObject({ code: "swap/insufficient", userMessage: "You don't have enough USDC for this swap." });
  });

  it("builds [opt-in, pay → pool, app call swap fixed-input min] as one group, parsed back field by field", async () => {
    const { fetch } = algod();
    const t = new TinymanSwap();
    const q = await t.quote({ sell: algo, buy: usdc, amount: "10000000", slippageBps: 50 }, ctxOf(fetch));
    const [step] = await t.build(q, ctxOf(fetch));
    expect(step!.title).toBe("Add USDC and swap ALGO for USDC");
    expect(step!.lines).toContainEqual({ label: "At least", value: "77.379177 USDC, or nothing happens" });
    const request = await (step!.request as () => Promise<DappRequest>)();
    expect(request).toMatchObject({ family: "algorand", networkId: NET, method: "algo_signAndPostTxn" });
    const wtxns = (request.params as { txn: string }[][])[0]!;
    expect(wtxns).toHaveLength(3);
    const [optIn, pay, call] = wtxns.map((w) => decodeTxn(w.txn));

    expect(optIn!.type).toBe("axfer");
    expect(optIn!.sender.toString()).toBe(ME);
    expect(optIn!.assetTransfer!.receiver.toString()).toBe(ME);
    expect(optIn!.assetTransfer!.amount).toBe(0n);
    expect(optIn!.assetTransfer!.assetIndex).toBe(USDC_ID);
    expect(optIn!.assetTransfer!.closeRemainderTo).toBeUndefined();

    expect(pay!.type).toBe("pay");
    expect(pay!.sender.toString()).toBe(ME);
    expect(pay!.payment!.receiver.toString()).toBe(POOL);
    expect(pay!.payment!.amount).toBe(10_000_000n);
    expect(pay!.payment!.closeRemainderTo).toBeUndefined();
    expect(pay!.fee).toBe(1000n);

    expect(call!.type).toBe("appl");
    expect(call!.sender.toString()).toBe(ME);
    expect(call!.applicationCall!.appIndex).toBe(APP);
    expect(call!.applicationCall!.onComplete).toBe(0);
    expect(call!.applicationCall!.appArgs.slice(0, 2).map((a) => Buffer.from(a).toString())).toEqual(["swap", "fixed-input"]);
    expect(call!.applicationCall!.appArgs).toHaveLength(3);
    expect(Buffer.from(call!.applicationCall!.appArgs[2]!).readBigUInt64BE()).toBe(77379177n);
    expect(call!.applicationCall!.accounts.map(String)).toEqual([POOL]);
    expect(call!.applicationCall!.foreignAssets).toEqual([USDC_ID, 0n]);
    expect(call!.fee).toBe(2000n);

    for (const x of [optIn!, pay!, call!]) {
      expect(x.rekeyTo).toBeUndefined();
      expect(x.firstValid).toBe(67905655n);
      expect(x.lastValid).toBe(67906655n);
      expect(x.genesisID).toBe("testnet-v1.0");
      expect(Buffer.from(x.group!).equals(Buffer.from(optIn!.group!))).toBe(true);
    }

    // The real chains-algorand decode accepts the group (ARC-1 checks, group id) and isn't blind.
    const decoded = await createAlgorandModule({ simulate: false }).decode(request, ctxOf(fetch));
    expect(decoded.blind).toBe(false);
    expect(decoded.title).toBe("Approve 3 transactions");
  });

  it("selling an ASA → axfer to the pool; no opt-in when buying ALGO", async () => {
    const { fetch } = algod({ usdc: 9_000_000 });
    const t = new TinymanSwap();
    const q = await t.quote({ sell: usdc, buy: algo, amount: "5000000", slippageBps: 100 }, ctxOf(fetch));
    expect(q).toMatchObject({ buyAmount: "637840", minBuyAmount: "631461" });
    expect(q.association).toBeUndefined();
    const [step] = await t.build(q, ctxOf(fetch));
    expect(step!.title).toBe("Swap USDC for ALGO");
    const request = await (step!.request as () => Promise<DappRequest>)();
    const [xfer, call] = (request.params as { txn: string }[][])[0]!.map((w) => decodeTxn(w.txn));
    expect(xfer!.type).toBe("axfer");
    expect(xfer!.assetTransfer!.receiver.toString()).toBe(POOL);
    expect(xfer!.assetTransfer!.amount).toBe(5_000_000n);
    expect(xfer!.assetTransfer!.assetIndex).toBe(USDC_ID);
    expect(Buffer.from(call!.applicationCall!.appArgs[2]!).readBigUInt64BE()).toBe(631461n);
  });

  it("runs through SwapService by asset keys", async () => {
    const { fetch } = algod();
    const balances: TokenBalance[] = [{ asset: algo, amount: "50000000" }];
    const host = fakeHost({ networks: [ALGORAND_TESTNET], assets: [algo, usdc], balances, fetch });
    host.ctx = async () => ctxOf(fetch);
    const svc = new SwapService(host, [new TinymanSwap()]);
    const v = await svc.quote({ sell: "algo", buy: "usdc", amount: "10" });
    expect(v.youGet).toBe("You get ~77.768018 USDC");
    expect(v.route).toBe("Via Tinyman");
    expect(v.steps).toEqual(["Add USDC to your account", "Swap"]);
    const queued = await svc.execute(v.id);
    expect(queued.steps).toEqual(["Add USDC and swap ALGO for USDC"]);
    await flush();
    expect(host.enqueued[0]!.request.method).toBe("algo_signAndPostTxn");
  });
});
