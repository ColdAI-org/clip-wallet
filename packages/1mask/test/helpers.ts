import { FAMILIES } from "../src/shared/protocol.js";
import type { DappRequest, Family, Network } from "@clip-wallet/core";
import { Window as HappyWindow } from "happy-dom";
import { createOneMaskRouter, createMemoryPermissionStore, type OneMaskRouterOptions } from "../src/background/index.js";
import { createContentBridge, type RuntimePort } from "../src/content/index.js";

const asset = (key: string, networkId: string) => ({ key, symbol: key.toUpperCase(), name: key, decimals: 18, networkId });

export const NETWORKS: Network[] = [
  { id: "eip155:11155111", family: "evm", name: "Sepolia", chainId: 11155111, nativeAsset: asset("eth", "eip155:11155111"), testnet: true, rpcUrls: ["https://rpc.example/sepolia"], explorerUrl: "https://sepolia.etherscan.io" },
  { id: "eip155:84532", family: "evm", name: "Base Sepolia", chainId: 84532, nativeAsset: asset("eth", "eip155:84532"), testnet: true, rpcUrls: ["https://rpc.example/base"], explorerUrl: "https://sepolia.basescan.org" },
  { id: "eip155:296", family: "evm", name: "Hedera Testnet (EVM)", chainId: 296, nativeAsset: asset("hbar", "eip155:296"), testnet: true, rpcUrls: ["https://testnet.hashio.io/api"], explorerUrl: "https://hashscan.io/testnet" },
  { id: "hedera:testnet", family: "hedera", name: "Hedera Testnet", nativeAsset: asset("hbar", "hedera:testnet"), testnet: true, rpcUrls: [], explorerUrl: "https://hashscan.io/testnet" },
  { id: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", family: "solana", name: "Solana Devnet", nativeAsset: asset("sol", "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"), testnet: true, rpcUrls: ["https://api.devnet.solana.com"], explorerUrl: "https://explorer.solana.com" },
  { id: "bip122:000000000933ea01ad0ee984209779ba", family: "bitcoin", name: "Bitcoin Testnet", nativeAsset: asset("btc", "bip122:000000000933ea01ad0ee984209779ba"), testnet: true, rpcUrls: [], explorerUrl: "https://mempool.space/testnet" },
];

export const EVM_ADDR = "0x1111111111111111111111111111111111111111";
export const SOL_ADDR = "So1anaAddre55111111111111111111111111111111";
export const SOL_PUB = "11".repeat(32);
export const BTC_ADDR = "tb1qexampleaddress0000000000000000000000";
export const BTC_PUB = "02" + "22".repeat(32);

export const ACCOUNTS: Record<Family, { address: string; publicKey?: string; purpose?: string }[]> = {
  ...(Object.fromEntries(FAMILIES.map((f) => [f, []])) as unknown as Record<Family, never[]>),
  evm: [{ address: EVM_ADDR }],
  solana: [{ address: SOL_ADDR, publicKey: SOL_PUB }],
  bitcoin: [{ address: BTC_ADDR, publicKey: BTC_PUB, purpose: "payment" }],
  hedera: [{ address: "0.0.1234" }],
};

export function newWindow(url = "https://dapp.example/app"): Window {
  return new HappyWindow({ url }) as unknown as Window;
}

/** In-memory chrome.runtime.Port pair. */
export function portPair(): { content: RuntimePort; background: RuntimePort & { sent: unknown[] }; disconnectFromBackground(): void } {
  const cListeners: ((m: unknown) => void)[] = [];
  const bListeners: ((m: unknown) => void)[] = [];
  const cDisc: (() => void)[] = [];
  const bDisc: (() => void)[] = [];
  const sent: unknown[] = [];
  const clone = (m: unknown) => JSON.parse(JSON.stringify(m)); // ports JSON-serialise
  const content: RuntimePort = {
    postMessage: (m) => queueMicrotask(() => bListeners.forEach((l) => l(clone(m)))),
    onMessage: { addListener: (cb) => void cListeners.push(cb) },
    onDisconnect: { addListener: (cb) => void cDisc.push(cb) },
    disconnect: () => bDisc.forEach((d) => d()),
  };
  const background = {
    sent,
    postMessage: (m: unknown) => {
      sent.push(m);
      queueMicrotask(() => cListeners.forEach((l) => l(clone(m))));
    },
    onMessage: { addListener: (cb: (m: unknown) => void) => void bListeners.push(cb) },
    onDisconnect: { addListener: (cb: () => void) => void bDisc.push(cb) },
    disconnect: () => cDisc.forEach((d) => d()),
  };
  return { content, background, disconnectFromBackground: () => (bDisc.forEach((d) => d()), cDisc.forEach((d) => d())) };
}

export interface Harness {
  win: Window;
  router: ReturnType<typeof createOneMaskRouter>;
  permissions: ReturnType<typeof createMemoryPermissionStore>;
  handled: DappRequest[];
  ports: ReturnType<typeof portPair>[];
  bridge: ReturnType<typeof createContentBridge>;
  channel: string;
}

/** page window + content bridge + router, wired through fake ports. */
export function makeHarness(
  over: Partial<OneMaskRouterOptions> & { url?: string; channel?: string; handleImpl?: (r: DappRequest) => unknown } = {},
): Harness {
  const win = newWindow(over.url);
  const permissions = createMemoryPermissionStore();
  const handled: DappRequest[] = [];
  const router = createOneMaskRouter({
    networks: NETWORKS,
    permissions,
    accountsFor: (_o, f) => ACCOUNTS[f],
    handle: async (r) => {
      handled.push(r);
      return over.handleImpl ? over.handleImpl(r) : { ok: true };
    },
    ...over,
  });
  const ports: ReturnType<typeof portPair>[] = [];
  const channel = over.channel ?? "test-channel";
  const bridge = createContentBridge({
    channel,
    win,
    connect: () => {
      const p = portPair();
      ports.push(p);
      router.attachPort(p.background, { senderOrigin: win.location.origin });
      return p.content;
    },
  });
  return { win, router, permissions, handled, ports, bridge, channel };
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
