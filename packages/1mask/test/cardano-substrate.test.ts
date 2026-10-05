import type { DappRequest, Family, Network } from "@clip-wallet/core";
import { describe, expect, it, vi } from "vitest";
import {
  CARDANO_METHODS_ALLOWED,
  cardanoSubstrateAllowlist,
  dispatchCardanoSubstrate,
  ss58PublicKey,
  type CardanoSubstrateRouterHelpers,
} from "../src/background/cardano-substrate.js";
import { createMemoryPermissionStore } from "../src/background/permissions.js";
import { createContentBridge } from "../src/content/index.js";
import { APIErrorCode, Cip30Error, DataSignErrorCode, TxSignErrorCode, installCardano, toCip30Error } from "../src/inpage/cardano.js";
import { caip2FromGenesis, installSubstrate } from "../src/inpage/substrate.js";
import { createInpageTransport } from "../src/inpage/transport.js";
import { resolveIdentity } from "../src/shared/config.js";
import { ProviderRpcError, RpcErrorCode, toRpcErrorShape } from "../src/shared/errors.js";
import { portRequestSchema, type PortEvent } from "../src/shared/protocol.js";
import { newWindow, portPair, tick } from "./helpers.js";

const asset = (key: string, networkId: string) => ({ key, symbol: key.toUpperCase(), name: key, decimals: 6, networkId });
const NETS: Network[] = [
  { id: "cip34:0-1", family: "cardano", name: "Cardano Preprod", nativeAsset: asset("ada", "cip34:0-1"), testnet: true, rpcUrls: [], explorerUrl: "" },
  { id: "polkadot:67f9723393ef76214df0118c34bbbd3d", family: "substrate", name: "Westend Asset Hub", nativeAsset: asset("wnd", "polkadot:67f9723393ef76214df0118c34bbbd3d"), testnet: true, rpcUrls: [], explorerUrl: "" },
  { id: "polkadot:e143f23803ac50e8f6f8e62695d1ce9e", family: "substrate", name: "Westend", nativeAsset: asset("wnd", "polkadot:e143f23803ac50e8f6f8e62695d1ce9e"), testnet: true, rpcUrls: [], explorerUrl: "" },
];
const WAH_GENESIS = "0x67f9723393ef76214df0118c34bbbd3dbebc8ed46a10973a8c969d48fe7598c9";

/** Public SS58 test addresses (Alice, generic prefix 42 and Polkadot prefix 0) and her public key. */
const ALICE_42 = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const ALICE_0 = "15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5";
const ALICE_PUB = "d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d";
const ADDR = "00e5d9ccb8b6a2f0b67a0fe5a3c1b1e3e3a6c0d5f1d0d6b8c2a1e4d7f5c3b2a1d0c9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3";

const ACCOUNTS: Partial<Record<Family, { address: string; publicKey?: string }[]>> = {
  cardano: [{ address: ADDR }],
  substrate: [{ address: ALICE_42, publicKey: ALICE_PUB }],
};

