import { describe, expect, it } from "vitest";
import { WalletEngine } from "../src/engine.js";
import { MemoryKV, JsonKV } from "../src/kv.js";
import { createEngineClient } from "../src/client.js";
import { createFeatureHost } from "../src/features.js";
import { ClipError, WALLET_ORIGIN, isWalletOrigin, type DappRequest } from "@clip-wallet/core";
import { BASE_SEPOLIA, EVM_ADDRESS, FakeVault, SEPOLIA, fakePort, makeDeps, makeEnv, tick } from "./fixtures.js";

const ORIGIN = "https://dapp.test";

async function unlocked(onApproval?: (id: string) => void) {
  const vault = new FakeVault();
  const deps = makeDeps(vault);
  const env = makeEnv(onApproval);
  const kv = new MemoryKV();
  const engine = new WalletEngine(deps, kv, env);
  engine.start();
  await engine.handle({ type: "createWallet", password: "a long test password" });
  return { engine, vault, deps, env, kv };
}

describe("WalletEngine: lifecycle", () => {
  it("starts empty, creates, locks and unlocks", async () => {
    const vault = new FakeVault();
    const engine = new WalletEngine(makeDeps(vault), new MemoryKV(), makeEnv());
    expect((await engine.handle({ type: "getState" })).status).toBe("empty");
    await engine.handle({ type: "createWallet", password: "a long test password" });
    expect((await engine.handle({ type: "getState" })).status).toBe("unlocked");
    await engine.handle({ type: "lock" });
    await expect(engine.handle({ type: "getPortfolio" })).rejects.toMatchObject({ code: "vault/locked" });
    await engine.handle({ type: "unlock", password: "a long test password" });
    expect(engine.cachedAccount("evm")?.address).toBe(EVM_ADDRESS);
  });

  it("validates untrusted input with the shared schema", async () => {
    const { engine } = await unlocked();
    await expect(engine.handleUntrusted({ type: "send", assetKey: "eth", networkId: SEPOLIA.id, to: "x", amount: "-1" })).rejects.toMatchObject({ code: "bus/invalid" });
    await expect(engine.handleUntrusted({ type: "nope" })).rejects.toMatchObject({ code: "bus/invalid" });
  });

  it("arms auto-lock from prefs on unlock and on every call", async () => {
    const { engine, env } = await unlocked();
    await engine.handle({ type: "setPrefs", patch: { autoLockMinutes: 5 } });
    await engine.handle({ type: "getState" });
    expect(env.locks.at(-1)).toBe(5);
  });

  it("works over a string store (AsyncStorage-shaped)", async () => {
    const m = new Map<string, string>();
    const kv = new JsonKV({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }, "clip:");
    const engine = new WalletEngine(makeDeps(new FakeVault()), kv, makeEnv());
    await engine.handle({ type: "createWallet", password: "a long test password" });
    await engine.handle({ type: "setPrefs", patch: { advanced: true } });
    expect(JSON.parse(m.get("clip:clip/prefs")!).advanced).toBe(true);
  });
});

