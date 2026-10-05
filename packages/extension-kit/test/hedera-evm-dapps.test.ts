/**
 * Dapp matrix regression (docs/r1/dapp-matrix.md): a Hedera EVM dapp (wagmi's hederaTestnet, Scaffold-HBAR) asks the
 * injected EIP-1193 provider for chain 296. The extension's 1Mask registry didn't have it, so the dapp got "Clip
 * Wallet only connects to the networks it ships with". Hedera's EVM is now dapp-reachable without being listed.
 */
import { describe, expect, it } from "vitest";
import { MemoryKV } from "../src/shared/storage";
import config from "./clip.config";
import { createDependencies } from "../src/background/wiring";

const ORIGIN = "https://hedera-dapp.example";
const ME = "0x05ACD02A8E18c130D902FB732bb6AD22DA4f2717";

/** A content-script port and a minimal host: what 1Mask's router needs to answer EIP-1193 calls. */
function wire(dapps: ReturnType<typeof createDependencies>["dapps"]) {
  const granted = new Set<string>();
  const listeners: ((m: unknown) => void)[] = [];
  const out: { id?: string; result?: unknown; error?: { code: number; message: string } }[] = [];
  dapps.start({
    permissions: {
      has: async (o: string, f: string) => granted.has(`${o}|${f}`),
      grant: async (o: string, f: string) => void granted.add(`${o}|${f}`),
      revoke: async () => undefined,
      origins: async () => [],
    },
    accountsFor: async () => [{ address: ME }],
    isUnlocked: () => true,
    preferredNetwork: () => "eip155:11155111",
    cancel: () => undefined,
    approveConnect: async () => true,
    request: async () => null,
    rpc: async () => null,
    chainRead: async () => null,
  } as never);
  dapps.attachPort!({ postMessage: (m: unknown) => void out.push(m as never), onMessage: { addListener: (cb) => void listeners.push(cb) }, onDisconnect: { addListener: () => undefined } }, ORIGIN);
  let n = 0;
  return async (method: string, params?: unknown) => {
    const id = String(++n);
    for (const l of listeners) l({ type: "request", id, origin: ORIGIN, family: "evm", method, params });
    for (let i = 0; i < 100 && !out.some((m) => m.id === id); i++) await new Promise((r) => setTimeout(r, 5));
    const r = out.find((m) => m.id === id)!;
    return r.error ? { code: r.error.code } : { result: r.result };
  };
}

describe("Hedera's EVM for dapps", () => {
  const deps = createDependencies({ kv: new MemoryKV(), mocks: false, config, iconUrl: "x", currency: async () => "USD" });

  it("is a request network (signs and decodes) but never listed or scanned", () => {
    expect(deps.networks.map((n) => n.id)).not.toContain("eip155:296");
    expect(deps.requestNetworks?.map((n) => n.id)).toContain("eip155:296");
    expect(deps.requestNetworks?.map((n) => n.id)).not.toContain("eip155:295");
  });

  it("answers wallet_switchEthereumChain to 296 (0x128) over the injected provider", async () => {
    const call = wire(deps.dapps);
    expect(await call("eth_requestAccounts")).toEqual({ result: [ME] });
    expect(await call("wallet_switchEthereumChain", [{ chainId: "0x128" }])).toEqual({ result: null });
    expect(await call("eth_chainId")).toEqual({ result: "0x128" });
    // Unknown chains still answer 4902 so the dapp can explain.
    expect(await call("wallet_switchEthereumChain", [{ chainId: "0x1" }])).toEqual({ code: 4902 });
  });
});
