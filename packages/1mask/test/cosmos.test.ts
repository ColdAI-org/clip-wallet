import type { DappRequest, Family, Network } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { COSMOS_METHODS_ALLOWED, cosmosInjectedAllowlist, createCosmosDispatcher, type CosmosRouterInternals } from "../src/background/cosmos.js";
import { installCosmosProvider } from "../src/inpage/cosmos.js";
import type { InpageTransport } from "../src/inpage/transport.js";
import { DEFAULT_IDENTITY } from "../src/shared/config.js";
import { COSMOS_CHAIN_FACTS, COSMOS_INJECTED, chainInfoWithoutEndpoints } from "../src/shared/cosmos.js";
import { bech32Decode, bech32Encode, hexOf } from "../src/shared/cosmos-bech32.js";
import { fromRpcErrorShape, toRpcErrorShape } from "../src/shared/errors.js";
import type { ExposedAccount } from "../src/shared/protocol.js";
import { newWindow } from "./helpers.js";

/**
 * The Keplr-compatible provider (window.clipwallet.cosmos) over the background dispatcher, with the router's
 * internals faked: permissions, accounts, approvals and reads are recorded. Account values are the public
 * "abandon … about" account 0 of each family (addresses and public keys only).
 */

const ORIGIN = "https://app.osmosis.example";
const asset = (networkId: string) => ({ key: "x", symbol: "X", name: "X", decimals: 6, networkId });
const NETS: Network[] = COSMOS_CHAIN_FACTS.map((c) => ({ id: `cosmos:${c.chainId}`, family: c.family, name: c.chainName, nativeAsset: asset(`cosmos:${c.chainId}`), testnet: c.testnet, rpcUrls: [], explorerUrl: "" }));

const ACCOUNTS: Partial<Record<Family, ExposedAccount[]>> = {
  cosmos: [{ address: "cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4", publicKey: "024f4e2ad99c34d60b9ba6283c9431a8418af8673212961f97a77b6377fcd05b62" }],
  provenance: [{ address: "pb1fpwxdyscnu2dzjwghpstx7l9xtvsap48l5gnrm", publicKey: "02b46c78777309c65fb5c2308574fb9a76853d7c0e91d1a1bd1f79f6ccb64ef6da" }],
  thorchain: [{ address: "thor1gm00vwsfcp48enm4uv9e5dhm37jtd0ye27wrx0", publicKey: "02205c476a22d5fe10b74489db9479d0e36e25a32da393a771fcf12380136a451f" }],
  initia: [{ address: "init1npvwllfr9dqr8erajqqr6s0vxnk2ak558xjc5c", publicKey: "0237b0bb7a8288d38ed49a524b5dc98cff3eb5ca824c9f9dc0dfdb3d9cd600f299" }],
};
const OSMO = "osmo19rl4cm2hmr8afy4kldpxz3fka4jguq0a5m7df8";
const OSMO_BOB = "osmo1jrkmdcwgq94uaamx6zax2luewlhf7u4k5r4pqs";

