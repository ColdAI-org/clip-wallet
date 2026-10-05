/** LinkService end to end: extension ⇄ phone over a (fake) relay, extension ⇄ Clip Desktop over a native channel. */
import { describe, expect, it, vi } from "vitest";
import type { Account, DappRequest } from "@clip-wallet/core";
import { LinkService } from "../src/service/service.js";
import { memoryChannelPair, type BaseChannel } from "../src/pairing/channel.js";
import { remoteDappHost, type DappHostLike } from "../src/remote/host.js";
import type { SignerHost } from "../src/remote/server.js";
import { b64url, sha256, utf8 } from "../src/bytes.js";
import { MemoryRelay, fakeVault, until } from "./helpers.js";

class KV {
  m = new Map<string, unknown>();
  async get<T>(k: string) {
    const v = this.m.get(k);
    return v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as T);
  }
  async set<T>(k: string, v: T) {
    this.m.set(k, JSON.parse(JSON.stringify(v)));
  }
  async remove(k: string) {
    this.m.delete(k);
  }
}

const ACCOUNT: Account = { id: "evm:0", family: "evm", index: 0, curve: "secp256k1", derivationPath: "m/44'/60'/0'/0/0", publicKey: "02ab", address: "0x1111111111111111111111111111111111111111" };

function phoneHost() {
  const ok = new Set<string>();
  const host: SignerHost & { approvals: string[] } = {
    approvals: [],
    async approveConnect(p) {
      host.approvals.push(`connect ${p.origin}`);
      ok.add(p.origin);
      return true;
    },
    accountsFor: async (o) => (ok.has(o) ? [ACCOUNT] : []),
    async request(req) {
      host.approvals.push(`sign ${req.method}`);
      return "0xphone-signature";
    },
    cancel: () => undefined,
  };
  return host;
}

function services(relay: MemoryRelay, opts: { phoneVault?: ReturnType<typeof fakeVault>; extVault?: ReturnType<typeof fakeVault> } = {}) {
  const extVault = opts.extVault ?? fakeVault({ label: "ext" });
  const phoneVault = opts.phoneVault ?? fakeVault({ label: "phone" });
  const ext = new LinkService({ platform: "extension", deviceName: () => "Chrome on Mac", kv: new KV(), vault: extVault, relayUrl: "https://relay.test", WebSocket: relay.ctor() });
  const host = phoneHost();
  const phone = new LinkService({ platform: "mobile", deviceName: () => "Pixel 9", kv: new KV(), vault: phoneVault, relayUrl: "https://relay.test", WebSocket: relay.ctor(), signerHost: host });
  return { ext, phone, host, extVault, phoneVault };
}

async function pairPhone(ext: LinkService, phone: LinkService) {
  const shown = await ext.startPairing("signer");
  const scanned = await phone.scan(shown.uri!);
  const view = async (s: LinkService, id: string) => (await s.status()).pairings.find((p) => p.id === id)!;
  await until(async () => (await view(ext, shown.id)).state === "compare" && (await view(phone, scanned.id)).state === "compare");
  const sasExt = (await view(ext, shown.id)).sas;
  const sasPhone = (await view(phone, scanned.id)).sas;
  return { shown, scanned, sasExt, sasPhone, view };
}

describe("phone as signer (Clip Link)", () => {
  it("pairs with matching codes, then dapp requests go to the phone and the phone approves", async () => {
    const relay = new MemoryRelay();
    const { ext, phone, host } = services(relay);
    const { shown, scanned, sasExt, sasPhone, view } = await pairPhone(ext, phone);
    expect(sasExt).toBe(sasPhone);
    await ext.confirm(shown.id, true);
    await phone.confirm(scanned.id, true);
    await until(async () => (await view(ext, shown.id)).state === "done" && (await view(phone, scanned.id)).state === "done");
    const [d] = (await ext.status()).devices;
    expect(d).toMatchObject({ name: "Pixel 9", platform: "mobile", servesRequests: false });
    expect((await phone.status()).devices[0]).toMatchObject({ name: "Chrome on Mac", servesRequests: true });

    await phone.startServing();
    await ext.useSigner(d!.id);
    const local: DappHostLike = {
      approveConnect: vi.fn(),
      request: vi.fn(),
      accountsFor: async () => [],
      preferredNetwork: () => undefined,
      cachedAccount: () => undefined,
      permissions: { has: async () => false, grant: async () => undefined, revoke: async () => undefined, origins: async () => [] },
      rpc: async () => null,
      chainRead: async () => null,
      isUnlocked: async () => false,
      cancel: () => undefined,
    } as unknown as DappHostLike;
    const dappHost = remoteDappHost(local, ext);
    expect(await dappHost.approveConnect({ origin: "https://app.example", family: "evm", networkId: "eip155:11155111", via: "injected" })).toBe(true);
    const req: DappRequest = { id: "1", origin: "https://app.example", via: "injected", family: "evm", networkId: "eip155:11155111", method: "personal_sign", params: [] };
    expect(await dappHost.request(req)).toBe("0xphone-signature");
    expect(host.approvals).toEqual(["connect https://app.example", "sign personal_sign"]);
    expect(local.request).not.toHaveBeenCalled();
    // The relay only ever saw pairing messages (public keys, MACs) and ciphertext.
    expect(relay.seen.join("\n")).not.toContain("personal_sign");
    expect(relay.seen.join("\n")).not.toContain("app.example");

    // Continue elsewhere: the phone sends the current page to the extension.
    await phone.handoffSend(d!.id === (await phone.status()).devices[0]!.id ? d!.id : (await phone.status()).devices[0]!.id, "https://app.example/swap", ["evm"]);
    await until(async () => (await ext.status()).handoffs.length === 1);
    const h = (await ext.status()).handoffs[0]!;
    expect(h).toMatchObject({ url: "https://app.example/swap", origin: "https://app.example", from: "Pixel 9" });
    phone.stopServing();
  });

  it("tapping 'They don't match' on either device pairs nothing", async () => {
    const relay = new MemoryRelay();
    const { ext, phone } = services(relay);
    const { shown, scanned, view } = await pairPhone(ext, phone);
    await phone.confirm(scanned.id, false);
    await ext.confirm(shown.id, true);
    await until(async () => (await view(ext, shown.id)).state === "failed");
    expect((await ext.status()).devices).toEqual([]);
    expect((await phone.status()).devices).toEqual([]);
  });
});

