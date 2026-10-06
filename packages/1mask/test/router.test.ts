import type { DappRequest } from "@clip-wallet/core";
import { describe, expect, it, vi } from "vitest";
import { createMemoryPermissionStore, createOneMaskRouter, type OneMaskRouterOptions } from "../src/background/index.js";
import { ACCOUNTS, BTC_ADDR, EVM_ADDR, NETWORKS, SOL_ADDR, portPair, tick } from "./helpers.js";

const O = "https://dapp.example";

function make(over: Partial<OneMaskRouterOptions> = {}) {
  const permissions = createMemoryPermissionStore();
  const handled: DappRequest[] = [];
  const router = createOneMaskRouter({
    networks: NETWORKS,
    permissions,
    accountsFor: (_o, f) => ACCOUNTS[f],
    handle: async (r) => (handled.push(r), "signed"),
    ...over,
  });
  const d = (family: any, method: string, params?: unknown, chain?: string) =>
    router.dispatch(O, { family, method, params, chain });
  return { router, permissions, handled, d };
}

describe("audit 1MASK-01: unconnected sites learn nothing from the wallet's state", () => {
  it("only a connected site starts on the balance-derived network or sees whether the wallet is unlocked", async () => {
    const { d } = make({ defaultNetwork: () => "eip155:84532", isUnlocked: () => true });
    expect(await d("evm", "eth_chainId")).toBe("0xaa36a7"); // registry's first network, not where the money is
    expect(((await d("evm", "1mask_getProviderState")) as { isUnlocked: boolean }).isUnlocked).toBe(false);
    await d("evm", "eth_requestAccounts");
    expect(await d("evm", "eth_chainId")).toBe("0x14a34");
    expect(((await d("evm", "1mask_getProviderState")) as { isUnlocked: boolean }).isUnlocked).toBe(true);
  });
});