function harness(opts: { read?: boolean; result?: (r: DappRequest) => unknown } = {}) {
  const granted = new Set<string>();
  const approved: DappRequest[] = [];
  const reads: DappRequest[] = [];
  const connects: { family: Family; params: unknown }[] = [];
  const internals: CosmosRouterInternals = {
    permitted: async (o, f) => granted.has(`${o}|${f}`),
    requirePermission: async (o, f) => {
      if (!granted.has(`${o}|${f}`)) throw Object.assign(new Error("Connect Clip Wallet to this site first."), { code: 4100 });
    },
    accounts: async (_o, f) => ACCOUNTS[f] ?? [],
    connect: async (o, f, _net, _m, params) => {
      connects.push({ family: f, params });
      granted.add(`${o}|${f}`);
      return ACCOUNTS[f] ?? [];
    },
    approve: async (req) => {
      approved.push(req);
      return opts.result ? opts.result(req) : null;
    },
    makeReq: (origin, family, net, method, params) => ({ id: String(approved.length + reads.length), origin, via: "injected", family, networkId: net.id, method, params }),
    requireNetwork: (family, _o, chain) => {
      const n = NETS.find((x) => x.family === family && x.id === chain);
      if (!n) throw Object.assign(new Error(`Clip Wallet does not support ${chain}.`), { code: 4901 });
      return n;
    },
    revoke: async (o, f) => void granted.delete(`${o}|${f}`),
    ...(opts.read
      ? {
          read: async (req: DappRequest) => {
            reads.push(req);
            return req.method === COSMOS_INJECTED.sendTx ? { txhash: "AABBCC" } : true;
          },
        }
      : {}),
  };
  const dispatcher = createCosmosDispatcher(internals);
  const listeners = new Set<(family: Family, event: "accountsChanged" | "disconnect", data: unknown) => void>();
  const transport: InpageTransport = {
    request: async (family, method, params, chain) => {
      try {
        // JSON round trip, as across postMessage and the runtime port.
        const p = params === undefined ? undefined : JSON.parse(JSON.stringify(params));
        return JSON.parse(JSON.stringify((await dispatcher.dispatch(ORIGIN, family, method, p, chain)) ?? null));
      } catch (e) {
        throw fromRpcErrorShape(toRpcErrorShape(e));
      }
    },
    onEvent: (l) => (listeners.add(l as never), () => listeners.delete(l as never)),
    destroy: () => undefined,
  };
  const win = newWindow();
  const { provider, stop } = installCosmosProvider(win, DEFAULT_IDENTITY, NETS, transport);
  const emit = (family: Family, event: "accountsChanged" | "disconnect", data: unknown) => listeners.forEach((l) => l(family, event, data));
  return { provider, stop, win, approved, reads, connects, granted, emit, dispatcher };
}