describe("add this wallet to another device", () => {
  it("moves the wallet after both confirm the code and the source re-enters its password", async () => {
    const relay = new MemoryRelay();
    const newDevice = fakeVault({ label: "new", state: "empty" });
    const source = fakeVault({ label: "src" });
    const { ext: receiver, phone: sender } = services(relay, { extVault: newDevice, phoneVault: source });
    const shown = await receiver.startPairing("device-add"); // empty → "receive"
    expect(shown.direction).toBe("receive");
    const scanned = await sender.scan(shown.uri!);
    expect(scanned.direction).toBe("send");
    const v = async (s: LinkService, id: string) => (await s.status()).pairings.find((p) => p.id === id)!;
    await until(async () => (await v(receiver, shown.id)).state === "compare" && (await v(sender, scanned.id)).state === "compare");
    await receiver.confirm(shown.id, true);
    await sender.confirm(scanned.id, true);
    await until(async () => (await v(receiver, shown.id)).state === "password" && (await v(sender, scanned.id)).state === "password");
    // Wrong password: nothing leaves the source; it can try again.
    await expect(sender.transferSend(scanned.id, "wrong-password")).rejects.toMatchObject({ code: "vault/wrong-password" });
    expect(source.exported).toBe(0);
    const recv = receiver.transferReceive(shown.id, "new-device-pw");
    const sent = await sender.transferSend(scanned.id, "pw-12345678");
    expect(sent.state).toBe("done");
    expect((await recv).state).toBe("done");
    expect(newDevice.imported).toHaveLength(1);
    expect(newDevice.imported[0]!.password).toBe("new-device-pw");
  });

  it("a man in the middle on the relay: the codes differ, the pairing aborts and the wallet is never exported", async () => {
    const relay = new MemoryRelay();
    const newDevice = fakeVault({ label: "new2", state: "empty" });
    const source = fakeVault({ label: "src2" });
    const { ext: receiver, phone: sender } = services(relay, { extVault: newDevice, phoneVault: source });
    const mallory = sha256(utf8("mallory-public-value"));
    relay.tap = (_c, from, frame) => {
      const m = JSON.parse(frame);
      if (from === "b" && m.t === "hello") m.commit = b64url(sha256(mallory));
      if (from === "b" && m.t === "reveal") m.k = b64url(mallory);
      return JSON.stringify(m);
    };
    const shown = await receiver.startPairing("device-add");
    const scanned = await sender.scan(shown.uri!);
    const v = async (s: LinkService, id: string) => (await s.status()).pairings.find((p) => p.id === id)!;
    await until(async () => (await v(receiver, shown.id)).state === "compare" && (await v(sender, scanned.id)).state === "compare");
    const a = (await v(receiver, shown.id)).sas;
    const b = (await v(sender, scanned.id)).sas;
    expect(a).not.toBe(b);
    // The person on the source sees a different code and taps "They don't match".
    await sender.confirm(scanned.id, false);
    await receiver.confirm(shown.id, true);
    await until(async () => (await v(receiver, shown.id)).state === "failed");
    await expect(sender.transferSend(scanned.id, "pw-12345678")).rejects.toMatchObject({ code: "link/not-found" });
    expect(source.exported).toBe(0);
    expect(newDevice.imported).toEqual([]);
  });

  it("MITM and both people tap 'match' anyway: key confirmation fails, nothing is exported", async () => {
    const relay = new MemoryRelay();
    const newDevice = fakeVault({ label: "new3", state: "empty" });
    const source = fakeVault({ label: "src3" });
    const { ext: receiver, phone: sender } = services(relay, { extVault: newDevice, phoneVault: source });
    const mallory = sha256(utf8("mallory-public-value-2"));
    relay.tap = (_c, from, frame) => {
      const m = JSON.parse(frame);
      if (from === "b" && m.t === "hello") m.commit = b64url(sha256(mallory));
      if (from === "b" && m.t === "reveal") m.k = b64url(mallory);
      return JSON.stringify(m);
    };
    const shown = await receiver.startPairing("device-add");
    const scanned = await sender.scan(shown.uri!);
    const v = async (s: LinkService, id: string) => (await s.status()).pairings.find((p) => p.id === id)!;
    await until(async () => (await v(receiver, shown.id)).state === "compare" && (await v(sender, scanned.id)).state === "compare");
    await receiver.confirm(shown.id, true);
    await sender.confirm(scanned.id, true);
    await until(async () => (await v(receiver, shown.id)).state === "failed" && (await v(sender, scanned.id)).state === "failed");
    expect((await v(sender, scanned.id)).error?.code).toBe("link/mismatch");
    expect(source.exported).toBe(0);
  });
});

