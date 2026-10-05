/**
 * Pairing two devices: X25519 (in the vault) + a 6-digit code both people compare (SAS), with commit-then-reveal
 * and key confirmation.
 *
 *   Initiator (shows the QR / the extension in desktop mode)      Responder (scans / the desktop app)
 *   QR: channel id, initiator public key KI, 16-byte QR secret →
 *                                   ← hello  { commit = SHA-256(KR) }
 *   key { KI }                      →        (responder checks KI against the QR)
 *                                   ← reveal { KR }   (initiator checks SHA-256(KR) = commit)
 *   both: th = H(purpose, channel, QR secret, KI, KR); link = HKDF(X25519, th) inside the vault
 *   both show SAS = 6 digits from HKDF(link, "sas"); each person compares and taps "They match"
 *   confirm { HMAC(HKDF(link, "confirm-<role>"), th) } both ways; a bad MAC aborts.
 *
 * Why: the responder commits to its key before it sees the initiator's, so a man in the middle can't search for
 * keys that make both screens show the same code; with the QR the initiator's key is also out-of-band. A relay
 * that swaps keys ends with different codes on the two screens (people reject) and, even if someone taps
 * "match" anyway, different link secrets, so key confirmation fails and nothing is sent (tested).
 */
import { b64url, equalBytes, fromB64url, hkdf32, hmac256, randomBytes, sha256, transcript } from "../bytes.js";
import type { PairingKeyHandle } from "../keys.js";
import { ChannelTimeout, PeerAbort, nextFrame, type Channel } from "./channel.js";

export type Purpose = "signer" | "device-add" | "desktop";
export type Role = "i" | "r";

export interface PairingOffer {
  v: 1;
  /** Relay channel id (16 random bytes, base64url). */
  channel: string;
  /** Initiator's X25519 public key (base64url). */
  key: string;
  /** 16 random bytes only the QR carries (base64url). */
  secret: string;
  purpose: Purpose;
  /** Relay origin, e.g. https://clip-link-relay.example.workers.dev */
  relay?: string;
  /** The showing device's name ("Chrome on Mac"). */
  name: string;
}

export interface PairingContext {
  purpose: Purpose;
  channel: string;
  /** QR secret (empty for the local desktop channel). */
  secret: Uint8Array;
  /** Responder: the initiator key from the QR, checked against what arrives. */
  expectedInitiatorKey?: Uint8Array;
}

export interface PeerInfo {
  name: string;
  platform: string;
}

export interface Paired {
  role: Role;
  /** 32-byte link secret (derived by the vault). Store it to reconnect later; it never leaves this device. */
  linkSecret: Uint8Array;
  transcriptHash: Uint8Array;
  peer: PeerInfo;
  peerPublicKey: Uint8Array;
  pairingKeyId: string;
}

export interface PendingPairing {
  /** "123456": show it as "123 456". */
  sas: string;
  peer: PeerInfo;
  /** The person tapped "They match". Resolves once the other device confirmed too (and its MAC checks out). */
  confirm(): Promise<Paired>;
  /** The person tapped "They don't match" (or cancelled). Tells the other side and closes. */
  reject(reason?: string): void;
}

export class PairingError extends Error {
  constructor(
    readonly code: "mismatch" | "bad-key" | "timeout" | "closed" | "rejected" | "bad-offer",
    message: string,
  ) {
    super(message);
  }
}

const STEP_MS = 60_000;
const CONFIRM_MS = 5 * 60_000;
const KEY = /^[A-Za-z0-9_-]{43}$/;

export function newOffer(p: { key: PairingKeyHandle; purpose: Purpose; relay?: string; name: string }): PairingOffer {
  return { v: 1, channel: b64url(randomBytes(16)), key: b64url(p.key.publicKey), secret: b64url(randomBytes(16)), purpose: p.purpose, ...(p.relay ? { relay: p.relay } : {}), name: p.name.slice(0, 60) };
}

export function offerToUri(o: PairingOffer): string {
  const q = new URLSearchParams({ v: "1", c: o.channel, k: o.key, s: o.secret, p: o.purpose, n: o.name });
  if (o.relay) q.set("r", o.relay);
  return `clipwallet://link?${q.toString()}`;
}