describe("window.clipwallet.cosmos (Keplr API)", () => {
  it("is exposed under Clip's own global, never window.keplr", () => {
    const h = harness();
    const w = h.win as unknown as Record<string, Record<string, unknown> | undefined>;
    expect(w.clipwallet!.cosmos).toBe(h.provider);
    expect(w.keplr).toBeUndefined();
    expect((w.clipwallet!.info as { name: string }).name).toBe("Clip Wallet");
    expect(h.provider.mode).toBe("extension");
    h.stop();
    expect(w.clipwallet!.cosmos).toBeUndefined();
  });

  it("enable prompts once per key family; getKey spells the account per chain", async () => {
    const h = harness();
    await expect(h.provider.getKey("osmo-test-5")).rejects.toMatchObject({ code: 4100 });
    await h.provider.enable(["osmo-test-5", "dydx-testnet-4", "initiation-2"]);
    expect(h.connects).toEqual([
      { family: "cosmos", params: { chainIds: ["osmo-test-5", "dydx-testnet-4"] } },
      { family: "initia", params: { chainIds: ["initiation-2"] } },
    ]);
    await h.provider.enable("osmo-test-5");
    expect(h.connects.length).toBe(2);

    const osmo = await h.provider.getKey("osmo-test-5");
    expect(osmo).toMatchObject({ name: "Clip Wallet", algo: "secp256k1", bech32Address: OSMO, isNanoLedger: false, isKeystone: false });
    expect(hexOf(osmo.pubKey)).toBe(ACCOUNTS.cosmos![0]!.publicKey);
    expect(hexOf(osmo.address)).toBe(hexOf(bech32Decode(OSMO)!.data));
    expect(osmo.ethereumHexAddress).toBe(`0x${hexOf(osmo.address)}`);
    expect((await h.provider.getKey("dydx-testnet-4")).bech32Address).toBe("dydx19rl4cm2hmr8afy4kldpxz3fka4jguq0a4erelz");
    const init = await h.provider.getKey("initiation-2");
    expect(init).toMatchObject({ algo: "ethsecp256k1", bech32Address: "init1npvwllfr9dqr8erajqqr6s0vxnk2ak558xjc5c" });
    expect(init.ethereumHexAddress).toBe("0x9858effd232b4033e47d90003d41ec34ecaeda94");
    // Provenance isn't connected yet.
    await expect(h.provider.getKey("pio-testnet-1")).rejects.toMatchObject({ code: 4100 });
  });

  it("refuses chains Clip doesn't ship, in plain words", async () => {
    const h = harness();
    await expect(h.provider.enable("cosmoshub-4")).rejects.toThrow("There is no chain info for cosmoshub-4");
    await expect(h.provider.enable([])).rejects.toThrow("chain id not set");
    await expect(h.provider.experimentalSuggestChain({ chainId: "evil-1" })).rejects.toThrow("Clip Wallet doesn't support evil-1 and can't add chains from websites.");
    await expect(h.provider.experimentalSuggestChain({ chainId: "osmo-test-5" })).resolves.toBeUndefined();
    const infos = await h.provider.getChainInfosWithoutEndpoints();
    expect(infos.map((i) => i.chainId)).toEqual(COSMOS_CHAIN_FACTS.map((c) => c.chainId));
    expect(infos[0]).toMatchObject({ rest: undefined, rpc: undefined, bip44: { coinType: 118 }, bech32Config: { bech32PrefixAccAddr: "osmo", bech32PrefixValAddr: "osmovaloper" } });
    expect(chainInfoWithoutEndpoints("thorchain-1")!.stakeCurrency).toBeUndefined();
  });

  it("offline signer: getAccounts, signDirect through an approval, account number type kept", async () => {
    const h = harness({
      result: (r) => {
        const p = r.params as { signDoc: unknown };
        return { signed: p.signDoc, signature: { pub_key: { type: "tendermint/PubKeySecp256k1", value: "AA==" }, signature: "c2ln" } };
      },
    });
    await h.provider.enable("osmo-test-5");
    const signer = h.provider.getOfflineSigner("osmo-test-5");
    const [acc] = await signer.getAccounts();
    expect(acc).toMatchObject({ address: OSMO, algo: "secp256k1" });
    const doc = { bodyBytes: new Uint8Array([1, 2]), authInfoBytes: new Uint8Array([3]), chainId: "osmo-test-5", accountNumber: 4242n };
    const res = await signer.signDirect(OSMO, doc);
    expect(res.signed.bodyBytes).toEqual(new Uint8Array([1, 2]));
    expect(res.signed.accountNumber).toBe(4242n);
    expect(res.signature.signature).toBe("c2ln");
    expect(h.approved.at(-1)).toMatchObject({
      family: "cosmos",
      networkId: "cosmos:osmo-test-5",
      method: "cosmos_signDirect",
      origin: ORIGIN,
      params: { signerAddress: OSMO, signDoc: { bodyBytes: "AQI=", authInfoBytes: "Aw==", chainId: "osmo-test-5", accountNumber: "4242" } },
    });
    await expect(signer.signDirect(OSMO, { ...doc, chainId: "osmosis-1" })).rejects.toThrow("Unmatched chain id with the offline signer");
    await expect(signer.signDirect(OSMO_BOB, doc)).rejects.toThrow("Unknown signer address");
    const amino = h.provider.getOfflineSignerOnlyAmino("osmo-test-5");
    expect("signDirect" in amino).toBe(false);
    const auto = await h.provider.getOfflineSignerAuto("osmo-test-5");
    expect("signDirect" in auto).toBe(true);
  });

  it("the background checks the signer and the sign doc's chain itself", async () => {
    const h = harness();
    await h.provider.enable("osmo-test-5");
    const wire = { bodyBytes: "AQI=", authInfoBytes: "Aw==", chainId: "osmo-test-5", accountNumber: "1" };
    const call = (method: string, params: unknown, chain = "cosmos:osmo-test-5") => h.dispatcher.dispatch(ORIGIN, "cosmos", method, params, chain);
    await expect(call("cosmos_signDirect", { signerAddress: OSMO_BOB, signDoc: wire })).rejects.toMatchObject({ code: 4100, message: "Signer mismatched" });
    await expect(call("cosmos_signDirect", { signerAddress: "dydx19rl4cm2hmr8afy4kldpxz3fka4jguq0a4erelz", signDoc: wire })).rejects.toMatchObject({ code: 4100 });
    await expect(call("cosmos_signDirect", { signerAddress: OSMO, signDoc: { ...wire, chainId: "dydx-testnet-4" } })).rejects.toMatchObject({ code: -32602 });
    await expect(call("cosmos_signAmino", { signerAddress: OSMO, signDoc: { chain_id: "osmosis-1" } })).rejects.toMatchObject({ code: -32602 });
    await expect(call("cosmos_signArbitrary", { signer: OSMO, data: "" })).rejects.toMatchObject({ code: -32602 });
    // Another family's network can't be named through this family.
    await expect(call("cosmos_signDirect", { signerAddress: OSMO, signDoc: wire }, "cosmos:initiation-2")).rejects.toMatchObject({ code: 4901 });
    await expect(call("cosmos_signEverything", {})).rejects.toMatchObject({ code: 4200 });
    expect(h.approved).toEqual([]);
    // Same 20 bytes, this chain's prefix: allowed.
    await call("cosmos_signDirect", { signerAddress: OSMO, signDoc: wire });
    expect(h.approved.length).toBe(1);
  });

  it("signAmino, signArbitrary (ADR-36 string → UTF-8 → base64), verifyArbitrary and sendTx", async () => {
    const h = harness({ read: true, result: (r) => (r.method === "cosmos_signArbitrary" ? { pub_key: { type: "tendermint/PubKeySecp256k1", value: "AA==" }, signature: "c2ln" } : { signed: (r.params as { signDoc: unknown }).signDoc, signature: {} }) });
    await h.provider.enable("osmo-test-5");
    const doc = { chain_id: "osmo-test-5", account_number: "1", sequence: "0", fee: { amount: [], gas: "1" }, msgs: [], memo: "" };
    expect((await h.provider.signAmino("osmo-test-5", OSMO, doc)).signed).toEqual(doc);
    expect(await h.provider.signArbitrary("osmo-test-5", OSMO, "héllo")).toMatchObject({ signature: "c2ln" });
    expect(h.approved.at(-1)).toMatchObject({ method: "cosmos_signArbitrary", params: { signer: OSMO, data: btoa(String.fromCharCode(...new TextEncoder().encode("héllo"))), isString: true } });
    expect(await h.provider.verifyArbitrary("osmo-test-5", OSMO, "x", { pub_key: { type: "t", value: "" }, signature: "" })).toBe(true);
    expect(await h.provider.sendTx("osmo-test-5", new Uint8Array([1, 2, 3]), "sync")).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc]));
    expect(h.reads.map((r) => r.method)).toEqual(["cosmos_verifyArbitrary", "cosmos_sendTx"]);
    await expect(h.dispatcher.dispatch(ORIGIN, "cosmos", "cosmos_sendTx", { tx: "AQ==", mode: "block!" }, "cosmos:osmo-test-5")).rejects.toMatchObject({ code: -32602 });
  });

  it("without a read hook sendTx is unsupported (4200), not approved", async () => {
    const h = harness();
    await h.provider.enable("osmo-test-5");
    await expect(h.provider.sendTx("osmo-test-5", new Uint8Array([1]), "sync")).rejects.toMatchObject({ code: 4200 });
    expect(h.approved).toEqual([]);
  });

  it("account changes fire keystorechange and the namespaced window event; disable forgets the site", async () => {
    const h = harness();
    await h.provider.enable(["osmo-test-5", "pio-testnet-1"]);
    let n = 0;
    let w = 0;
    h.provider.on("keystorechange", () => n++);
    h.win.addEventListener("clipwallet_keystorechange", () => w++);
    h.emit("cosmos", "accountsChanged", []);
    h.emit("evm", "accountsChanged", []);
    expect(n).toBe(1);
    expect(w).toBe(1);
    await h.provider.disable("pio-testnet-1");
    expect([...h.granted]).toEqual([`${ORIGIN}|cosmos`]);
    await h.provider.disable();
    expect([...h.granted]).toEqual([]);
  });

  it("allowlist and table", () => {
    expect([...cosmosInjectedAllowlist("initia")]).toEqual(Object.values(COSMOS_METHODS_ALLOWED).flat());
    expect(cosmosInjectedAllowlist("evm").size).toBe(0);
    for (const c of COSMOS_CHAIN_FACTS) {
      const data = new Uint8Array(20).fill(7);
      expect(bech32Decode(bech32Encode(c.prefix, data))).toEqual({ prefix: c.prefix, data });
    }
    expect(bech32Decode(OSMO.slice(0, -1) + "q")).toBeNull();
  });
});
