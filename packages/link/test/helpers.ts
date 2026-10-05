/**
 * Test doubles. NOTHING here is a real key or a real signature (harness: tests outside the vault never generate
 * keys or sign). Pairing "keys" are fixed labels hashed to 32 bytes and key agreement is a symmetric hash of both
 * public values: enough to exercise the protocol (SAS equality, MITM detection, key confirmation). The real
 * X25519 / Ed25519 run end to end in packages/vault/test/link.test.ts.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { concat, utf8, b64url } from "../src/bytes.js";
import type { LinkVault, PairingKeyHandle, SyncKeyHandle, VerifyFn } from "../src/keys.js";
import { channelUrl } from "../src/relay/protocol.js";
import type { WebSocketCtor, WebSocketLike } from "../src/relay/client.js";

const fixed = (label: string) => sha256(utf8(`clip-link-test/${label}`));

function compare(a: Uint8Array, b: Uint8Array) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}

let n = 0;
/** A pairing "key": public value = H(label); agreement = H(sorted(pub, peer) ‖ transcript). Not cryptography. */
export function fakePairingKey(label = `k${++n}`): PairingKeyHandle {
  const publicKey = fixed(label);
  let gone = false;
  return {
    id: label,
    publicKey,
    async agree(peer, th) {
      if (gone) throw new Error("pairing key expired");
      const [x, y] = compare(publicKey, peer) <= 0 ? [publicKey, peer] : [peer, publicKey];
      return sha256(concat(x, y, th));
    },
    destroy() {
      gone = true;
    },
  };
}

/** Sync "keys": fixed bytes; the "signature" is a hash anyone could compute (the fake verifier checks the same hash). */
export function fakeSyncKeys(label = "wallet-a"): SyncKeyHandle {
  const publicKey = fixed(`${label}/pub`);
  return {
    publicKey,
    space: Buffer.from(sha256(publicKey)).toString("hex"),
    dataKey: fixed(`${label}/data`),
    idKey: fixed(`${label}/id`),
    async sign(msg) {
      return concat(sha256(concat(publicKey, msg)), sha256(concat(msg, publicKey)));
    },
  };
}

export const fakeVerify: VerifyFn = (pub, msg, sig) => b64url(sig) === b64url(concat(sha256(concat(pub, msg)), sha256(concat(msg, pub))));

export interface FakeVault extends LinkVault {
  exported: number;
  imported: { box: unknown; password: string }[];
  state: "empty" | "locked" | "unlocked";
}

export function fakeVault(p: { label?: string; state?: "empty" | "locked" | "unlocked"; password?: string } = {}): FakeVault {
  const keys = fakeSyncKeys(p.label);
  const v: FakeVault = {
    exported: 0,
    imported: [],
    state: p.state ?? "unlocked",
    async status() {
      return v.state;
    },
    async syncKeys() {
      if (v.state !== "unlocked") throw Object.assign(new Error("locked"), { userMessage: "Your wallet is locked.", code: "vault/locked" });
      return keys;
    },
    pairingKey: () => fakePairingKey(`${p.label ?? "v"}-${++n}`),
    async exportToDevice(password, _id, peer, th) {
      if (password !== (p.password ?? "pw-12345678")) {
        const { ClipError } = await import("@clip-wallet/core");
        throw new ClipError("That password didn't work. Check it and try again.", "vault/wrong-password");
      }
      v.exported++;
      return { nonce: b64url(th.slice(0, 24)), ct: b64url(peer) };
    },
    async importFromDevice(_id, _peer, _th, box, password) {
      v.imported.push({ box, password });
      v.state = "unlocked";
    },
  };
  return v;
}

/**
 * An in-memory stand-in for services/link-relay: forwards frames between role a and role b of a channel and
 * queues them while the other side is away. `tap` can rewrite or drop frames (a malicious relay).
 */
export class MemoryRelay {
  readonly sockets = new Map<string, FakeSocket>();
  readonly queues = new Map<string, string[]>();
  readonly seen: string[] = [];
  tap?: (channel: string, from: "a" | "b", frame: string) => string | null;

  ctor(): WebSocketCtor {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const relay = this;
    return class extends FakeSocket {
      constructor(url: string) {
        super(url, relay);
      }
    } as unknown as WebSocketCtor;
  }

  join(s: FakeSocket) {
    const key = `${s.channel}/${s.role}`;
    this.sockets.get(key)?.serverClose("replaced");
    this.sockets.set(key, s);
    // A reconnecting role's old frames belong to a dead session: drop them (as the Worker does).
    this.queues.delete(`${s.channel}/${s.role === "a" ? "b" : "a"}<-${s.role}`);
    const inbox = this.queues.get(`${s.channel}/${s.role}<-${s.role === "a" ? "b" : "a"}`) ?? [];
    this.queues.delete(`${s.channel}/${s.role}<-${s.role === "a" ? "b" : "a"}`);
    const peer = this.sockets.get(`${s.channel}/${s.role === "a" ? "b" : "a"}`);
    queueMicrotask(() => {
      s.receive(JSON.stringify({ relay: "peer", present: !!peer }));
      for (const f of inbox) s.receive(f);
      peer?.receive(JSON.stringify({ relay: "peer", present: true }));
    });
  }

  leave(s: FakeSocket) {
    const key = `${s.channel}/${s.role}`;
    if (this.sockets.get(key) !== s) return;
    this.sockets.delete(key);
    this.sockets.get(`${s.channel}/${s.role === "a" ? "b" : "a"}`)?.receive(JSON.stringify({ relay: "peer", present: false }));
  }

  forward(s: FakeSocket, frame: string) {
    this.seen.push(frame);
    const out = this.tap ? this.tap(s.channel, s.role, frame) : frame;
    if (out === null) return;
    const other = s.role === "a" ? "b" : "a";
    const peer = this.sockets.get(`${s.channel}/${other}`);
    if (peer) queueMicrotask(() => peer.receive(out));
    else {
      const k = `${s.channel}/${other}<-${s.role}`;
      this.queues.set(k, [...(this.queues.get(k) ?? []), out]);
    }
  }
}

export class FakeSocket implements WebSocketLike {
  readyState = 0;
  readonly channel: string;
  readonly role: "a" | "b";
  private readonly ls = new Map<string, ((ev: { data?: unknown; code?: number; reason?: string }) => void)[]>();
  constructor(url: string, private readonly relay: MemoryRelay) {
    const u = new URL(url);
    this.channel = u.pathname.split("/").pop()!;
    this.role = u.searchParams.get("role") === "b" ? "b" : "a";
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit("open", {});
      relay.join(this);
    });
  }
  addEventListener(type: string, cb: (ev: { data?: unknown; code?: number; reason?: string }) => void) {
    this.ls.set(type, [...(this.ls.get(type) ?? []), cb]);
  }
  private emit(type: string, ev: { data?: unknown; code?: number; reason?: string }) {
    for (const cb of this.ls.get(type) ?? []) cb(ev);
  }
  send(data: string) {
    if (this.readyState !== 1) throw new Error("not open");
    this.relay.forward(this, data);
  }
  receive(data: string) {
    if (this.readyState === 1) this.emit("message", { data });
  }
  close(code = 1000, reason = "") {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.relay.leave(this);
    this.emit("close", { code, reason });
  }
  serverClose(reason: string) {
    this.close(4001, reason);
  }
}

export { channelUrl };

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export async function until(cond: () => boolean | Promise<boolean>, ms = 3000) {
  const t = Date.now();
  while (!(await cond())) {
    if (Date.now() - t > ms) throw new Error("condition not met in time");
    await tick(5);
  }
}
