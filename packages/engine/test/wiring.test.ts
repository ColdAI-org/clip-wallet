import { describe, expect, it } from "vitest";
import { defineConfig } from "@clip-wallet/config";
import { createEngineDependencies } from "../src/wiring.js";
import { publicNetworks } from "../src/public-networks.js";
import { FakeVault } from "./fixtures.js";

const config = defineConfig({ name: "Clip Wallet", rdns: "org.coldai.clipwallet", networks: ["evm:*", "hedera", "solana", "bitcoin"], mainnet: false, walletConnect: {} });

describe("createEngineDependencies (real packages)", () => {
  const deps = createEngineDependencies({
    config,
    vault: new FakeVault(),
    hashPayload: (p) => p.bytes,
    currency: async () => "USD",
    walletConnect: { projectId: undefined, url: "https://clipwallet.example", iconUrl: "https://clipwallet.example/icon.png" },
  });

  it("ships testnets only, for the four Phase 1 families", () => {
    expect(deps.networks.length).toBeGreaterThan(3);
    expect(deps.networks.every((n) => n.testnet)).toBe(true);
    expect(new Set(deps.networks.map((n) => n.family))).toEqual(new Set(["evm", "hedera", "solana", "bitcoin"]));
    expect(Object.keys(deps.chains).sort()).toEqual(["bitcoin", "evm", "hedera", "solana"]);
  });

  it("switches WalletConnect off plainly when there is no project id", async () => {
    expect(deps.walletConnect.enabled).toBe(false);
    await expect(deps.walletConnect.pair("wc:x")).rejects.toMatchObject({ code: "walletconnect/no-project-id" });
  });

  it("gives the inpage providers one public RPC per network", () => {
    expect(publicNetworks(deps.networks).every((n) => n.rpcUrls.length <= 1)).toBe(true);
  });
});

describe("createEngineDependencies with all 14 families", () => {
  const all = defineConfig({
    name: "Clip Wallet",
    rdns: "org.coldai.clipwallet",
    networks: ["evm:*", "hedera", "solana", "bitcoin", "sui", "aptos", "cardano", "substrate", "starknet", "ton", "near", "stellar", "tezos", "algorand"],
    mainnet: false,
  });
  const deps = createEngineDependencies({
    config: all,
    vault: new FakeVault(),
    hashPayload: (p) => p.bytes,
    currency: async () => "USD",
    walletConnect: { projectId: undefined, url: "https://clipwallet.example", iconUrl: "https://clipwallet.example/icon.png" },
  });

  it("registers a module per family, testnets only, and shares one USDC key across families", () => {
    expect(Object.keys(deps.chains).sort()).toEqual(
      ["algorand", "aptos", "bitcoin", "cardano", "evm", "hedera", "near", "solana", "starknet", "stellar", "substrate", "sui", "tezos", "ton"],
    );
    for (const [f, m] of Object.entries(deps.chains)) expect(m!.family).toBe(f);
    expect(deps.networks.every((n) => n.testnet)).toBe(true);
    const usdc = new Set(deps.assets.filter((a) => a.symbol === "USDC" && !a.bridged).map((a) => a.networkId.split(":")[0]));
    for (const ns of ["eip155", "hedera", "solana", "sui", "aptos", "near", "stellar", "algorand", "starknet"]) expect(usdc.has(ns), ns).toBe(true);
    expect(new Set(deps.assets.filter((a) => a.symbol === "USDC" && !a.bridged).map((a) => a.key))).toEqual(new Set(["usdc"]));
  });

  it("has no backup service unless clip.config sets one", () => {
    expect(deps.backup).toBeNull();
  });
});

/**
 * Dapp matrix regression (docs/r1/dapp-matrix.md): Hedera EVM dapps ask the EIP-1193 provider for chain 296; it wasn't
 * in 1Mask's registry unless settle-on-Hedera was on. It is dapp-reachable whenever the wallet has Hedera.
 */
describe("Hedera's EVM for dapps (without settle on Hedera)", () => {
  const cfg = defineConfig({ name: "Clip Wallet", rdns: "org.coldai.clipwallet", networks: ["evm:*", "hedera"], mainnet: false, walletConnect: {}, route: { settleOnHedera: false } });
  const deps = createEngineDependencies({
    config: cfg,
    vault: new FakeVault(),
    hashPayload: (p) => p.bytes,
    currency: async () => "USD",
    walletConnect: { projectId: undefined, url: "https://clipwallet.example", iconUrl: "https://clipwallet.example/icon.png" },
  });

  it("is a request network but never listed", () => {
    expect(deps.networks.map((n) => n.id)).not.toContain("eip155:296");
    expect(deps.requestNetworks?.map((n) => n.id)).toEqual(["eip155:296"]);
  });

  it("answers wallet_switchEthereumChain to 0x128 over the injected provider", async () => {
    const origin = "https://hedera-dapp.example";
    const granted = new Set<string>();
    const listeners: ((m: unknown) => void)[] = [];
    const out: { id?: string; result?: unknown; error?: { code: number } }[] = [];
    deps.dapps.start({
      permissions: { has: async (o: string, f: string) => granted.has(`${o}|${f}`), grant: async (o: string, f: string) => void granted.add(`${o}|${f}`), revoke: async () => undefined, origins: async () => [] },
      accountsFor: async () => [{ address: "0x05ACD02A8E18c130D902FB732bb6AD22DA4f2717" }],
      isUnlocked: () => true,
      preferredNetwork: () => "eip155:11155111",
      cancel: () => undefined,
      approveConnect: async () => true,
    } as never);
    deps.dapps.attachPort!({ postMessage: (m: unknown) => void out.push(m as never), onMessage: { addListener: (cb: (m: unknown) => void) => void listeners.push(cb) }, onDisconnect: { addListener: () => undefined } }, origin);
    const call = async (id: string, method: string, params?: unknown) => {
      for (const l of listeners) l({ type: "request", id, origin, family: "evm", method, params });
      for (let i = 0; i < 100 && !out.some((m) => m.id === id); i++) await new Promise((r) => setTimeout(r, 5));
      return out.find((m) => m.id === id);
    };
    await call("1", "eth_requestAccounts");
    expect(await call("2", "wallet_switchEthereumChain", [{ chainId: "0x128" }])).toMatchObject({ result: null });
    expect(await call("3", "eth_chainId")).toMatchObject({ result: "0x128" });
  });
});