/** A miniature router around dispatchCardanoSubstrate, built from the same helpers router.ts has. */
function harness(handle: (r: DappRequest) => unknown) {
  const win = newWindow();
  const permissions = createMemoryPermissionStore();
  const handled: DappRequest[] = [];
  const ports: ReturnType<typeof portPair>[] = [];
  const selected = (family: Family) => NETS.find((n) => n.family === family)!;
  const emit = (event: PortEvent["event"], family: Family, data?: unknown) => {
    for (const p of ports) p.background.postMessage({ type: "event", family, event, data });
  };
  const h: CardanoSubstrateRouterHelpers = {
    permitted: async (o, f) => !!(await permissions.has(o, f)),
    accounts: async (_o, f) => ACCOUNTS[f] ?? [],
    connect: async (o, f, net, method, params) => {
      await h.approve(h.makeReq(o, f, net, method, params));
      await permissions.grant(o, f);
      return ACCOUNTS[f] ?? [];
    },
    approve: async (r) => {
      handled.push(r);
      return handle(r);
    },
    read: async (r) => {
      handled.push(r);
      return handle(r);
    },
    makeReq: (origin, family, net, method, params) => ({ id: `r${handled.length}`, origin, via: "injected", family, networkId: net.id, method, params }),
    requireNetwork: (family, _o, chain) => {
      if (!chain) return selected(family);
      const n = NETS.find((x) => x.family === family && x.id === chain);
      if (!n) throw new ProviderRpcError(RpcErrorCode.ChainDisconnected, `Clip Wallet does not support ${chain}.`);
      return n;
    },
    requirePermission: async (o, f) => {
      if (!(await permissions.has(o, f))) throw new ProviderRpcError(RpcErrorCode.Unauthorized, "Connect Clip Wallet to this site first.");
    },
    revoke: async (o, f) => {
      await permissions.revoke(o, f);
      emit("disconnect", f);
    },
  };
  createContentBridge({
    channel: "t",
    win,
    connect: () => {
      const p = portPair();
      ports.push(p);
      p.background.onMessage.addListener((raw) => {
        const req = portRequestSchema.parse(raw);
        if (!cardanoSubstrateAllowlist(req.family).has(req.method)) {
          p.background.postMessage({ type: "response", id: req.id, error: { code: 4200, message: `unsupported ${req.method}` } });
          return;
        }
        dispatchCardanoSubstrate(h, req.origin, req.family as "cardano" | "substrate", req.method, req.params, req.chain).then(
          (result) => p.background.postMessage({ type: "response", id: req.id, result: result ?? null }),
          (err) => p.background.postMessage({ type: "response", id: req.id, error: toRpcErrorShape(err) }),
        );
      });
      return p.content;
    },
  });
  const transport = createInpageTransport({ channel: "t", win });
  return { win, transport, handled, permissions, emit };
}

