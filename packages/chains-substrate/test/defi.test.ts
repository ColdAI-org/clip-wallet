import { describe, expect, it } from "vitest";
import {
  PASEO_ASSET_HUB,
  SUBSTRATE_METHODS,
  activeEra,
  assetLocation,
  connect,
  constantOf,
  createSubstrateModule,
  erasToText,
  locationAsset,
  nativeLocation,
  parsePayload,
  poolUnbondingEras,
  runtimeCall,
  specOf,
  spendableNative,
  storageEntries,
} from "../src/index.js";
import { WESTEND_ASSET_HUB } from "../src/networks.js";
import { Binary, Enum, callBytes, ctxFor, enc, makeAccount, mockRpc, payloadJson, runtime, seedRuntime, ss58 } from "./helpers.js";
import { FIX } from "./signatures.js";

const account = makeAccount(FIX.pub);
const ME = ss58(FIX.pub);
const BOB = ss58(FIX.bob);
const BASE = {
  chain_getFinalizedHead: () => `0x${"ab".repeat(32)}`,
  chain_getHeader: () => ({ number: "0xbc614e" }),
  system_accountNextIndex: () => 5,
  state_getRuntimeVersion: () => ({ specName: "westmint", specVersion: 1025001, transactionVersion: 16 }),
};
const fee = {
  TransactionPaymentApi_query_info: enc.apiResult("TransactionPaymentApi", "query_info", { weight: { ref_time: 1n, proof_size: 1n }, class: Enum("Normal"), partial_fee: 1_000_000_000n }),
};
const decodeCall = (method: Uint8Array) => runtime().builder.buildDefinition(runtime().callType).dec(method) as { type: string; value: { type: string; value: Record<string, unknown> } };