describe("router: EVM permissions", () => {
  it("does not reveal accounts before the site is connected", async () => {
    const { d, handled } = make();
    expect(await d("evm", "eth_accounts")).toEqual([]);
    expect(await d("evm", "wallet_getPermissions")).toEqual([]);
    const state = (await d("evm", "1mask_getProviderState")) as any;
    expect(state.accounts).toEqual([]);
    expect(handled).toEqual([]);
  });

  it("eth_requestAccounts asks once (via handle), grants, then answers silently", async () => {
    const { d, handled, permissions } = make();
    expect(await d("evm", "eth_requestAccounts")).toEqual([EVM_ADDR]);
    expect(handled).toHaveLength(1);
    expect(handled[0]).toMatchObject({ origin: O, via: "injected", family: "evm", method: "eth_requestAccounts", networkId: "eip155:11155111" });
    expect(await permissions.has(O, "evm")).toBe(true);
    expect(await d("evm", "eth_accounts")).toEqual([EVM_ADDR]);
    expect(await d("evm", "eth_requestAccounts")).toEqual([EVM_ADDR]);
    expect(handled).toHaveLength(1);
  });

  it("a rejected connect stays unconnected and returns 4001", async () => {
    const { d, permissions } = make({ handle: async () => Promise.reject({ code: 4001, message: "no" }) });
    await expect(d("evm", "eth_requestAccounts")).rejects.toMatchObject({ code: 4001 });
    expect(await permissions.has(O, "evm")).toBe(false);
  });

  it("a second connect while one is pending gets -32002", async () => {
    let release!: () => void;
    const { d } = make({ handle: () => new Promise((r) => (release = () => r(true))) });
    const first = d("evm", "eth_requestAccounts");
    await tick();
    await expect(d("evm", "eth_requestAccounts")).rejects.toMatchObject({ code: -32002 });
    release();
    await expect(first).resolves.toEqual([EVM_ADDR]);
  });

  it("signing needs the permission (4100) and an own address", async () => {
    const { d, handled, permissions } = make();
    await expect(d("evm", "personal_sign", ["0x68656c6c6f", EVM_ADDR])).rejects.toMatchObject({ code: 4100 });
    await permissions.grant(O, "evm");
    await expect(d("evm", "personal_sign", ["0x68", "0x2222222222222222222222222222222222222222"])).rejects.toMatchObject({ code: 4100 });
    expect(await d("evm", "personal_sign", ["0x68", EVM_ADDR.toUpperCase().replace("0X", "0x")])).toBe("signed");
    expect(await d("evm", "eth_signTypedData_v4", [EVM_ADDR, "{}"])).toBe("signed");
    expect(await d("evm", "eth_sendTransaction", [{ from: EVM_ADDR, to: EVM_ADDR, value: "0x1" }])).toBe("signed");
    await expect(d("evm", "eth_sendTransaction", [{ from: EVM_ADDR, chainId: "0x1" }])).rejects.toMatchObject({ code: -32602 });
    expect(handled.map((h) => h.method)).toEqual(["personal_sign", "eth_signTypedData_v4", "eth_sendTransaction"]);
  });

  it("wallet_requestPermissions returns an EIP-2255 permission", async () => {
    const { d } = make();
    const perms = (await d("evm", "wallet_requestPermissions", [{ eth_accounts: {} }])) as any[];
    expect(perms[0]).toMatchObject({ parentCapability: "eth_accounts", invoker: O, caveats: [{ type: "restrictReturnedAccounts", value: [EVM_ADDR] }] });
    await expect(d("evm", "wallet_requestPermissions", [{ snap_dialog: {} }])).rejects.toMatchObject({ code: -32602 });
  });

  it("wallet_revokePermissions disconnects and notifies", async () => {
    const { router, d, permissions } = make();
    const p = portPair();
    router.attachPort(p.background, { senderOrigin: O });
    await permissions.grant(O, "evm");
    expect(await d("evm", "wallet_revokePermissions", [{ eth_accounts: {} }])).toBeNull();
    expect(await d("evm", "eth_accounts")).toEqual([]);
    expect(p.background.sent).toContainEqual({ type: "event", family: "evm", event: "accountsChanged", data: [] });
  });
});