export function parseOfferUri(uri: string): PairingOffer | null {
  let u: URL;
  try {
    u = new URL(uri.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "clipwallet:" || (u.hostname !== "link" && u.pathname.replace(/^\/+/, "") !== "link")) return null;
  const q = u.searchParams;
  const c = q.get("c") ?? "";
  const k = q.get("k") ?? "";
  const s = q.get("s") ?? "";
  const p = q.get("p") ?? "";
  const r = q.get("r") ?? undefined;
  if (q.get("v") !== "1" || !/^[A-Za-z0-9_-]{22}$/.test(c) || !KEY.test(k) || !/^[A-Za-z0-9_-]{22}$/.test(s)) return null;
  if (!["signer", "device-add", "desktop"].includes(p)) return null;
  if (r !== undefined) {
    try {
      const ru = new URL(r);
      if (ru.protocol !== "https:" && !(ru.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(ru.hostname))) return null;
    } catch {
      return null;
    }
  }
  return { v: 1, channel: c, key: k, secret: s, purpose: p as Purpose, ...(r ? { relay: r } : {}), name: (q.get("n") ?? "").slice(0, 60) };
}

export function contextFromOffer(o: PairingOffer, role: Role): PairingContext {
  return { purpose: o.purpose, channel: o.channel, secret: fromB64url(o.secret), ...(role === "r" ? { expectedInitiatorKey: fromB64url(o.key) } : {}) };
}

export function sasFrom(linkSecret: Uint8Array): string {
  const b = hkdf32(linkSecret, new Uint8Array(0), "clip/link/v1/sas", 4);
  const n = new DataView(b.buffer, b.byteOffset, 4).getUint32(0, false) % 1_000_000;
  return String(n).padStart(6, "0");
}

function confirmMac(linkSecret: Uint8Array, role: Role, th: Uint8Array): string {
  return b64url(hmac256(hkdf32(linkSecret, new Uint8Array(0), `clip/link/v1/confirm-${role}`), th));
}

export function pairingTranscript(ctx: PairingContext, ki: Uint8Array, kr: Uint8Array): Uint8Array {
  return transcript("clip-link/v1/pairing", ctx.purpose, ctx.channel, ctx.secret, ki, kr);
}

type Msg = { t: string; [k: string]: unknown };
const is = (t: string) => (m: unknown): m is Msg => !!m && typeof m === "object" && (m as Msg).t === t;

function keyOf(v: unknown): Uint8Array {
  if (typeof v !== "string" || !KEY.test(v)) throw new PairingError("bad-key", "The other device sent an unusable key.");
  const k = fromB64url(v);
  if (k.length !== 32) throw new PairingError("bad-key", "The other device sent an unusable key.");
  return k;
}

function wrap(e: unknown): PairingError {
  if (e instanceof PairingError) return e;
  if (e instanceof ChannelTimeout) return new PairingError("timeout", "The other device didn't answer in time.");
  if (e instanceof PeerAbort) return new PairingError("rejected", "The other device cancelled.");
  return new PairingError("closed", "The connection to the other device closed.");
}

const cleanName = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 60) : "");

/** Runs the key exchange. Resolves when both screens can show the code. */
export async function pair(p: {
  channel: Channel;
  role: Role;
  key: PairingKeyHandle;
  ctx: PairingContext;
  me: PeerInfo;
  timeoutMs?: number;
}): Promise<PendingPairing> {
  const { channel: ch, role, key, ctx } = p;
  const step = p.timeoutMs ?? STEP_MS;
  let peer: PeerInfo;
  let ki: Uint8Array;
  let kr: Uint8Array;
  try {
    if (role === "r") {
      kr = key.publicKey;
      ch.send(JSON.stringify({ t: "hello", v: 1, commit: b64url(sha256(kr)), name: p.me.name, platform: p.me.platform, purpose: ctx.purpose }));
      const m = await nextFrame(ch, is("key"), step);
      ki = keyOf(m.k);
      if (ctx.expectedInitiatorKey && !equalBytes(ki, ctx.expectedInitiatorKey)) throw new PairingError("bad-key", "This isn't the device whose code you scanned.");
      peer = { name: cleanName(m.name), platform: cleanName(m.platform) };
      ch.send(JSON.stringify({ t: "reveal", k: b64url(kr) }));
    } else {
      ki = key.publicKey;
      const hello = await nextFrame(ch, is("hello"), step);
      if (hello.purpose !== ctx.purpose) throw new PairingError("bad-offer", "The other device is trying to do something else.");
      const commit = typeof hello.commit === "string" ? hello.commit : "";
      peer = { name: cleanName(hello.name), platform: cleanName(hello.platform) };
      ch.send(JSON.stringify({ t: "key", k: b64url(ki), name: p.me.name, platform: p.me.platform }));
      const rev = await nextFrame(ch, is("reveal"), step);
      kr = keyOf(rev.k);
      if (b64url(sha256(kr)) !== commit) throw new PairingError("bad-key", "The other device changed its key half-way.");
    }
  } catch (e) {
    const err = wrap(e);
    safeSend(ch, { t: "abort", reason: err.code });
    throw err;
  }
  const th = pairingTranscript(ctx, ki, kr);
  const peerKey = role === "i" ? kr : ki;
  const link = await key.agree(peerKey, th);
  const sas = sasFrom(link);
  const peerRole: Role = role === "i" ? "r" : "i";
  // Collect the peer's confirmation as soon as it arrives (it may come before this person taps).
  const peerConfirm = nextFrame(ch, is("confirm"), CONFIRM_MS);
  peerConfirm.catch(() => undefined);
  let settled = false;
  return {
    sas,
    peer,
    async confirm() {
      if (settled) throw new PairingError("closed", "This pairing already finished.");
      settled = true;
      safeSend(ch, { t: "confirm", mac: confirmMac(link, role, th) });
      let m: Msg;
      try {
        m = await peerConfirm;
      } catch (e) {
        throw wrap(e);
      }
      if (typeof m.mac !== "string" || m.mac !== confirmMac(link, peerRole, th)) {
        safeSend(ch, { t: "abort", reason: "mismatch" });
        link.fill(0);
        throw new PairingError("mismatch", "The codes didn't match, so nothing was connected.");
      }
      return { role, linkSecret: link, transcriptHash: th, peer, peerPublicKey: peerKey, pairingKeyId: key.id };
    },
    reject(reason = "mismatch") {
      if (settled) return;
      settled = true;
      link.fill(0);
      safeSend(ch, { t: "abort", reason });
      key.destroy();
    },
  };
}

function safeSend(ch: Channel, m: unknown) {
  try {
    ch.send(JSON.stringify(m));
  } catch {
    /* closed */
  }
}

/** Relay channel id for a long-lived pairing (both sides compute it; the relay only ever sees this). */
export function pairedChannelId(linkSecret: Uint8Array): string {
  return b64url(hkdf32(linkSecret, new Uint8Array(0), "clip/link/v1/relay-channel", 16));
}
