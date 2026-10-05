/**
 * An encrypted, authenticated, replay-protected session between two paired devices, over any Channel.
 *
 * Every (re)connection starts with a fresh handshake: each side sends 16 random bytes with an HMAC under a key
 * derived from the stored link secret. Connection keys = HKDF(link, nI ‖ nR, "conn/<direction>"), so frames from
 * an earlier connection can't be replayed into this one. Frames carry a counter that must increase by exactly one
 * (bound into the AEAD's associated data), so the relay can't reorder, drop silently and continue, or replay.
 */
import { b64url, equalBytes, fromB64url, fromUtf8, hkdf32, hmac256, openBytes, randomBytes, sealBytes, utf8, concat } from "../bytes.js";
import { Emitter, nextFrame, type Channel } from "./channel.js";
import type { Role } from "./pairing.js";

/** JSON with Uint8Array and bigint kept (dapp params carry both). */
export function encodeValue(v: unknown): string {
  return JSON.stringify(v, (_k, x) => {
    if (x instanceof Uint8Array) return { $b: b64url(x) };
    if (typeof x === "bigint") return { $n: x.toString() };
    return x;
  });
}

export function decodeValue<T = unknown>(s: string): T {
  return JSON.parse(s, (_k, x) => {
    if (x && typeof x === "object" && !Array.isArray(x)) {
      const keys = Object.keys(x);
      if (keys.length === 1 && typeof x.$b === "string") return fromB64url(x.$b);
      if (keys.length === 1 && typeof x.$n === "string" && /^-?\d{1,80}$/.test(x.$n)) return BigInt(x.$n);
    }
    return x;
  }) as T;
}

const MAX_FRAME = 900 * 1024;

export class SecureSession {
  private sendCount = 0;
  private recvCount = 0;
  private readonly messages = new Emitter<unknown>();
  private readonly closes = new Emitter<string | undefined>();
  private open = true;
  private readonly offs: (() => void)[] = [];

  constructor(
    private readonly ch: Channel,
    private readonly role: Role,
    private readonly txKey: Uint8Array,
    private readonly rxKey: Uint8Array,
  ) {
    this.offs.push(
      ch.onMessage((f) => this.receive(f)),
      ch.onClose((r) => this.end(r)),
    );
  }

  get isOpen() {
    return this.open;
  }

  send(value: unknown) {
    if (!this.open) throw new Error("session closed");
    const c = this.sendCount++;
    const dir = this.role === "i" ? "i2r" : "r2i";
    const d = sealBytes(this.txKey, utf8(encodeValue(value)), `clip-link/v1|${dir}|${c}`);
    if (d.length > MAX_FRAME) throw new RangeError("message too large");
    this.ch.send(JSON.stringify({ t: "x", c, d: b64url(d) }));
  }

  /** Messages that arrived before anyone listened (right after the handshake) go to the first listener. */
  private backlog: unknown[] = [];
  onMessage(cb: (v: unknown) => void) {
    const off = this.messages.on(cb);
    if (this.backlog.length) queueMicrotask(() => this.backlog.splice(0).forEach((v) => this.messages.emit(v)));
    return off;
  }
  onClose(cb: (reason?: string) => void) {
    return this.closes.on(cb);
  }

  close(reason?: string) {
    if (!this.open) return;
    this.ch.close(reason);
    this.end(reason);
  }

  private receive(frame: string) {
    if (!this.open) return;
    let m: { t?: string; c?: number; d?: string };
    try {
      m = JSON.parse(frame);
    } catch {
      return;
    }
    if (m.t !== "x") return; // relay control frames and handshake leftovers
    const dir = this.role === "i" ? "r2i" : "i2r";
    if (m.c !== this.recvCount || typeof m.d !== "string") return this.close("out of order");
    let plain: Uint8Array;
    try {
      plain = openBytes(this.rxKey, fromB64url(m.d), `clip-link/v1|${dir}|${m.c}`);
    } catch {
      return this.close("tampered");
    }
    this.recvCount++;
    let v: unknown;
    try {
      v = decodeValue(fromUtf8(plain));
    } catch {
      return;
    }
    if (this.messages.size === 0) {
      if (this.backlog.length < 64) this.backlog.push(v);
      return;
    }
    this.messages.emit(v);
  }

  private end(reason?: string) {
    if (!this.open) return;
    this.open = false;
    for (const off of this.offs) off();
    this.txKey.fill(0);
    this.rxKey.fill(0);
    this.closes.emit(reason);
    this.messages.clear();
  }
}

type Hi = { t: "hi"; n: string; mac: string };
const isHi = (m: unknown): m is Hi => !!m && typeof m === "object" && (m as Hi).t === "hi";

function hiMac(link: Uint8Array, role: Role, n: Uint8Array): Uint8Array {
  return hmac256(hkdf32(link, new Uint8Array(0), "clip/link/v1/hi"), concat(utf8(`hi|${role}|`), n));
}

/**
 * Opens a session with a paired device. Both sides call it after the channel is up; resolves once the peer proved
 * it holds the same link secret. A peer that doesn't (wrong pairing, attacker) never gets a session.
 */
export async function openSession(ch: Channel, linkSecret: Uint8Array, role: Role, timeoutMs = 30_000): Promise<SecureSession> {
  const mine = randomBytes(16);
  const peerRole: Role = role === "i" ? "r" : "i";
  // The initiator speaks first; the responder answers only after hearing it, so no hello is ever sent before the
  // other side listens (transports without a queue, like a fresh native port, would drop it).
  const theirs = nextFrame(ch, isHi, timeoutMs);
  const sayHi = () => ch.send(JSON.stringify({ t: "hi", n: b64url(mine), mac: b64url(hiMac(linkSecret, role, mine)) }));
  if (role === "i") sayHi();
  const hi = await theirs;
  if (role === "r") sayHi();
  let n: Uint8Array;
  try {
    n = fromB64url(hi.n);
  } catch {
    ch.close("bad hello");
    throw new Error("bad hello");
  }
  if (n.length !== 16 || !equalBytes(fromB64url(hi.mac), hiMac(linkSecret, peerRole, n))) {
    ch.close("not paired");
    throw new Error("The other device isn't paired with this one.");
  }
  const salt = role === "i" ? concat(mine, n) : concat(n, mine);
  const i2r = hkdf32(linkSecret, salt, "clip/link/v1/conn/i2r");
  const r2i = hkdf32(linkSecret, salt, "clip/link/v1/conn/r2i");
  return role === "i" ? new SecureSession(ch, role, i2r, r2i) : new SecureSession(ch, role, r2i, i2r);
}