describe("router: EVM methods and networks", () => {
  it("rejects eth_sign", async () => {
    const { d, handled, permissions } = make();
    await permissions.grant(O, "evm");
    await expect(d("evm", "eth_sign", [EVM_ADDR, "0x" + "ab".repeat(32)])).rejects.toMatchObject({ code: 4200 });
    expect(handled).toEqual([]);
  });

  it("rejects methods outside the allowlist with 4200", async () => {
    const { d } = make();
    await expect(d("evm", "eth_signTransaction", [{}])).rejects.toMatchObject({ code: 4200 });
    await expect(d("evm", "wallet_watchAsset", [{}])).rejects.toMatchObject({ code: 4200 });
    await expect(d("hedera", "hedera_signTransaction", {})).rejects.toMatchObject({ code: 4200 });
  });

  it("eth_chainId / net_version come from the per-site network", async () => {
    const { d } = make();
    expect(await d("evm", "eth_chainId")).toBe("0xaa36a7");
    expect(await d("evm", "net_version")).toBe("11155111");
  });

  it("wallet_switchEthereumChain: registry chains switch silently and emit chainChanged; unknown → 4902", async () => {
    const { router, d, handled } = make();
    const p = portPair();
    router.attachPort(p.background, { senderOrigin: O });
    expect(await d("evm", "wallet_switchEthereumChain", [{ chainId: "0x14a34" }])).toBeNull();
    expect(await d("evm", "eth_chainId")).toBe("0x14a34");
    expect(p.background.sent).toContainEqual({ type: "event", family: "evm", event: "chainChanged", data: "0x14a34" });
    await expect(d("evm", "wallet_switchEthereumChain", [{ chainId: "0x1" }])).rejects.toMatchObject({ code: 4902 });
    expect(handled).toEqual([]); // no prompt
    // other origins keep their own network
    expect(await router.dispatch("https://other.example", { family: "evm", method: "eth_chainId" })).toBe("0xaa36a7");
  });

  it("wallet_addEthereumChain accepts only registry chains and never adds RPCs", async () => {
    const { d, router } = make();
    await expect(
      d("evm", "wallet_addEthereumChain", [{ chainId: "0x89", chainName: "Polygon", rpcUrls: ["https://evil.example/rpc"] }]),
    ).rejects.toMatchObject({ code: 4001 });
    expect(router.selectedNetwork(O, "evm")?.id).toBe("eip155:11155111");
    expect(await d("evm", "wallet_addEthereumChain", [{ chainId: "0x128", rpcUrls: ["https://evil.example/rpc"] }])).toBeNull();
    expect(router.selectedNetwork(O, "evm")).toMatchObject({ id: "eip155:296", rpcUrls: ["https://testnet.hashio.io/api"] });
  });

  it("Hedera EVM (eip155:296) is family evm by default; familyForNetwork can override", async () => {
    const a = make();
    await a.permissions.grant(O, "evm");
    await a.d("evm", "wallet_switchEthereumChain", [{ chainId: "0x128" }]);
    await a.d("evm", "eth_sendTransaction", [{ from: EVM_ADDR }]);
    expect(a.handled[0]).toMatchObject({ family: "evm", networkId: "eip155:296" });

    const b = make({ familyForNetwork: (n) => (n.id === "eip155:296" ? "hedera" : n.id.startsWith("eip155:") ? "evm" : n.family) });
    await b.permissions.grant(O, "evm");
    await b.d("evm", "wallet_switchEthereumChain", [{ chainId: "0x128" }]);
    await b.d("evm", "eth_sendTransaction", [{ from: EVM_ADDR }]);
    expect(b.handled[0]).toMatchObject({ family: "hedera", networkId: "eip155:296" });
  });

  it("read-only calls are proxied without permission or prompt", async () => {
    const { d, handled } = make({ handle: async (r) => (r.method === "eth_blockNumber" ? "0x10" : null) });
    expect(await d("evm", "eth_blockNumber")).toBe("0x10");
    void handled;
  });
});