describe("Clip Desktop over native messaging", () => {
  it("pairs with a code shown in both apps, then signs through the desktop app", async () => {
    const desktopHost = phoneHost();
    const desktop = new LinkService({ platform: "desktop", deviceName: () => "Clip Desktop", kv: new KV(), vault: fakeVault({ label: "desk" }), signerHost: desktopHost });
    const connect = (): BaseChannel => {
      const [a, b] = memoryChannelPair();
      void desktop.acceptNative(b);
      return a;
    };
    const ext = new LinkService({ platform: "extension", deviceName: () => "Chrome on Mac", kv: new KV(), vault: fakeVault({ label: "e" }), native: { connect, requestPermission: async () => true } });
    const p = await ext.desktopPair();
    const v = async (s: LinkService) => (await s.status()).pairings[0]!;
    await until(async () => (await v(ext)).state === "compare" && (await v(desktop)).state === "compare");
    expect((await v(ext)).sas).toBe((await v(desktop)).sas);
    await desktop.confirm((await v(desktop)).id, true);
    await ext.confirm(p.id, true);
    await until(async () => (await v(ext)).state === "done" && (await v(desktop)).state === "done");
    const dev = (await ext.status()).devices[0]!;
    expect(dev).toMatchObject({ purpose: "desktop", name: "Clip Desktop" });
    await ext.useSigner(dev.id);
    const s = ext.signer()!;
    const c = await s.connectApp({ origin: "https://app.example", family: "evm", networkId: "eip155:11155111" });
    expect(c.approved).toBe(true);
    expect(await s.request({ id: "9", origin: "https://app.example", via: "injected", family: "evm", networkId: "eip155:11155111", method: "eth_signTypedData_v4", params: [] })).toBe("0xphone-signature");
    expect(desktopHost.approvals).toEqual(["connect https://app.example", "sign eth_signTypedData_v4"]);
  });
});

describe("continue elsewhere", () => {
  it("a handoff link from a device with the same wallet restores the connection after one tap", async () => {
    const kv = new KV();
    const granted: unknown[] = [];
    const a = new LinkService({ platform: "extension", deviceName: () => "A", kv: new KV(), vault: fakeVault({ label: "same" }) });
    const b = new LinkService({ platform: "mobile", deviceName: () => "B", kv, vault: fakeVault({ label: "same" }), grantOrigin: async (o, f) => void granted.push([o, f]) });
    const other = new LinkService({ platform: "mobile", deviceName: () => "C", kv: new KV(), vault: fakeVault({ label: "someone-else" }), grantOrigin: async (o, f) => void granted.push(["other", o, f]) });
    const { link } = await a.handle({ type: "linkHandoffCreate", url: "https://app.uniswap.org/swap?chain=sepolia", families: ["evm"] });
    expect(link).toMatch(/^clipwallet:\/\/browse\?url=https%3A%2F%2Fapp\.uniswap\.org/);
    const h = await b.handoffOpen(link);
    expect(h).toMatchObject({ verified: true, origin: "https://app.uniswap.org", families: ["evm"] });
    expect(granted).toEqual([]);
    expect(await b.handoffAccept(h.id)).toEqual({ url: "https://app.uniswap.org/swap?chain=sepolia" });
    expect(granted).toEqual([["https://app.uniswap.org", ["evm"]]]);
    // Another wallet's device just opens the page.
    const h2 = await other.handoffOpen(link);
    expect(h2.verified).toBe(false);
    await other.handoffAccept(h2.id);
    expect(granted).toHaveLength(1);
  });
});
