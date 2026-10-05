/**
 * EIP-5792 / ERC-7682 in 1Mask: opt-in on the router and over WalletConnect, validation and error codes per spec,
 * and the backwards-compatibility promise (without `calls` nothing changes).
 */
import type { DappRequest } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { createMemoryPermissionStore, createOneMaskRouter, type CallsHost, type CallsStatus, type OneMaskRouterOptions } from "../src/background/index.js";
import { createWalletConnectWallet, mapProposalNamespaces, type WalletKitLike, type WcSessionLike } from "../src/walletconnect/index.js";
import { parseSendCalls } from "../src/shared/calls.js";
import { EVM_ADDR, NETWORKS, tick } from "./helpers.js";

const O = "https://dapp.example";
const OTHER = "0x2222222222222222222222222222222222222222";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

function host(over: Partial<CallsHost> = {}): CallsHost & { statuses: Map<string, CallsStatus> } {
  const statuses = new Map<string, CallsStatus>();
  return {
    statuses,
    // Base Sepolia can bring in money (e.g. settle on Hedera from Sepolia); nothing else.
    auxiliaryFunds: (ids) => Object.fromEntries(ids.map((id) => [id, id === "eip155:84532" ? { supported: true, assets: [USDC as `0x${string}`] } : undefined])),
    status: async (origin, id) => (origin === O ? statuses.get(id) : undefined),
    show: async (origin, id) => origin === O && statuses.has(id),
    ...over,
  };
}

function make(over: Partial<OneMaskRouterOptions> = {}, withCalls = true) {
  const permissions = createMemoryPermissionStore();
  const handled: DappRequest[] = [];
  const h = host();
  const router = createOneMaskRouter({
    networks: NETWORKS,
    permissions,
    accountsFor: (_o, f) => (f === "evm" ? [{ address: EVM_ADDR }] : []),
    handle: async (r) => (handled.push(r), r.method === "wallet_sendCalls" ? { id: "0xbatch" } : "ok"),
    ...(withCalls ? { calls: h } : {}),
    ...over,
  });
  const d = (method: string, params?: unknown) => router.dispatch(O, { family: "evm", method, params });
  return { router, permissions, handled, d, h };
}

const sendCalls = (over: Record<string, unknown> = {}) => [
  {
    version: "2.0.0",
    chainId: "0x14a34",
    from: EVM_ADDR,
    atomicRequired: false,
    calls: [
      { to: USDC, data: "0x095ea7b3", value: "0x0" },
      { to: OTHER, value: "0x1" },
    ],
    ...over,
  },
];

describe("EIP-5792 off (no calls host): exactly as before", () => {
  it("all four methods stay 4200 unsupported, before and after connecting", async () => {
    const { d, permissions } = make({}, false);
    for (const m of ["wallet_getCapabilities", "wallet_sendCalls", "wallet_getCallsStatus", "wallet_showCallsStatus"]) {
      await expect(d(m, [])).rejects.toMatchObject({ code: 4200 });
    }
    await permissions.grant(O, "evm");
    await expect(d("wallet_getCapabilities", [EVM_ADDR])).rejects.toMatchObject({ code: 4200 });
  });

  it("a host can switch it off for a while (enabled() false → 4200, e.g. another device is signing)", async () => {
    let on = true;
    const { d, permissions } = make({ calls: { ...host(), enabled: () => on } });
    await permissions.grant(O, "evm");
    expect(await d("wallet_getCapabilities", [EVM_ADDR])).toBeTruthy();
    on = false;
    await expect(d("wallet_getCapabilities", [EVM_ADDR])).rejects.toMatchObject({ code: 4200 });
    await expect(d("wallet_sendCalls", sendCalls())).rejects.toMatchObject({ code: 4200 });
  });

  it("other methods are untouched by turning it on", async () => {
    const off = make({}, false);
    const on = make();
    for (const m of ["eth_chainId", "eth_accounts", "net_version", "wallet_getPermissions"]) expect(await on.d(m)).toEqual(await off.d(m));
    await expect(on.d("eth_sign", [])).rejects.toMatchObject({ code: 4200 });
    await expect(on.d("eth_foo", [])).rejects.toMatchObject({ code: 4200 });
  });
});