describe("feature helpers", () => {
  it("reads constants from metadata (Westend Asset Hub values read live 2026-10-03)", () => {
    expect(constantOf(runtime(), "Staking", "BondingDuration")).toBe(2);
    expect(constantOf(runtime(), "Balances", "ExistentialDeposit")).toBe(1_000_000_000n);
    expect(constantOf(runtime(), "Nope", "X")).toBeNull();
  });

  it("sends runtime-API args as 0x hex (JSON-RPC needs a string)", async () => {
    seedRuntime();
    const rpc = mockRpc(BASE, { NominationPoolsApi_pending_rewards: enc.apiResult("NominationPoolsApi", "pending_rewards", 7n) });
    const c = await connect(ctxFor(account, rpc.fetch));
    await expect(runtimeCall(c.rpc, c.rt, "NominationPoolsApi", "pending_rewards", [ME])).resolves.toBe(7n);
    const sent = rpc.log.find((l) => l.method === "state_call")!.params[1];
    expect(typeof sent).toBe("string");
    expect(sent).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("lists storage entries with values (keys paged, values batched)", async () => {
    seedRuntime();
    const pool = (n: number) => ({
      commission: { current: undefined, max: undefined, change_rate: undefined, throttle_from: undefined, claim_permission: undefined },
      member_counter: n,
      points: 1n,
      roles: { depositor: BOB, root: undefined, nominator: undefined, bouncer: undefined },
      state: Enum("Open"),
    });
    const k1 = enc.storageKey("NominationPools", "BondedPools", 1);
    const k2 = enc.storageKey("NominationPools", "BondedPools", 2);
    const rpc = mockRpc({
      ...BASE,
      state_getKeysPaged: () => [k1, k2],
      state_queryStorageAt: (p) => {
        expect(p[0]).toEqual([k1, k2]);
        return [{ block: "0x", changes: [[k1, enc.storageValue("NominationPools", "BondedPools", pool(3))], [k2, null]] }];
      },
    });
    const c = await connect(ctxFor(account, rpc.fetch));
    const out = await storageEntries<{ member_counter: number }>(c.rpc, c.rt, "NominationPools", "BondedPools");
    expect(out).toHaveLength(1);
    expect(out[0]![0]).toEqual([1]);
    expect(out[0]![1].member_counter).toBe(3);
  });

  it("maps XCM locations to native / pallet-assets ids", () => {
    expect(locationAsset(nativeLocation())).toBe("native");
    expect(locationAsset(assetLocation(1337))).toBe(1337);
    expect(locationAsset({ parents: 1, interior: Enum("X1", Enum("Parachain", 2000)) })).toBeNull();
    // Round trip through the real AssetConversion.Pools key codec.
    const k = runtime().builder.buildStorage("AssetConversion", "Pools");
    const [[a, b]] = k.keys.dec(k.keys.enc([nativeLocation(), assetLocation(1984)])) as [[unknown, unknown]];
    expect([locationAsset(a), locationAsset(b)]).toEqual(["native", 1984]);
  });

  it("computes the spendable native balance, the active era and pool unbonding time", async () => {
    seedRuntime();
    const acct = { nonce: 0, consumers: 0, providers: 1, sufficients: 0, data: { free: 10_000_000_000_000n, reserved: 0n, frozen: 0n, flags: 0n } };
    const rpc = mockRpc(
      BASE,
      {},
      {
        [enc.storageKey("System", "Account", ME)]: enc.storageValue("System", "Account", acct),
        [enc.storageKey("Staking", "ActiveEra")]: enc.storageValue("Staking", "ActiveEra", { index: 11115, start: 1n }),
        [enc.storageKey("Staking", "CurrentEra")]: enc.storageValue("Staking", "CurrentEra", 11116),
        [enc.storageKey("Staking", "AreNominatorsSlashable")]: enc.storageValue("Staking", "AreNominatorsSlashable", false),
      },
    );
    const c = await connect(ctxFor(account, rpc.fetch));
    expect(await spendableNative(c)).toBe(10_000_000_000_000n - 1_000_000_000n);
    expect(await activeEra(c)).toBe(11115);
    expect(await poolUnbondingEras(c)).toBe(2); // NominatorFastUnbondDuration on Westend
    expect(erasToText(c.spec, 2)).toBe("about 12 hours");
    expect(erasToText(specOf("polkadot:68d56f15f85d3136970ec16946040bc1")!, 28)).toBe("about 28 days");
  });

  it("lists Paseo's test USDC / USDT (ids 1337 / 1984, PAS pools)", () => {
    expect(specOf(PASEO_ASSET_HUB.id)!.assets).toEqual([
      expect.objectContaining({ id: 1337, symbol: "USDC", key: "usdc" }),
      expect.objectContaining({ id: 1984, symbol: "USDT", key: "usdt" }),
    ]);
  });
});

describe("buildCall and swap descriptions", () => {
  const usdc = { deposit: 0n, name: Binary.fromText("USD Coin"), symbol: Binary.fromText("USDC"), decimals: 6, is_frozen: false };

  it("builds any metadata call as substrate_signAndSubmit and decodes it back", async () => {
    seedRuntime();
    const rpc = mockRpc(BASE, fee, { [enc.storageKey("Assets", "Metadata", 31337)]: enc.storageValue("Assets", "Metadata", usdc) });
    const m = createSubstrateModule();
    const ctx = ctxFor(account, rpc.fetch);
    const args = { path: [nativeLocation(), assetLocation(31337)], amount_in: 2_000_000_000_000n, amount_out_min: 970_000n, send_to: ME, keep_alive: true };
    const r = await m.buildCall({ pallet: "AssetConversion", call: "swap_exact_tokens_for_tokens", args }, ctx);
    expect(r.method).toBe(SUBSTRATE_METHODS.signAndSubmit);
    const p = parsePayload((r.params as { payload: unknown }).payload);
    const call = decodeCall(p.method);
    expect(call.type).toBe("AssetConversion");
    expect(call.value.type).toBe("swap_exact_tokens_for_tokens");
    expect(call.value.value.amount_in).toBe(2_000_000_000_000n);
    expect(call.value.value.amount_out_min).toBe(970_000n);
    expect(call.value.value.send_to).toBe(ME);
    expect(call.value.value.keep_alive).toBe(true);
    expect((call.value.value.path as unknown[]).map(locationAsset)).toEqual(["native", 31337]);

    const d = await m.decode(r, ctx);
    expect(d.blind).toBe(false);
    expect(d.title).toBe("Swap 2 WND for at least 0.97 USDC");
    expect(d.lines).toContainEqual({ label: "Route", value: "Asset Hub pool" });
    expect(d.balanceChanges).toEqual(
      expect.arrayContaining([
        { asset: expect.objectContaining({ key: "wnd" }), delta: "-2000000000000" },
        { asset: expect.objectContaining({ key: "asset:31337", address: "31337" }), delta: "970000" },
      ]),
    );
    expect(d.warnings).toEqual([]);
  });

  it("warns when a swap pays someone else, and shows foreign-asset swaps raw", async () => {
    seedRuntime();
    const rpc = mockRpc(BASE, fee, { [enc.storageKey("Assets", "Metadata", 31337)]: enc.storageValue("Assets", "Metadata", usdc) });
    const m = createSubstrateModule();
    const ctx = ctxFor(account, rpc.fetch);
    const mk = (path: unknown[], send_to: string) =>
      ({
        id: "x",
        origin: "https://dapp.example",
        via: "injected",
        family: "substrate",
        networkId: WESTEND_ASSET_HUB.id,
        method: SUBSTRATE_METHODS.signPayload,
        params: payloadJson(ME, callBytes("AssetConversion", "swap_exact_tokens_for_tokens", { path, amount_in: 1n, amount_out_min: 1n, send_to, keep_alive: true })),
      }) as const;
    const other = await m.decode(mk([assetLocation(31337), nativeLocation()], BOB), ctx);
    expect(other.warnings).toContainEqual(expect.objectContaining({ code: "new-recipient" }));
    expect(other.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "asset:31337" }), delta: "-1" }]);
    const foreign = await m.decode(mk([nativeLocation(), { parents: 1, interior: Enum("X1", Enum("Parachain", 2000)) }], ME), ctx);
    expect(foreign.title).toBe("AssetConversion.swap_exact_tokens_for_tokens for dapp.example");
    expect(foreign.warnings[0]).toMatchObject({ level: "caution", code: "blind-signing" });
  });
});
