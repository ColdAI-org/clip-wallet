/** Remote signer over an encrypted session: the extension asks, the key-holding device approves and answers. */
import { describe, expect, it, vi } from "vitest";
import { ClipError, type Account, type DappRequest } from "@clip-wallet/core";
import { memoryChannelPair } from "../src/pairing/channel.js";
import { openSession } from "../src/pairing/session.js";
import { RemoteSigner } from "../src/remote/client.js";
import { serveSigner, type SignerHost } from "../src/remote/server.js";
import { RemoteGrants, remoteDappHost, type DappHostLike } from "../src/remote/host.js";
import { tick } from "./helpers.js";

const SECRET = new Uint8Array(32).fill(7); // a fixture link secret (not a key)
const ACCOUNT: Account = { id: "evm:0", family: "evm", index: 0, curve: "secp256k1", derivationPath: "m/44'/60'/0'/0/0", publicKey: "02ab", address: "0x1111111111111111111111111111111111111111" };

class KV {
  m = new Map<string, unknown>();
  async get<T>(k: string) {
    return this.m.get(k) as T | undefined;
  }
  async set<T>(k: string, v: T) {
    this.m.set(k, v);
  }
  async remove(k: string) {
    this.m.delete(k);
  }
}

function signerHost(over: Partial<SignerHost> = {}) {
  const connected = new Set<string>();
  const host: SignerHost & { calls: string[] } = {
    calls: [],
    async approveConnect(p) {
      host.calls.push(`connect:${p.origin}:${p.name}`);
      connected.add(p.origin);
      return true;
    },
    async accountsFor(origin) {
      return connected.has(origin) ? [{ ...ACCOUNT, secretish: "never" } as unknown as Account] : [];
    },
    async request(req, dapp) {
      host.calls.push(`request:${req.id}:${req.method}:${dapp?.name}`);
      await tick(40); // the person reads the approval
      return "0xsigned";
    },
    cancel: vi.fn(),
    async decode(req) {
      return { requestId: req.id, title: "Sign a message from app.example", lines: [{ label: "Message", value: "hello" }], balanceChanges: [], simulated: false, blind: false, warnings: [], networkId: req.networkId };
    },
    ...over,
  };
  return host;
}

async function linked(host: SignerHost) {
  const [a, b] = memoryChannelPair();
  const sides = Promise.all([openSession(a, SECRET.slice(), "i"), openSession(b, SECRET.slice(), "r")]);
  const [, sb] = await sides;
  serveSigner(sb, host, { peerName: "Chrome on Mac", pairingId: "pairing123456789" });
  let first = true;
  const remote = new RemoteSigner({
    connect: async () => {
      if (!first) throw new Error("no reconnect in this test");
      first = false;
      return (await sides)[0];
    },
  });
  return remote;
}

const req = (over: Partial<DappRequest> = {}): DappRequest => ({ id: "dapp-1", origin: "https://app.example", via: "injected", family: "evm", networkId: "eip155:11155111", method: "personal_sign", params: ["0x68656c6c6f", ACCOUNT.address], ...over });