describe("wallet_getCapabilities", () => {
  it("is for connected sites and own addresses only (4100)", async () => {
    const { d, permissions } = make();
    await expect(d("wallet_getCapabilities", [EVM_ADDR])).rejects.toMatchObject({ code: 4100 });
    await permissions.grant(O, "evm");
    await expect(d("wallet_getCapabilities", [OTHER])).rejects.toMatchObject({ code: 4100 });
  });

  it("answers per chain: atomic unsupported (EOA) and ERC-7682 auxiliaryFunds where available; unknown chains omitted", async () => {
    const { d, permissions } = make();
    await permissions.grant(O, "evm");
    expect(await d("wallet_getCapabilities", [EVM_ADDR, ["0x14a34", "0xaa36a7", "0x1"]])).toEqual({
      "0x14a34": { atomic: { status: "unsupported" }, auxiliaryFunds: { supported: true, assets: [USDC] } },
      "0xaa36a7": { atomic: { status: "unsupported" } },
    });
    const all = (await d("wallet_getCapabilities", [EVM_ADDR])) as Record<string, unknown>;
    expect(Object.keys(all).sort()).toEqual(["0x128", "0x14a34", "0xaa36a7"]);
  });
});

describe("wallet_sendCalls", () => {
  it("needs a connection (4100), an own from, and a known chain (5710)", async () => {
    const { d, permissions, handled } = make();
    await expect(d("wallet_sendCalls", sendCalls())).rejects.toMatchObject({ code: 4100 });
    await permissions.grant(O, "evm");
    await expect(d("wallet_sendCalls", sendCalls({ from: OTHER }))).rejects.toMatchObject({ code: 4100 });
    await expect(d("wallet_sendCalls", sendCalls({ chainId: "0x1" }))).rejects.toMatchObject({ code: 5710 });
    expect(handled).toEqual([]);
  });

  it("refuses atomicRequired (5760), too many calls (5740) and unknown required capabilities (5700); optional ones pass", async () => {
    const { d, permissions, handled } = make();
    await permissions.grant(O, "evm");
    await expect(d("wallet_sendCalls", sendCalls({ atomicRequired: true }))).rejects.toMatchObject({ code: 5760 });
    const many = Array.from({ length: 11 }, () => ({ to: OTHER, value: "0x1" }));
    await expect(d("wallet_sendCalls", sendCalls({ calls: many }))).rejects.toMatchObject({ code: 5740 });
    await expect(d("wallet_sendCalls", sendCalls({ capabilities: { paymasterService: { url: "https://pm.example" } } }))).rejects.toMatchObject({ code: 5700 });
    await expect(
      d("wallet_sendCalls", sendCalls({ calls: [{ to: OTHER, value: "0x1", capabilities: { sessionKeys: {} } }] })),
    ).rejects.toMatchObject({ code: 5700 });
    expect(handled).toEqual([]);
    expect(await d("wallet_sendCalls", sendCalls({ capabilities: { paymasterService: { url: "https://pm.example", optional: true } } }))).toEqual({ id: "0xbatch" });
    expect(handled).toHaveLength(1);
  });

  it("rejects malformed params with -32602", async () => {
    const { d, permissions } = make();
    await permissions.grant(O, "evm");
    for (const bad of [[], [{}], sendCalls({ calls: [] }), sendCalls({ calls: [{ to: "0x12" }] }), sendCalls({ calls: [{ to: OTHER, data: "0xzz" }] }), sendCalls({ version: 2 })]) {
      await expect(d("wallet_sendCalls", bad)).rejects.toMatchObject({ code: -32602 });
    }
  });

  it("sends ONE approval on the request's own chain with normalized params", async () => {
    const { d, permissions, handled } = make();
    await permissions.grant(O, "evm");
    // The site sits on Sepolia; the calls name Base Sepolia: they go there.
    expect(await d("eth_chainId")).toBe("0xaa36a7");
    await d("wallet_sendCalls", sendCalls({ from: undefined, chainId: "0x014a34" }));
    expect(handled).toHaveLength(1);
    expect(handled[0]).toMatchObject({ method: "wallet_sendCalls", networkId: "eip155:84532", via: "injected", origin: O });
    expect((handled[0]!.params as unknown[])[0]).toEqual({
      version: "2.0.0",
      from: EVM_ADDR,
      chainId: "0x14a34",
      atomicRequired: false,
      calls: [
        { to: USDC, data: "0x095ea7b3", value: "0x0" },
        { to: OTHER, data: "0x", value: "0x1" },
      ],
    });
  });

  it("ERC-7682: requiredAssets travel to the host where auxiliary funds exist; 5772 / 5773 otherwise", async () => {
    const { d, permissions, handled } = make();
    await permissions.grant(O, "evm");
    const aux = { auxiliaryFunds: { optional: false, requiredAssets: [{ address: USDC, amount: "0x17d7840", standard: "erc20" }] } };
    await d("wallet_sendCalls", sendCalls({ capabilities: aux }));
    expect((handled[0]!.params as { auxiliaryFunds?: unknown }[])[0]!.auxiliaryFunds).toEqual({ optional: false, requiredAssets: aux.auxiliaryFunds.requiredAssets });
    // Sepolia has no auxiliary funds in this host: required → 5772, optional → dropped.
    await expect(d("wallet_sendCalls", sendCalls({ chainId: "0xaa36a7", capabilities: aux }))).rejects.toMatchObject({ code: 5772 });
    await d("wallet_sendCalls", sendCalls({ chainId: "0xaa36a7", capabilities: { auxiliaryFunds: { ...aux.auxiliaryFunds, optional: true } } }));
    expect((handled[1]!.params as { auxiliaryFunds?: unknown }[])[0]!.auxiliaryFunds).toBeUndefined();
    await expect(d("wallet_sendCalls", sendCalls({ capabilities: { auxiliaryFunds: { requiredAssets: [{ address: USDC, amount: "12", standard: "erc20" }] } } }))).rejects.toMatchObject({ code: 5773 });
    await expect(d("wallet_sendCalls", sendCalls({ capabilities: { auxiliaryFunds: { requiredAssets: [{ address: USDC, amount: "0x1", standard: "erc721" }] } } }))).rejects.toMatchObject({ code: 5773 });
  });

  it("parseSendCalls treats a 1.0 request without atomicRequired as not required", () => {
    const p = parseSendCalls({ version: "1.0", chainId: "0x1", calls: [{ to: OTHER }] }, { auxiliaryFunds: false });
    expect(p.atomicRequired).toBe(false);
  });
});

