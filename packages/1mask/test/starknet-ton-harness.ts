import type { DappRequest, Family, Network } from "@clip-wallet/core";
import { createStarknetTonDispatch, type StarknetTonHelpers, type StarknetTonOptions, type TonAddrItem } from "../src/background/starknet-ton.js";
import type { EventListener, InpageTransport } from "../src/inpage/transport.js";
import { fromRpcErrorShape, toRpcErrorShape } from "../src/shared/errors.js";
import type { ExposedAccount, OneMaskEvent } from "../src/shared/protocol.js";

const asset = (key: string, networkId: string) => ({ key, symbol: key.toUpperCase(), name: key, decimals: 9, networkId });

export const SN_NETS: Network[] = [
  { id: "starknet:SN_SEPOLIA", family: "starknet", name: "Starknet Sepolia", nativeAsset: asset("strk", "starknet:SN_SEPOLIA"), testnet: true, rpcUrls: [], explorerUrl: "" },
  { id: "starknet:SN_MAIN", family: "starknet", name: "Starknet", nativeAsset: asset("strk", "starknet:SN_MAIN"), testnet: false, rpcUrls: [], explorerUrl: "" },
];
export const TON_NETS: Network[] = [
  { id: "ton:-3", family: "ton", name: "TON Testnet", nativeAsset: asset("gram", "ton:-3"), testnet: true, rpcUrls: [], explorerUrl: "" },
];

export const SN_ADDR = "0x048401b784bec323163553a02802c5b58dd579c9296207f9b26d6bcd75af4f37";
export const TON_ADDR_ITEM: TonAddrItem = { name: "ton_addr", address: "0:" + "ab".repeat(32), network: "-3", publicKey: "cd".repeat(32), walletStateInit: "te6cc..." };

/**
 * The router's side, in memory: permissions, per-site network, approvals and events, wired to the real
 * createStarknetTonDispatch. Errors leave it the way the router's do (ProviderRpcError {code, message}).
 */
export function makeBackground(
  o: { origin?: string; approve?: (r: DappRequest) => unknown; connectOk?: boolean } & StarknetTonOptions = {},
) {
  const origin = o.origin ?? "https://dapp.example";
  const perms = new Set<Family>();
  const selected = new Map<Family, string>();
  const approvals: DappRequest[] = [];
  const connects: { family: Family; method: string; params: unknown }[] = [];
  const events: { family: Family; event: OneMaskEvent; data: unknown }[] = [];
  const listeners = new Set<EventListener>();
  const nets = [...SN_NETS, ...TON_NETS];
  const accounts: Record<string, ExposedAccount[]> = { starknet: [{ address: SN_ADDR, publicKey: "05ea" }], ton: [{ address: TON_ADDR_ITEM.address }] };
  let seq = 0;
  const helpers: StarknetTonHelpers = {
    permitted: async (_o, f) => perms.has(f),
    accounts: async (_o, f) => (perms.has(f) ? (accounts[f] ?? []) : []),
    connect: async (_o, family, _net, method, params) => {
      connects.push({ family, method, params });
      if (o.connectOk === false) throw Object.assign(new Error("You declined to connect."), { code: 4001 });
      perms.add(family);
      helpers.emit(origin, family, "accountsChanged", accounts[family]);
      return accounts[family] ?? [];
    },
    approve: async (r) => {
      approvals.push(r);
      return o.approve ? o.approve(r) : { ok: true };
    },
    makeReq: (orig, family, net, method, params) => ({ id: `r${++seq}`, origin: orig, via: "injected", family, networkId: net.id, method, params }),
    selectedNetwork: (_o, f) => nets.find((n) => n.id === selected.get(f)) ?? nets.find((n) => n.family === f),
    setSelected: (_o, f, id) => void selected.set(f, id),
    candidates: (f) => nets.filter((n) => n.family === f),
    emit: (_o, family, event, data) => {
      events.push({ family, event, data });
      for (const l of listeners) l(family, event, data);
    },
    revoke: async (_o, f, opts) => {
      const had = perms.delete(f);
      if (had && !opts?.silent) {
        helpers.emit(origin, f, "accountsChanged", []);
        helpers.emit(origin, f, "disconnect");
      }
    },
  };
  const dispatch = createStarknetTonDispatch(helpers, o);
  const transport: InpageTransport = {
    async request(family, method, params) {
      try {
        // Ports JSON-serialise, so params/results are cloned the way the real hops clone them.
        const p = params === undefined ? undefined : JSON.parse(JSON.stringify(params));
        const res = family === "starknet" ? await dispatch.starknet(origin, method, p) : await dispatch.ton(origin, method, p);
        return res === undefined ? null : JSON.parse(JSON.stringify(res));
      } catch (e) {
        throw fromRpcErrorShape(toRpcErrorShape(e));
      }
    },
    onEvent(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    destroy() {
      listeners.clear();
    },
  };
  return { origin, perms, approvals, connects, events, helpers, transport, revoke: (f: Family) => helpers.revoke(origin, f) };
}