describe("remote signer", () => {
  it("connect then sign: the approval runs on the key-holding device, labelled with the paired device", async () => {
    const host = signerHost();
    const remote = await linked(host);
    const c = await remote.connectApp({ origin: "https://app.example", family: "evm", networkId: "eip155:11155111", name: "Example" });
    expect(c.approved).toBe(true);
    // Only public account fields cross the link.
    expect(c.accounts).toEqual([ACCOUNT]);
    const views: string[] = [];
    const sig = remote.request(req(), { name: "Example" });
    await tick(10);
    views.push(...remote.waiting().map((w) => w.title ?? ""));
    await expect(sig).resolves.toBe("0xsigned");
    expect(views).toEqual(["Sign a message from app.example"]);
    expect(host.calls).toEqual(["connect:https://app.example:Example · via Chrome on Mac", "request:link:pairing12345:dapp-1:personal_sign:Example · via Chrome on Mac"]);
  });

  it("a request from an app that isn't connected on the signer is refused", async () => {
    const host = signerHost();
    const remote = await linked(host);
    await expect(remote.request(req())).rejects.toMatchObject({ code: "link/not-connected" });
    expect(host.calls).toEqual([]);
  });

  it("a rejection on the phone reaches the dapp with its code", async () => {
    const host = signerHost({ request: async () => Promise.reject(new ClipError("You rejected this request.", "approval/rejected")) });
    const remote = await linked(host);
    await remote.connectApp({ origin: "https://app.example", family: "evm", networkId: "eip155:11155111" });
    await expect(remote.request(req())).rejects.toMatchObject({ code: "approval/rejected", userMessage: "You rejected this request." });
  });

  it("malformed messages are ignored by the signer", async () => {
    const host = signerHost();
    const [a, b] = memoryChannelPair();
    const [sa, sb] = await Promise.all([openSession(a, SECRET.slice(), "i"), openSession(b, SECRET.slice(), "r")]);
    serveSigner(sb, host, { peerName: "x", pairingId: "p" });
    sa.send({ t: "request", id: "1", request: { origin: "javascript:alert(1)" } });
    sa.send({ t: "connect", id: "2", origin: "not a url", family: "evm", networkId: "x" });
    await tick(10);
    expect(host.calls).toEqual([]);
  });

  it("remoteDappHost routes to the paired device only while remote mode is on", async () => {
    const host = signerHost();
    const remote = await linked(host);
    const local: DappHostLike = {
      approveConnect: vi.fn(async () => true),
      request: vi.fn(async () => "local"),
      accountsFor: vi.fn(async () => []),
      preferredNetwork: () => "eip155:11155111",
      cachedAccount: () => undefined,
      permissions: { has: async () => false, grant: async () => undefined, revoke: async () => undefined, origins: async () => [] },
      rpc: vi.fn(async () => "0x1"),
      chainRead: async () => null,
      isUnlocked: async () => false,
      cancel: vi.fn(),
    };
    let on = true;
    const grants = new RemoteGrants(new KV());
    const h = remoteDappHost(local, { active: () => on, signer: () => remote, grants });
    expect(await h.approveConnect({ origin: "https://app.example", family: "evm", networkId: "eip155:11155111", via: "injected" })).toBe(true);
    expect(await h.accountsFor("https://app.example", "evm")).toEqual([ACCOUNT]);
    expect(await h.permissions.has("https://app.example", "evm")).toBe(true);
    expect(await h.request(req())).toBe("0xsigned");
    expect(await h.rpc("eip155:11155111", "eth_chainId", [])).toBe("0x1"); // reads stay local
    expect(local.request).not.toHaveBeenCalled();
    on = false;
    expect(await h.request(req())).toBe("local");
    expect(await h.accountsFor("https://app.example", "evm")).toEqual([]);
  });

  it("passes the EIP-5792 calls host through, switched off while another device signs; absent stays absent", async () => {
    const calls = { auxiliaryFunds: vi.fn(() => ({})), status: vi.fn(async () => undefined), show: vi.fn(async () => false) };
    const base = { approveConnect: vi.fn(), request: vi.fn(), accountsFor: vi.fn(), preferredNetwork: () => undefined, cachedAccount: () => undefined, permissions: { has: async () => false, grant: async () => undefined, revoke: async () => undefined, origins: async () => [] }, rpc: vi.fn(), chainRead: vi.fn(), isUnlocked: async () => true, cancel: vi.fn() } as unknown as DappHostLike;
    let on = false;
    const mode = { active: () => on, signer: () => undefined, grants: new RemoteGrants(new KV()) };
    const h = remoteDappHost({ ...base, calls }, mode);
    expect(h.calls?.enabled?.()).toBe(true);
    on = true;
    expect(h.calls?.enabled?.()).toBe(false);
    await h.calls!.status("https://app.example", "0x1");
    expect(calls.status).toHaveBeenCalledWith("https://app.example", "0x1");
    expect(remoteDappHost(base, mode).calls).toBeUndefined();
  });
});
