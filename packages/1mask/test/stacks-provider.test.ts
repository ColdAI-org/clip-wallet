import type { DappRequest, Family, Network } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { createStacksDispatcher, stacksInjectedAllowlist } from "../src/background/stacks.js";
import { DEFAULT_IDENTITY } from "../src/shared/config.js";
import { rpcError } from "../src/shared/errors.js";
import type { ExposedAccount } from "../src/shared/protocol.js";
import { STACKS_INJECTED, stacksAddressOn, stacksChainHint } from "../src/shared/stacks.js";
import { ClipStacksProvider, installStacksProvider, toSip030Error } from "../src/inpage/stacks.js";
import type { InpageTransport } from "../src/inpage/transport.js";
import { newWindow } from "./helpers.js";

/** The public "abandon … about" Stacks account 0 (chains-stacks test/signatures.ts). */
const SP = "SPC5KHM41H6WHAST7MWWDD807YSPRQKJ69FSH54J";
const ST = "STC5KHM41H6WHAST7MWWDD807YSPRQKJ68T330BQ";
const PUB = "03d5d038bce81b3965314dba54f636f093c7dbdd6617cded013a53474fbccb100c";
const OTHER_ST = "ST3XHES5990FYDV5BHBZCJRFYFD2Z4X3FMEXRWMFR";

const asset = (networkId: string) => ({ key: "stx", symbol: "STX", name: "Stacks", decimals: 6, networkId });
const TESTNET: Network = { id: "stacks:2147483648", family: "stacks", name: "Stacks Testnet", nativeAsset: asset("stacks:2147483648"), testnet: true, rpcUrls: [], explorerUrl: "" };
const MAINNET: Network = { id: "stacks:1", family: "stacks", name: "Stacks", nativeAsset: asset("stacks:1"), testnet: false, rpcUrls: [], explorerUrl: "" };

function fakeRouter(opts: { permitted?: boolean; approve?: (r: DappRequest) => unknown } = {}) {
  let permitted = opts.permitted ?? false;
  const approved: DappRequest[] = [];
  const accounts: ExposedAccount[] = [{ address: SP, publicKey: PUB }];
  const r = {
    permitted: async () => permitted,
    requirePermission: async () => {
      if (!permitted) throw rpcError.unauthorized();
    },
    accounts: async () => accounts,
    connect: async () => {
      permitted = true;
      return accounts;
    },
    approve: async (req: DappRequest) => {
      approved.push(req);
      return opts.approve ? opts.approve(req) : { txid: "ab".repeat(32) };
    },
    makeReq: (origin: string, family: Family, net: Network, method: string, params: unknown): DappRequest => ({ id: "1", origin, via: "injected", family, networkId: net.id, method, params }),
    requireNetwork: (_f: Family, _o: string, chain: string | undefined) => (chain === MAINNET.id ? MAINNET : TESTNET),
    revoke: async () => {
      permitted = false;
    },
    networks: () => [TESTNET, MAINNET],
  };
  return { r, approved, d: createStacksDispatcher(r) };
}

/** Inpage transport straight into the dispatcher (no content script), origin fixed. */
function direct(d: ReturnType<typeof createStacksDispatcher>, origin = "https://app.example"): InpageTransport {
  return {
    request: (family, method, params, chain) => d.dispatch(origin, family, method, params, chain),
    onEvent: () => () => {},
    destroy: () => {},
  };
}

describe("Stacks addresses per network", () => {
  it("re-spells the mainnet SP address as ST on testnet (checksum verified)", async () => {
    expect(await stacksAddressOn(SP, TESTNET.id)).toBe(ST);
    expect(await stacksAddressOn(ST, MAINNET.id)).toBe(SP);
    expect(await stacksAddressOn(SP.slice(0, -1) + "K", TESTNET.id)).toBeUndefined();
    expect(await stacksAddressOn("0x1234", TESTNET.id)).toBeUndefined();
    expect(await stacksAddressOn("SP000000000000000000002Q6VF78", TESTNET.id)).toBe("ST000000000000000000002AMW42H");
    expect(stacksChainHint("testnet")).toBe(TESTNET.id);
    expect(stacksChainHint("devnet")).toBeUndefined();
  });
});

