/**
 * Settings-sync wire protocol (v1), shared by the client (this package) and services/backup.
 *
 *   GET    /v1/sync/changes?since=<seq>   → 200 { seq, records: [{ rid, seq, ct }], more }
 *   POST   /v1/sync/push { records: [{ rid, base, ct }] } → 200 { applied: [{ rid, seq }], conflicts: [{ rid, seq, ct }] }
 *   DELETE /v1/sync                        → 204   (delete everything stored for this sync key)
 *
 * No accounts or emails. Every request carries
 *   Authorization: ClipSync pub=<b64url Ed25519 key>,ts=<ms>,nonce=<b64url 16 bytes>,sig=<b64url 64 bytes>
 * where sig = Ed25519(sk, "clip-sync-v1\n" METHOD "\n" PATH?QUERY "\n" ts "\n" nonce "\n" b64url(SHA-256(body))).
 * The server files data under space = hex(SHA-256(pub)), checks |ts − now| ≤ 5 min and refuses a nonce it has seen.
 *
 * What the server stores per record: rid (HMAC-SHA256(idKey, collection ‖ 0 ‖ id), truncated, so it doesn't
 * learn which setting it is), a sequence number and the ciphertext XChaCha20-Poly1305(dataKey, record JSON,
 * aad = "clip-sync/v1|" + rid). Binding the rid in the AAD stops the server from swapping records around.
 * `base` is compare-and-set: the push applies only if the server's seq for that rid is still `base` (0 = new).
 */
import { b64url, concat, fromB64url, hmac256, openJson, sealJson, sha256, utf8 } from "../bytes.js";
import type { Collection, SyncRecord } from "./records.js";
import { COLLECTIONS } from "./records.js";

export const SYNC_PREFIX = "clip-sync-v1\n";
export const SYNC_LIMITS = {
  /** base64url ciphertext of one record. */
  maxRecordCt: 16_384,
  maxPushRecords: 100,
  maxBodyBytes: 512 * 1024,
  maxRecordsPerSpace: 5_000,
  maxBytesPerSpace: 4 * 1024 * 1024,
  pageSize: 500,
  clockSkewMs: 5 * 60_000,
  nonceTtlMs: 11 * 60_000,
} as const;

export const RID = /^[A-Za-z0-9_-]{22}$/;
export const CT = /^[A-Za-z0-9_-]{54,16384}$/;
export const SPACE = /^[0-9a-f]{64}$/;

export interface WireRecord {
  rid: string;
  seq: number;
  ct: string;
}
export interface PushItem {
  rid: string;
  base: number;
  ct: string;
}
export interface ChangesResponse {
  seq: number;
  records: WireRecord[];
  more: boolean;
}
export interface PushResponse {
  applied: { rid: string; seq: number }[];
  conflicts: WireRecord[];
}

export function recordId(idKey: Uint8Array, c: Collection, id: string): string {
  return b64url(hmac256(idKey, concat(utf8(c), new Uint8Array([0]), utf8(id))).subarray(0, 16));
}

const aadFor = (rid: string) => `clip-sync/v1|${rid}`;

export function encryptRecord(dataKey: Uint8Array, rid: string, r: SyncRecord): string {
  return sealJson(dataKey, r, aadFor(rid));
}

/** Throws on tampering, a swapped rid or a foreign key. Validates shape. */
export function decryptRecord(dataKey: Uint8Array, rid: string, ct: string): SyncRecord {
  const r = openJson<SyncRecord>(dataKey, ct, aadFor(rid));
  if (
    !r ||
    typeof r !== "object" ||
    !COLLECTIONS.includes(r.c) ||
    typeof r.id !== "string" ||
    typeof r.t !== "number" ||
    typeof r.d !== "string" ||
    !r.clock ||
    typeof r.clock !== "object" ||
    Object.values(r.clock).some((n) => typeof n !== "number" || !Number.isInteger(n) || n < 0)
  ) {
    throw new Error("bad sync record");
  }
  return r;
}

export function bodyHash(body: string): string {
  return b64url(sha256(utf8(body)));
}

export function signedMessage(method: string, pathAndQuery: string, ts: number, nonce: string, body: string): Uint8Array {
  return utf8(`${SYNC_PREFIX}${method.toUpperCase()}\n${pathAndQuery}\n${ts}\n${nonce}\n${bodyHash(body)}`);
}

export interface AuthHeader {
  pub: string;
  ts: number;
  nonce: string;
  sig: string;
}

export function formatAuth(a: AuthHeader): string {
  return `ClipSync pub=${a.pub},ts=${a.ts},nonce=${a.nonce},sig=${a.sig}`;
}

export function parseAuth(header: string | null | undefined): AuthHeader | null {
  const m = /^ClipSync pub=([A-Za-z0-9_-]{43}),ts=(\d{1,16}),nonce=([A-Za-z0-9_-]{22}),sig=([A-Za-z0-9_-]{86})$/.exec(header ?? "");
  if (!m) return null;
  return { pub: m[1]!, ts: Number(m[2]), nonce: m[3]!, sig: m[4]! };
}

export const pubBytes = (a: AuthHeader) => fromB64url(a.pub);