describe("router: limits", () => {
  it("rate-limits per origin (-32005)", async () => {
    let t = 0;
    const { router } = make({ now: () => t, rateLimit: { perSecond: 1, burst: 3 } });
    const call = () => router.dispatch(O, { family: "evm", method: "eth_chainId" });
    await call();
    await call();
    await call();
    await expect(call()).rejects.toMatchObject({ code: -32005 });
    expect(await router.dispatch("https://other.example", { family: "evm", method: "eth_chainId" })).toBe("0xaa36a7");
    t += 2000;
    expect(await call()).toBe("0xaa36a7");
  });

  it("caps pending approvals per origin", async () => {
    const { d, permissions } = make({ handle: () => new Promise(() => {}), rateLimit: { maxPendingApprovals: 2 } });
    await permissions.grant(O, "evm");
    void d("evm", "personal_sign", ["0x1", EVM_ADDR]);
    void d("evm", "personal_sign", ["0x2", EVM_ADDR]);
    await tick();
    await expect(d("evm", "personal_sign", ["0x3", EVM_ADDR])).rejects.toMatchObject({ code: -32005 });
  });

  it("times out approvals and tells the wallet to cancel", async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn();
      const { d, permissions } = make({ handle: () => new Promise(() => {}), cancel, timeouts: { approvalMs: 1000 } });
      await permissions.grant(O, "evm");
      const p = d("evm", "personal_sign", ["0x1", EVM_ADDR]);
      const assertion = expect(p).rejects.toMatchObject({ code: -32603 });
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
      expect(cancel).toHaveBeenCalledWith(expect.any(String), "timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps ClipError-like rejections to 4001 and hides internals", async () => {
    const { d } = make({ handle: async () => Promise.reject({ code: "user_rejected", userMessage: "You said no." }) });
    await expect(d("evm", "eth_requestAccounts")).rejects.toMatchObject({ code: 4001 });
    const e = make({ handle: async () => Promise.reject(new Error("db password is hunter2")) });
    const res = (await e.router.dispatch(O, { family: "evm", method: "eth_blockNumber" }).catch((x) => x)) as Error;
    expect(res.message).not.toContain("hunter2");
  });
});

describe("router: ports and origins", () => {
  it("drops requests whose origin differs from the port sender", async () => {
    const { router, handled } = make();
    const p = portPair();
    router.attachPort(p.background, { senderOrigin: O });
    const replies: any[] = [];
    p.content.onMessage.addListener((m) => replies.push(m));
    p.content.postMessage({ type: "request", id: "1", origin: "https://bank.example", family: "evm", method: "eth_requestAccounts" });
    await tick(5);
    expect(replies[0]).toMatchObject({ id: "1", error: { code: 4100 } });
    expect(handled).toEqual([]);
  });

  it("routes events only to the origin's ports and only accounts for permitted families", async () => {
    const { router, permissions } = make();
    const mine = portPair();
    const theirs = portPair();
    router.attachPort(mine.background, { senderOrigin: O });
    router.attachPort(theirs.background, { senderOrigin: "https://other.example" });
    await permissions.grant(O, "evm");
    await router.notifyAccountsChanged("evm");
    expect(mine.background.sent).toEqual([{ type: "event", family: "evm", event: "accountsChanged", data: [EVM_ADDR] }]);
    expect(theirs.background.sent).toEqual([]);
  });
});

describe("router: Solana and Bitcoin", () => {
  const SOL = "solana:devnet";
  it("standard:connect grants; silent state reveals nothing before", async () => {
    const { d, handled } = make();
    expect(await d("solana", "1mask_getAccounts")).toEqual([]);
    await expect(d("solana", "solana:signMessage", { inputs: [{ account: SOL_ADDR, message: "aGk=" }] })).rejects.toMatchObject({ code: 4100 });
    expect(await d("solana", "standard:connect")).toEqual([{ address: SOL_ADDR, publicKey: ACCOUNTS.solana[0]!.publicKey }]);
    expect(handled[0]).toMatchObject({ family: "solana", networkId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" });
    expect(await d("solana", "solana:signMessage", { inputs: [{ account: SOL_ADDR, message: "aGk=" }] })).toBe("signed");
  });

  it("validates accounts and chains on Solana signing", async () => {
    const { d, permissions } = make();
    await permissions.grant(O, "solana");
    await expect(d("solana", "solana:signTransaction", { inputs: [{ account: "someoneElse", transaction: "AA==" }] })).rejects.toMatchObject({ code: 4100 });
    await expect(
      d("solana", "solana:signAndSendTransaction", { inputs: [{ account: SOL_ADDR, transaction: "AA==", chain: "solana:mainnet" }] }, "solana:mainnet"),
    ).rejects.toMatchObject({ code: 4901 });
    expect(await d("solana", "solana:signAndSendTransaction", { inputs: [{ account: SOL_ADDR, transaction: "AA==", chain: SOL }] }, SOL)).toBe("signed");
  });

  it("bitcoin connect and PSBT signing check addresses", async () => {
    const { d, handled } = make();
    expect(await d("bitcoin", "bitcoin:connect", { purposes: ["payment"] })).toEqual([ACCOUNTS.bitcoin[0]]);
    await expect(
      d("bitcoin", "bitcoin:signTransaction", { inputs: [{ psbt: "cHNidP8=", inputsToSign: [{ address: "tb1qother", signingIndexes: [0] }] }] }),
    ).rejects.toMatchObject({ code: 4100 });
    expect(
      await d("bitcoin", "bitcoin:signTransaction", { inputs: [{ psbt: "cHNidP8=", inputsToSign: [{ address: BTC_ADDR, signingIndexes: [0] }] }] }),
    ).toBe("signed");
    expect(handled.at(-1)).toMatchObject({ family: "bitcoin", networkId: "bip122:000000000933ea01ad0ee984209779ba", method: "bitcoin:signTransaction" });
  });

  it("solana:signIn connects as part of signing in", async () => {
    const { d, permissions } = make();
    expect(await d("solana", "solana:signIn", { inputs: [{ domain: "dapp.example" }] })).toBe("signed");
    expect(await permissions.has(O, "solana")).toBe(true);
  });
});

describe("audit 1MASK-L: what pages can do through the wallet without the user", () => {
  const reads = (r: DappRequest) => (r.method === "eth_blockNumber" ? "0x10" : r.method === "eth_call" ? "0x" : "0x1");

  it("an unconnected page only gets cheap chain-state reads through the wallet's RPC", async () => {
    const { d, handled } = make({ handle: async (r) => (handled.push(r), reads(r)) });
    expect(await d("evm", "eth_blockNumber")).toBe("0x10");
    for (const m of ["eth_call", "eth_getLogs", "eth_estimateGas", "eth_getStorageAt", "eth_getCode", "eth_getBalance"]) {
      await expect(d("evm", m, [{}])).rejects.toMatchObject({ code: 4100 });
    }
    expect(handled.map((r) => r.method)).toEqual(["eth_blockNumber"]);
  });

  it("a connected page gets every allowlisted read, still rate-limited per origin and in flight", async () => {
    let t = 0;
    const { d, permissions, handled } = make({ now: () => t, handle: async (r) => (handled.push(r), reads(r)), rateLimit: { readsPerSecond: 1, readBurst: 3 } });
    await permissions.grant(O, "evm");
    expect(await d("evm", "eth_call", [{ to: EVM_ADDR, data: "0x" }, "latest"])).toBe("0x");
    await d("evm", "eth_getBalance", [EVM_ADDR, "latest"]);
    await d("evm", "eth_blockNumber");
    await expect(d("evm", "eth_blockNumber")).rejects.toMatchObject({ code: -32005 });
    // Non-proxied answers (chain id) don't spend read tokens.
    expect(await d("evm", "eth_chainId")).toBe("0xaa36a7");
    t += 1000;
    expect(await d("evm", "eth_blockNumber")).toBe("0x10");

    const slow = make({ handle: () => new Promise(() => {}), rateLimit: { maxInflightReads: 2 } });
    await slow.permissions.grant(O, "evm");
    void slow.d("evm", "eth_blockNumber");
    void slow.d("evm", "eth_blockNumber");
    await tick();
    await expect(slow.d("evm", "eth_blockNumber")).rejects.toMatchObject({ code: -32005 });
  });

  it("after the user declines a connect, the site can't ask again right away (cooldown, growing)", async () => {
    let t = 0;
    let prompts = 0;
    const { d, permissions } = make({ now: () => t, handle: async () => (prompts++, Promise.reject({ code: 4001, message: "no" })) });
    await expect(d("evm", "eth_requestAccounts")).rejects.toMatchObject({ code: 4001 });
    await expect(d("evm", "eth_requestAccounts")).rejects.toMatchObject({ code: 4001 });
    expect(prompts).toBe(1); // the second ask never reached the user
    t += 31_000;
    await expect(d("evm", "eth_requestAccounts")).rejects.toMatchObject({ code: 4001 });
    expect(prompts).toBe(2);
    t += 31_000; // the cooldown doubled after a second decline
    await expect(d("evm", "eth_requestAccounts")).rejects.toMatchObject({ code: 4001 });
    expect(prompts).toBe(2);
    // Other families of the same site and other sites aren't affected.
    await expect(d("solana", "standard:connect", {})).rejects.toMatchObject({ code: 4001 });
    expect(prompts).toBe(3);
    expect(await permissions.has(O, "evm")).toBe(false);
  });
});