describe("CIP-30 connector", () => {
  it("installs window.cardano.<key> with the CIP-30 surface and never overwrites another wallet", () => {
    const { win, transport } = harness(() => null);
    const other = { name: "Other" };
    (win as any).cardano = { eternl: other };
    const inst = installCardano(win, resolveIdentity(), transport)!;
    const w = (win as any).cardano.clipwallet;
    expect(inst.key).toBe("clipwallet");
    expect(w.apiVersion).toBe("1");
    expect(w.name).toBe("Clip Wallet");
    expect(w.icon).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(w.supportedExtensions).toEqual([]);
    expect(typeof w.enable).toBe("function");
    expect((win as any).cardano.eternl).toBe(other);
    expect(installCardano(win, resolveIdentity(), transport)).toBeUndefined();
    inst.destroy();
    expect((win as any).cardano.clipwallet).toBeUndefined();
  });

  it("isEnabled is silent; enable prompts once; read calls need no approval; signTx/signData are approved", async () => {
    const { win, transport, handled } = harness((r) => {
      switch (r.method) {
        case "cardano_enable":
          return true;
        case "cardano_getNetworkId":
          return 0;
        case "cardano_getUtxos":
          return ["82aa"];
        case "cardano_signTx":
          return "a10081825820";
        case "cardano_signData":
          return { signature: "84", key: "a4" };
        default:
          return null;
      }
    });
    const { wallet } = installCardano(win, resolveIdentity(), transport)!;
    expect(await wallet.isEnabled()).toBe(false);
    expect(handled).toHaveLength(0);
    const api = await wallet.enable({ extensions: [{ cip: 95 }] });
    expect(handled.map((r) => r.method)).toEqual(["cardano_enable"]);
    expect(await wallet.isEnabled()).toBe(true);
    expect(await api.getExtensions()).toEqual([]);
    expect(await api.getNetworkId()).toBe(0);
    expect(await api.getUtxos(undefined, { page: 0, limit: 10 })).toEqual(["82aa"]);
    expect(handled.at(-1)).toMatchObject({ method: "cardano_getUtxos", params: [null, { page: 0, limit: 10 }], networkId: "cip34:0-1", family: "cardano" });
    expect(await api.signTx("84a4", true)).toBe("a10081825820");
    expect(handled.at(-1)).toMatchObject({ method: "cardano_signTx", params: ["84a4", true] });
    expect(await api.signData(ADDR, "6869")).toEqual({ signature: "84", key: "a4" });
    // second enable doesn't prompt again
    await wallet.enable();
    expect(handled.filter((r) => r.method === "cardano_enable")).toHaveLength(1);
  });

  it("maps errors to CIP-30 codes", async () => {
    // ClipError-shaped rejections, as the background's DappHost.request throws them.
    const reject = (code: string, msg: string) => {
      throw { code, userMessage: msg };
    };
    const { win, transport } = harness((r) => {
      if (r.method === "cardano_enable") return true;
      if (r.method === "cardano_signTx") reject("user-rejected", "You declined.");
      if (r.method === "cardano_signData") reject("cardano/proof-generation", "That address isn't this account's, so Clip Wallet can't sign for it.");
      if (r.method === "cardano_submitTx") reject("cardano/send-failed", "Cardano rejected this transaction. Nothing was sent.");
      return null;
    });
    const { wallet } = installCardano(win, resolveIdentity(), transport)!;
    const api = await wallet.enable();
    await expect(api.signTx("84", false)).rejects.toMatchObject({ code: TxSignErrorCode.UserDeclined });
    await expect(api.signData(ADDR, "00")).rejects.toMatchObject({ code: DataSignErrorCode.ProofGeneration });
    await expect(api.submitTx("84")).rejects.toMatchObject({ code: 2 });
    await expect(api.signTx("zz")).rejects.toMatchObject({ code: APIErrorCode.InvalidRequest });
    await expect(api.getUtxos(undefined, { page: -1, limit: 1 })).rejects.toBeInstanceOf(Cip30Error);
    expect(toCip30Error({ code: -32603, message: "Clip Wallet can't sign all of this transaction: it also needs other people's signatures." }, "signTx").code).toBe(TxSignErrorCode.ProofGeneration);
    expect(toCip30Error({ code: -32603, message: "That address isn't controlled by a key in Clip Wallet, so it can't sign for it." }, "signData").code).toBe(DataSignErrorCode.AddressNotPK);
  });

  it("refuses API calls before enable and after the account changes or the site is disconnected", async () => {
    const { win, transport, emit } = harness(() => true);
    const { wallet } = installCardano(win, resolveIdentity(), transport)!;
    const api = await wallet.enable();
    emit("accountsChanged", "cardano", []);
    await tick(5);
    await expect(api.getBalance()).rejects.toMatchObject({ code: APIErrorCode.AccountChange });
    const again = await wallet.enable();
    emit("disconnect", "cardano");
    await tick(5);
    await expect(again.getBalance()).rejects.toMatchObject({ code: APIErrorCode.Refused });
  });

  it("an un-enabled site is refused by the router", async () => {
    const { transport } = harness(() => null);
    await expect(transport.request("cardano", "cardano_getBalance", [])).rejects.toMatchObject({ code: RpcErrorCode.Unauthorized });
    expect(CARDANO_METHODS_ALLOWED.signing).toEqual(["cardano_signTx", "cardano_signData"]);
  });
});