describe("WalletEngine: portfolio, send, receive", () => {
  it("sums balances into one portfolio with fiat values", async () => {
    const { engine } = await unlocked();
    const p = await engine.handle({ type: "getPortfolio" });
    expect(p.balances).toHaveLength(1);
    expect(p.balances[0]!.fiatValue).toBeCloseTo(1500);
    expect(p.networks.map((n) => n.id)).toEqual([SEPOLIA.id, BASE_SEPOLIA.id]);
  });

  it("asks which network when an address fits several (network-matters), then remembers", async () => {
    const { engine } = await unlocked();
    const to = "0x000000000000000000000000000000000000dEaD";
    const r = await engine.handle({ type: "resolveRecipient", input: to, assetKey: "eth" });
    expect(r.kind).toBe("ask");
    if (r.kind !== "ask") return;
    expect(r.candidates.find((c) => c.network.id === SEPOLIA.id)!.balance).toBe("500000000000000000");
    await engine.handle({ type: "rememberRecipientNetwork", address: to, assetKey: "eth", networkId: BASE_SEPOLIA.id });
    expect(await engine.handle({ type: "resolveRecipient", input: to, assetKey: "eth" })).toMatchObject({ kind: "resolved", networkId: BASE_SEPOLIA.id });
  });

  it("rejects text that isn't an address", async () => {
    const { engine } = await unlocked();
    expect(await engine.handle({ type: "resolveRecipient", input: "hello", assetKey: "eth" })).toMatchObject({ kind: "invalid" });
  });

  it("keeps the chain module's reason when it can't decode a request (dapp matrix regression)", async () => {
    const { engine, deps } = await unlocked();
    deps.evm.decode = async () => {
      throw new ClipError("You don't have enough ETH to send this amount and pay the network fee.", "insufficient-funds");
    };
    const id = await engine.handle({ type: "send", assetKey: "eth", networkId: SEPOLIA.id, to: "0x000000000000000000000000000000000000dEaD", amount: "0.1" });
    const d = (await engine.handle({ type: "getApproval", id }))!.decoded!;
    expect(d).toMatchObject({ title: "Unreadable request", blind: true });
    expect(d.warnings).toContainEqual(expect.objectContaining({ code: "simulation-failed", message: "You don't have enough ETH to send this amount and pay the network fee." }));
  });

  it("plans a request on an unscanned request network (Hedera EVM) with that network's own balance (dapp matrix regression)", async () => {
    const HEDERA_EVM = { ...SEPOLIA, id: "eip155:296", chainId: 296, name: "Hedera Testnet (EVM)", nativeAsset: { ...SEPOLIA.nativeAsset, key: "hbar", symbol: "HBAR", networkId: "eip155:296" } };
    const vault = new FakeVault();
    const deps = makeDeps(vault);
    deps.requestNetworks = [HEDERA_EVM];
    const getBalances = deps.evm.getBalances.bind(deps.evm);
    deps.evm.getBalances = async (ctx) => (ctx.network.id === HEDERA_EVM.id ? [{ asset: HEDERA_EVM.nativeAsset, amount: "10000000000000000000" }] : getBalances(ctx));
    const seen: { networkId: string; amount: string }[][] = [];
    deps.route = { async plan({ balances, decoded }) { seen.push(balances.map((b) => ({ networkId: b.asset.networkId, amount: b.amount }))); return { source: "Your balance", sponsored: false, readyInSeconds: 4, steps: [{ kind: "action", title: decoded.title }], settlement: "" }; } };
    const engine = new WalletEngine(deps, new MemoryKV(), makeEnv());
    engine.start();
    await engine.handle({ type: "createWallet", password: "a long test password" });
    void engine.request({ id: "h1", origin: ORIGIN, via: "injected", family: "evm", networkId: HEDERA_EVM.id, method: "eth_sendTransaction", params: [{ value: "10000000000" }] });
    for (let i = 0; i < 50 && !seen.length; i++) await new Promise((r) => setTimeout(r, 5));
    // The portfolio never scans 296; before, the planner saw no HBAR there and blocked the send as a shortfall.
    expect(seen[0]).toContainEqual({ networkId: "eip155:296", amount: "10000000000000000000" });
  });

  it("queues a send as an approval and signs only after approve", async () => {
    const { engine, vault, deps } = await unlocked();
    const id = await engine.handle({ type: "send", assetKey: "eth", networkId: SEPOLIA.id, to: "0x000000000000000000000000000000000000dEaD", amount: "0.1" });
    const view = await engine.handle({ type: "getApproval", id });
    expect(view?.decoded?.title).toBe("Send 0.1 ETH");
    expect(view?.decoded?.lines[0]).toEqual({ label: "To", value: "0x0000…dEaD" });
    // Chain modules build sends with WALLET_ORIGIN: shown as the wallet's own, never as an unrecognised site.
    expect(view?.via).toBe("wallet");
    expect(view?.decoded?.warnings.some((w) => w.code === "domain-mismatch")).toBe(false);
    expect(vault.signed).toHaveLength(0);
    await engine.handle({ type: "approve", id });
    expect(vault.signed).toHaveLength(1);
    expect(deps.evm.finalized).toHaveLength(1);
    const activity = await engine.handle({ type: "getActivity" });
    expect(activity[0]!.title).toMatch(/^Sent 0.1 ETH to 0x0000…dEaD$/);
  });

  it("shows one receive address for every EVM network", async () => {
    const { engine } = await unlocked();
    const t = await engine.handle({ type: "getReceiveTargets", assetKey: "eth" });
    expect(t).toHaveLength(1);
    expect(t[0]!.networks).toHaveLength(2);
  });
});

describe("wallet-built origin", () => {
  it("one constant for every wallet-built request; the feature host stamps it", async () => {
    expect(WALLET_ORIGIN).toBe("clip-wallet");
    expect(isWalletOrigin(WALLET_ORIGIN)).toBe(true);
    expect(isWalletOrigin("wallet")).toBe(true);
    expect(isWalletOrigin(ORIGIN)).toBe(false);
    expect(isWalletOrigin(undefined)).toBe(false);
    const seen: string[] = [];
    const host = createFeatureHost({
      networks: [],
      assets: [],
      ctx: async () => { throw new Error("unused"); },
      balances: async () => [],
      enqueue: async (r: DappRequest) => { seen.push(r.origin); return { id: "a1", promise: Promise.resolve(null) }; },
      decode: async () => { throw new Error("unused"); },
      kv: new MemoryKV(),
      usd: () => undefined,
      fetch: (async () => new Response("{}")) as typeof fetch,
    } as unknown as Parameters<typeof createFeatureHost>[0]);
    await host.enqueue({ id: "x", origin: "wallet", via: "injected", family: "evm", networkId: SEPOLIA.id, method: "eth_sendTransaction", params: [] }, { appName: "Staking" });
    expect(seen).toEqual([WALLET_ORIGIN]);
  });
});