describe("background dispatcher", () => {
  it("connects with the testnet spelling and lets signing through only after connect", async () => {
    const { d, approved } = fakeRouter();
    expect(await d.dispatch("https://app.example", "stacks", STACKS_INJECTED.accounts, undefined, undefined)).toEqual([]);
    await expect(d.dispatch("https://app.example", "stacks", "stx_transferStx", { recipient: OTHER_ST, amount: "1" }, undefined)).rejects.toMatchObject({ code: 4100 });
    expect(await d.dispatch("https://app.example", "stacks", STACKS_INJECTED.connect, {}, undefined)).toEqual([{ address: ST, publicKey: PUB }]);
    await d.dispatch("https://app.example", "stacks", "stx_transferStx", { recipient: OTHER_ST, amount: "1" }, undefined);
    expect(approved[0]).toMatchObject({ family: "stacks", networkId: TESTNET.id, method: "stx_transferStx" });
  });

  it("refuses a signer address that isn't connected, and unknown methods", async () => {
    const { d } = fakeRouter({ permitted: true });
    await expect(d.dispatch("https://app.example", "stacks", "stx_signMessage", { message: "hi", address: OTHER_ST }, undefined)).rejects.toMatchObject({ code: 4100 });
    await d.dispatch("https://app.example", "stacks", "stx_signMessage", { message: "hi", address: ST }, undefined);
    await expect(d.dispatch("https://app.example", "stacks", "stx_getAccounts", {}, undefined)).rejects.toMatchObject({ code: 4200 });
    expect(stacksInjectedAllowlist().has("stx_callContract")).toBe(true);
    expect(stacksInjectedAllowlist().has("stx_updateProfile")).toBe(false);
  });

  it("answers stx_getNetworks", async () => {
    const { d } = fakeRouter({ permitted: true });
    expect(await d.dispatch("https://app.example", "stacks", "stx_getNetworks", undefined, undefined)).toEqual({
      active: "testnet",
      networks: [
        { id: "testnet", chainId: 2147483648, transactionVersion: 128 },
        { id: "mainnet", chainId: 1, transactionVersion: 0 },
      ],
    });
  });
});

describe("injected SIP-030 provider", () => {
  it("registers on window.clipwallet.stacks and WBIP-004 without touching other wallets", () => {
    const win = newWindow();
    const leather = { request: () => "leather" };
    const others = [{ id: "LeatherProvider", name: "Leather", icon: "data:," }];
    Object.assign(win, { LeatherProvider: leather, wbip_providers: others });
    const { provider, entry, stop } = installStacksProvider(win, DEFAULT_IDENTITY, [TESTNET], direct(fakeRouter().d));
    const w = win as unknown as Record<string, any>;
    expect(w.wbip_providers).toBe(others);
    expect(w.wbip_providers.map((p: { id: string }) => p.id)).toEqual(["LeatherProvider", "clipwallet.stacks"]);
    expect(entry).toMatchObject({ name: "Clip Wallet", icon: DEFAULT_IDENTITY.icon });
    expect(entry.methods).toContain("stx_signMessage");
    // @stacks/connect-ui getProviderFromId
    expect(entry.id.split(".").reduce((o: any, k) => o?.[k], win)).toBe(provider);
    expect(w.LeatherProvider).toBe(leather);
    expect(w.StacksProvider).toBeUndefined();
    stop();
    expect(w.wbip_providers.map((p: { id: string }) => p.id)).toEqual(["LeatherProvider"]);
  });

  it("creates the registry when none exists and uses a kit wallet's own identity", () => {
    const win = newWindow();
    const { entry } = installStacksProvider(win, { name: "Acme Wallet", icon: DEFAULT_IDENTITY.icon, rdns: "com.acme" }, [TESTNET], direct(fakeRouter().d), { globalKey: "acme" });
    expect((win as unknown as { wbip_providers: unknown[] }).wbip_providers).toEqual([entry]);
    expect(entry).toMatchObject({ id: "acme.stacks", name: "Acme Wallet" });
  });

  it("request() answers JSON-RPC responses the way @stacks/connect reads them", async () => {
    const { d } = fakeRouter({ approve: (r) => (r.method === "stx_signMessage" ? { signature: "aa", publicKey: PUB } : { txid: "cd".repeat(32) }) });
    const p = new ClipStacksProvider(DEFAULT_IDENTITY, [TESTNET], direct(d));
    const seen: unknown[] = [];
    const unlisten = p.listen("stx_accountChange", (a) => seen.push(a));
    const res = await p.request("getAddresses");
    expect(res).toMatchObject({ jsonrpc: "2.0", result: { addresses: [{ symbol: "STX", address: ST, publicKey: PUB }] } });
    expect(seen).toEqual([[{ address: ST, publicKey: PUB }]]);
    unlisten();
    expect(await p.request("stx_signMessage", { message: "hello" })).toMatchObject({ result: { signature: "aa", publicKey: PUB } });
    expect(await p.request("stx_transferStx", { recipient: OTHER_ST, amount: "1", network: "testnet" })).toMatchObject({ result: { txid: "cd".repeat(32) } });
    await expect(p.request("stx_transferStx", { recipient: OTHER_ST, amount: "1", network: "devnet" })).rejects.toMatchObject({ jsonrpc: "2.0", error: { code: -32602 } });
    await expect(p.request("stx_updateProfile", {})).rejects.toMatchObject({ error: { code: -32601 } });
  });

  it("maps rejections to SIP-030 codes", () => {
    expect(toSip030Error(rpcError.userRejected()).code).toBe(-32000);
    expect(toSip030Error(rpcError.unauthorized()).code).toBe(-32002);
    expect(toSip030Error(rpcError.invalidParams("x")).code).toBe(-32602);
    expect(toSip030Error(new Error("boom")).code).toBe(-32603);
  });
});