describe("wallet_getCallsStatus / wallet_showCallsStatus", () => {
  it("answers the host's record for this origin; 5730 for unknown ids", async () => {
    const { d, h } = make();
    const st: CallsStatus = { version: "2.0.0", id: "0xabc", chainId: "0x14a34", status: 100, atomic: false, receipts: [] };
    h.statuses.set("0xabc", st);
    expect(await d("wallet_getCallsStatus", ["0xabc"])).toEqual(st);
    expect(await d("wallet_showCallsStatus", ["0xabc"])).toBeNull();
    await expect(d("wallet_getCallsStatus", ["0xnope"])).rejects.toMatchObject({ code: 5730 });
    await expect(d("wallet_showCallsStatus", ["0xnope"])).rejects.toMatchObject({ code: 5730 });
    await expect(d("wallet_getCallsStatus", [])).rejects.toMatchObject({ code: -32602 });
  });
});

/* ------------------------------------------------------------------ WalletConnect */

const peer = { name: "Dapp", description: "", url: "https://dapp.example", icons: [] };
const proposal = {
  requiredNamespaces: {},
  optionalNamespaces: {
    eip155: {
      chains: ["eip155:11155111", "eip155:84532"],
      methods: ["eth_sendTransaction", "personal_sign", "wallet_getCapabilities", "wallet_sendCalls", "wallet_getCallsStatus", "wallet_showCallsStatus"],
      events: ["chainChanged", "accountsChanged"],
    },
  },
};