describe("WalletEngine: dapps over the 1Mask port (WebView bridge / content script)", () => {
  it("connect → approval → accounts, then personal_sign → approval → signature", async () => {
    const opened: string[] = [];
    const { engine, vault } = await unlocked((id) => opened.push(id));
    const { port, send } = fakePort();
    engine.attachDappPort(port, ORIGIN);

    const connecting = send(ORIGIN, "eth_requestAccounts");
    await tick();
    await tick();
    expect(opened).toHaveLength(1);
    const connectView = await engine.handle({ type: "getApproval", id: opened[0]! });
    expect(connectView?.kind).toBe("connect");
    expect(connectView?.dapp).toMatchObject({ name: "Test Dapp", domain: "dapp.test", verified: true });
    await engine.handle({ type: "approve", id: opened[0]! });
    expect((await connecting).result).toEqual([EVM_ADDRESS]);

    const signing = send(ORIGIN, "personal_sign", ["0x68656c6c6f", EVM_ADDRESS]);
    for (let i = 0; i < 5 && opened.length < 2; i++) await tick();
    const signView = await engine.handle({ type: "getApproval", id: opened[1]! });
    expect(signView?.decoded?.title).toBe("Sign in to dapp.test");
    await engine.handle({ type: "approve", id: opened[1]! });
    const reply = await signing;
    expect(reply.error).toBeUndefined();
    expect(reply.result).toBe(`0x${"07".repeat(64)}1c`);
    expect(vault.signed[0]!.approvalId).toBe(opened[1]);
  });

  it("a rejected request answers 4001 and signs nothing", async () => {
    const opened: string[] = [];
    const { engine, vault } = await unlocked((id) => opened.push(id));
    await engine.permissions.grant(ORIGIN, "evm");
    const { port, send } = fakePort();
    engine.attachDappPort(port, ORIGIN);
    const signing = send(ORIGIN, "personal_sign", ["0x68656c6c6f", EVM_ADDRESS]);
    for (let i = 0; i < 5 && !opened.length; i++) await tick();
    await engine.handle({ type: "reject", id: opened[0]! });
    expect((await signing).error?.code).toBe(4001);
    expect(vault.signed).toHaveLength(0);
  });

  it("drops requests whose claimed origin differs from the host-reported origin", async () => {
    const opened: string[] = [];
    const { engine } = await unlocked((id) => opened.push(id));
    const { port, send, replies } = fakePort();
    engine.attachDappPort(port, ORIGIN);
    void send("https://evil.test", "eth_requestAccounts");
    for (let i = 0; i < 5; i++) await tick();
    expect(opened).toHaveLength(0);
    expect(replies.every((r) => r.type !== "response" || r.error)).toBe(true);
  });

  it("locking rejects requests still waiting for the user", async () => {
    const opened: string[] = [];
    const { engine } = await unlocked((id) => opened.push(id));
    await engine.permissions.grant(ORIGIN, "evm");
    const { port, send } = fakePort();
    engine.attachDappPort(port, ORIGIN);
    const signing = send(ORIGIN, "personal_sign", ["0x68656c6c6f", EVM_ADDRESS]);
    for (let i = 0; i < 5 && !opened.length; i++) await tick();
    await engine.handle({ type: "lock" });
    expect((await signing).error).toBeDefined();
  });

  it("disconnecting a site removes its permission", async () => {
    const { engine } = await unlocked();
    await engine.permissions.grant(ORIGIN, "evm");
    const [s] = await engine.handle({ type: "listSessions" });
    await engine.handle({ type: "disconnect", id: s!.id });
    expect(await engine.permissions.has(ORIGIN, "evm")).toBe(false);
  });
});

describe("WalletEngine: WalletConnect and passkeys", () => {
  it("says plainly that WalletConnect is off without a project id", async () => {
    const { engine } = await unlocked();
    expect(engine.walletConnectEnabled).toBe(false);
    await expect(engine.handle({ type: "pairWalletConnect", uri: "wc:abc@2?relay-protocol=irn&symKey=00" })).rejects.toMatchObject({
      userMessage: "Connecting with a code isn't switched on in this build yet.",
    });
  });

  it("enrols and unlocks with an in-process PRF provider (mobile biometrics / passkeys)", async () => {
    const { engine } = await unlocked();
    const secret = new Uint8Array(32).fill(9);
    const prf = { enroll: async () => ({ credentialId: new Uint8Array([1, 2]), prfOutput: secret }), evaluate: async () => secret };
    await engine.enrollPasskeyWith("a long test password", prf);
    expect((await engine.handle({ type: "getState" })).passkey.enrolled).toBe(true);
    await engine.handle({ type: "lock" });
    await engine.unlockWithPasskeyWith(prf);
    expect((await engine.handle({ type: "getState" })).status).toBe("unlocked");
    await engine.removePasskeys();
    expect((await engine.handle({ type: "getState" })).passkey.enrolled).toBe(false);
  });

  it("the in-process client speaks the WalletClient contract", async () => {
    const { engine } = await unlocked();
    const subs: (() => void)[] = [];
    const client = createEngineClient(engine, { subscribe: (cb) => (subs.push(cb), () => undefined) });
    expect((await client.getState()).status).toBe("unlocked");
    expect((await client.getPortfolio()).balances).toHaveLength(1);
    client.onChange?.(() => undefined);
    expect(subs).toHaveLength(1);
  });
});