describe("injectedWeb3 connector", () => {
  const payload = {
    address: ALICE_0,
    genesisHash: WAH_GENESIS,
    method: "0x0a03",
    blockHash: `0x${"ab".repeat(32)}`,
    blockNumber: "0x01",
    era: "0x00",
    nonce: "0x00",
    specVersion: "0x01",
    tip: "0x00",
    transactionVersion: "0x01",
    signedExtensions: [],
    version: 4,
  };

  it("leaves window.injectedWeb3 assignable: @polkadot/extension-dapp's strict-mode `win.injectedWeb3 = win.injectedWeb3 || {}` must not throw", () => {
    const { win, transport } = harness(() => true);
    installSubstrate(win, resolveIdentity(), transport);
    const w = win as unknown as { injectedWeb3: Record<string, unknown> };
    expect(() => {
      "use strict";
      w.injectedWeb3 = w.injectedWeb3 || {};
    }).not.toThrow();
    expect(Object.keys(w.injectedWeb3)).toEqual(["clip-wallet"]);
  });

  it("installs window.injectedWeb3[name] and enables with accounts, metadata and signer", async () => {
    const { win, transport, handled } = harness((r) => {
      if (r.method === "substrate_signPayload") return { signature: `0x01${"11".repeat(64)}` };
      if (r.method === "substrate_signRaw") return { signature: `0x01${"22".repeat(64)}` };
      return true;
    });
    const inst = installSubstrate(win, resolveIdentity(), transport)!;
    expect(inst.name).toBe("clip-wallet");
    const ext = (win as any).injectedWeb3["clip-wallet"];
    expect(ext.version).toBe("1.0.0");
    const injected = await ext.enable("My Dapp");
    expect(handled[0]).toMatchObject({ method: "substrate_enable", params: { originName: "My Dapp" } });
    expect(await injected.accounts.get()).toEqual([{ address: ALICE_42, genesisHash: null, name: "Clip Wallet", type: "sr25519" }]);
    expect(await injected.metadata.provide({})).toBe(false);
    expect(await injected.metadata.get()).toEqual([]);

    // signPayload with the account in another SS58 format, routed to the payload's network
    const r1 = await injected.signer.signPayload(payload);
    expect(r1).toEqual({ id: 1, signature: `0x01${"11".repeat(64)}` });
    expect(handled.at(-1)).toMatchObject({ method: "substrate_signPayload", networkId: "polkadot:67f9723393ef76214df0118c34bbbd3d", params: payload });
    const r2 = await injected.signer.signRaw({ address: ALICE_42, data: "0x6869", type: "bytes" });
    expect(r2).toEqual({ id: 2, signature: `0x01${"22".repeat(64)}` });
  });

  it("refuses accounts that aren't connected and networks outside the registry", async () => {
    const { win, transport } = harness(() => ({ signature: "0x01" }));
    const { provider } = installSubstrate(win, resolveIdentity(), transport)!;
    const injected = await provider.enable("x");
    const bob = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";
    await expect(injected.signer.signRaw({ address: bob, data: "0x00", type: "bytes" })).rejects.toMatchObject({ code: RpcErrorCode.Unauthorized });
    await expect(injected.signer.signPayload({ ...payload, genesisHash: `0x${"99".repeat(32)}` })).rejects.toMatchObject({ code: RpcErrorCode.ChainDisconnected });
  });

  it("subscribe delivers the current accounts and later changes", async () => {
    const { win, transport, emit } = harness(() => true);
    const { provider } = installSubstrate(win, resolveIdentity(), transport)!;
    const injected = await provider.enable("x");
    const seen: unknown[] = [];
    const unsub = injected.accounts.subscribe((a) => void seen.push(a.map((x) => x.address)));
    // Wait for each delivery rather than a fixed delay: under parallel load the first fetch can take longer.
    await vi.waitFor(() => expect(seen).toEqual([[ALICE_42]]));
    emit("accountsChanged", "substrate", []);
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    unsub();
    emit("accountsChanged", "substrate", [{ address: ALICE_42 }]);
    await tick(10);
    expect(seen).toEqual([[ALICE_42], []]);
  });

  it("decodes SS58 public keys for any prefix", () => {
    expect(ss58PublicKey(ALICE_42)).toBe(ALICE_PUB);
    expect(ss58PublicKey(ALICE_0)).toBe(ALICE_PUB);
    expect(ss58PublicKey("not-an-address")).toBeNull();
    expect(caip2FromGenesis(WAH_GENESIS)).toBe("polkadot:67f9723393ef76214df0118c34bbbd3d");
  });
});