async function wc(withCalls: boolean) {
  const handlers = new Map<string, (a: any) => void>();
  const sessions: Record<string, WcSessionLike> = {};
  const log: { name: string; args: any }[] = [];
  const rec = (name: string) => async (args: any) => void log.push({ name, args });
  const kit: WalletKitLike = {
    pair: rec("pair"),
    approveSession: async (args) => {
      log.push({ name: "approveSession", args });
      sessions.t1 = { topic: "t1", expiry: 0, peer: { metadata: peer }, namespaces: args.namespaces };
      return { topic: "t1" };
    },
    rejectSession: rec("rejectSession"),
    respondSessionRequest: rec("respondSessionRequest"),
    disconnectSession: rec("disconnectSession"),
    getActiveSessions: () => sessions,
    emitSessionEvent: rec("emitSessionEvent"),
    updateSession: rec("updateSession"),
    approveSessionAuthenticate: rec("approveSessionAuthenticate"),
    rejectSessionAuthenticate: rec("rejectSessionAuthenticate"),
    formatAuthMessage: () => "",
    on: (e, l) => void handlers.set(e, l),
    off: (e) => void handlers.delete(e),
  };
  const handled: DappRequest[] = [];
  const h = host();
  await createWalletConnectWallet({
    projectId: "test",
    metadata: { name: "Clip Wallet", description: "", url: "https://clip.example", icons: [] },
    networks: NETWORKS,
    addressesFor: (_c, f) => (f === "evm" ? [EVM_ADDR] : []),
    approveProposal: async () => true,
    handle: async (r) => (handled.push(r), { id: "0xbatch" }),
    walletKitFactory: async () => kit,
    ...(withCalls ? { calls: h } : {}),
  });
  const fire = async (e: string, a: any) => (handlers.get(e)!(a), tick(5));
  const request = (id: number, chainId: string, method: string, params: unknown) =>
    fire("session_request", { id, topic: "t1", params: { chainId, request: { method, params } }, verifyContext: { verified: { origin: O, validation: "VALID", verifyUrl: "" } } });
  const last = () => log.filter((c) => c.name === "respondSessionRequest").at(-1)!.args.response;
  await fire("session_proposal", { id: 1, params: { id: 1, proposer: { metadata: peer }, ...proposal } });
  return { log, handled, request, last, h };
}

describe("EIP-5792 over WalletConnect", () => {
  it("off: the session stays as before (methods reported unsupported, no scopedProperties)", async () => {
    const { log } = await wc(false);
    const approve = log.find((c) => c.name === "approveSession")!.args;
    expect(approve.namespaces.eip155.methods).toEqual(["eth_sendTransaction", "personal_sign"]);
    expect(approve.scopedProperties).toBeUndefined();
    const m = mapProposalNamespaces(proposal, { networks: NETWORKS, addressesFor: () => [EVM_ADDR] });
    expect(m.ok && m.unsupported.methods).toEqual(["wallet_getCapabilities", "wallet_sendCalls", "wallet_getCallsStatus", "wallet_showCallsStatus"]);
  });

  it("on: the session serves the methods the app asked for and carries capabilities in CAIP-25 scopedProperties", async () => {
    const { log } = await wc(true);
    const approve = log.find((c) => c.name === "approveSession")!.args;
    expect(approve.namespaces.eip155.methods).toContain("wallet_sendCalls");
    expect(approve.scopedProperties).toEqual({
      "eip155:11155111": { atomic: { status: "unsupported" } },
      "eip155:84532": { atomic: { status: "unsupported" }, auxiliaryFunds: { supported: true, assets: [USDC] } },
    });
  });

  it("answers wallet_getCapabilities for session accounts and chains; status per origin", async () => {
    const { request, last, h } = await wc(true);
    await request(2, "eip155:84532", "wallet_getCapabilities", [EVM_ADDR, ["0x14a34", "0x1"]]);
    expect(last()).toMatchObject({ id: 2, result: { "0x14a34": { atomic: { status: "unsupported" }, auxiliaryFunds: { supported: true } } } });
    await request(3, "eip155:84532", "wallet_getCapabilities", [OTHER]);
    expect(last()).toMatchObject({ id: 3, error: { code: 3001 } });
    await request(4, "eip155:84532", "wallet_getCallsStatus", ["0xnope"]);
    expect(last()).toMatchObject({ id: 4, error: { code: 5730 } });
    h.statuses.set("0xabc", { version: "2.0.0", id: "0xabc", chainId: "0x14a34", status: 200, atomic: false, receipts: [] });
    await request(5, "eip155:84532", "wallet_getCallsStatus", ["0xabc"]);
    expect(last()).toMatchObject({ id: 5, result: { status: 200 } });
  });

  it("forwards wallet_sendCalls as one request on the chain the calls name", async () => {
    const { request, last, handled } = await wc(true);
    await request(6, "eip155:11155111", "wallet_sendCalls", sendCalls());
    expect(handled).toHaveLength(1);
    expect(handled[0]).toMatchObject({ via: "walletconnect", method: "wallet_sendCalls", networkId: "eip155:84532" });
    expect(last()).toMatchObject({ id: 6, result: { id: "0xbatch" } });
    await request(7, "eip155:84532", "wallet_sendCalls", sendCalls({ atomicRequired: true }));
    expect(last()).toMatchObject({ id: 7, error: { code: 5760 } });
    await request(8, "eip155:84532", "wallet_sendCalls", sendCalls({ chainId: "0x1" }));
    expect(last()).toMatchObject({ id: 8, error: { code: 5710 } });
    expect(handled).toHaveLength(1);
  });
});
