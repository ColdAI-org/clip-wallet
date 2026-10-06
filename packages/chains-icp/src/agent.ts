import { ClipError } from "@clip-wallet/core";
import { sha256 } from "@noble/hashes/sha2.js";
import { type CborMap, type CborValue, cborDecode, cborEncode } from "./cbor.js";
import { uleb } from "./candid.js";
import { ANONYMOUS, principalToText } from "./principal.js";
import { bytesEqual, concat, utf8 } from "./util.js";

/**
 * A minimal client for the IC HTTPS interface (https://internetcomputer.org/docs/references/ic-interface-spec,
 * "HTTPS Interface"): request ids, envelopes, anonymous query calls, update calls through the synchronous
 * /api/v4/…/call endpoint (falling back to polling /api/v3/…/read_state on 202), and reading the request status
 * out of a certificate.
 *
 * NOT VERIFIED: certificates (BLS signatures over the state tree, with subnet delegations) and query-response node
 * signatures are NOT checked here. What a boundary node returns is treated as a report, never as proof: balances
 * are display-only, and a transfer result only says what the node claimed. Nothing in this package relies on a reply
 * for a security decision (the user approves what the wallet itself encoded, before anything is sent).
 */

export type Content = Record<string, Uint8Array | string | bigint | Uint8Array[][]>;

/** Domain separator for request signatures (spec "Authentication"). */
export const IC_REQUEST_DOMAIN = concat(Uint8Array.of(0x0a), utf8("ic-request"));

function hashValue(v: Uint8Array | string | bigint | number | unknown[]): Uint8Array {
  if (v instanceof Uint8Array) return sha256(v);
  if (typeof v === "string") return sha256(utf8(v));
  if (typeof v === "bigint" || typeof v === "number") return sha256(uleb(v));
  if (Array.isArray(v)) return sha256(concat(...v.map((x) => hashValue(x as never))));
  throw new Error("request id: unsupported value");
}

function compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}

/** Representation-independent hash of a map (spec "Representation-independent hashing of structured data"). */
export function requestId(content: Content): Uint8Array {
  const parts = Object.entries(content)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => concat(sha256(utf8(k)), hashValue(v as never)))
    .sort(compare);
  return sha256(concat(...parts));
}

/** The 32 bytes an IC request signature covers: SHA-256("\x0Aic-request" ‖ request id). ECDSA secp256k1 signs this digest. */
export function signDigest(id: Uint8Array): Uint8Array {
  return sha256(concat(IC_REQUEST_DOMAIN, id));
}

export function envelope(content: Content, signed?: { publicKeyDer: Uint8Array; signature: Uint8Array }): Uint8Array {
  const map: CborMap = { content: content as unknown as CborValue };
  if (signed) {
    map.sender_pubkey = signed.publicKeyDer;
    map.sender_sig = signed.signature;
  }
  return cborEncode(map);
}

export function callContent(p: { canisterId: Uint8Array; method: string; arg: Uint8Array; sender: Uint8Array; ingressExpiry: bigint; nonce?: Uint8Array }): Content {
  const c: Content = { request_type: "call", canister_id: p.canisterId, method_name: p.method, arg: p.arg, sender: p.sender, ingress_expiry: p.ingressExpiry };
  if (p.nonce) c.nonce = p.nonce;
  return c;
}

export function readStateContent(p: { requestId: Uint8Array; sender: Uint8Array; ingressExpiry: bigint }): Content {
  return { request_type: "read_state", paths: [[utf8("request_status"), p.requestId]], sender: p.sender, ingress_expiry: p.ingressExpiry };
}

/* ------------------------------------------------------------------ certificates (unverified) */

type Tree = CborValue[];

/** Looks a path up in a certificate's hash tree: the leaf, null when absent, "unknown" when pruned away. */
export function lookup(tree: CborValue, path: Uint8Array[]): Uint8Array | null | "unknown" {
  const t = tree as Tree;
  if (!path.length) {
    if (t[0] === 3n && t[1] instanceof Uint8Array) return t[1];
    if (t[0] === 4n) return "unknown";
    return null;
  }
  const [head, ...rest] = path;
  let pruned = false;
  const find = (n: Tree): Tree | null => {
    switch (n[0]) {
      case 1n:
        return find(n[1] as Tree) ?? find(n[2] as Tree);
      case 2n:
        return bytesEqual(n[1] as Uint8Array, head!) ? (n[2] as Tree) : null;
      case 4n:
        pruned = true;
        return null;
      default:
        return null;
    }
  };
  const sub = find(t);
  if (!sub) return pruned ? "unknown" : null;
  return lookup(sub, rest);
}

export interface RequestStatus {
  status: string;
  reply?: Uint8Array;
  rejectCode?: number;
  rejectMessage?: string;
  errorCode?: string;
}

/** The request's status as a (NOT verified) certificate states it, or null if the certificate doesn't say. */
export function requestStatus(certificate: Uint8Array, id: Uint8Array): RequestStatus | null {
  const cert = cborDecode(certificate) as CborMap;
  const tree = cert.tree;
  if (!tree) return null;
  const at = (label: string) => lookup(tree, [utf8("request_status"), id, utf8(label)]);
  const status = at("status");
  if (!(status instanceof Uint8Array)) return null;
  const out: RequestStatus = { status: new TextDecoder().decode(status) };
  const reply = at("reply");
  if (reply instanceof Uint8Array) out.reply = reply;
  const code = at("reject_code");
  if (code instanceof Uint8Array) out.rejectCode = code.reduceRight((n, b) => n * 128 + (b & 0x7f), 0);
  const msg = at("reject_message");
  if (msg instanceof Uint8Array) out.rejectMessage = new TextDecoder().decode(msg);
  const err = at("error_code");
  if (err instanceof Uint8Array) out.errorCode = new TextDecoder().decode(err);
  return out;
}

/* ------------------------------------------------------------------ HTTP */

export class IcRejectError extends Error {
  constructor(
    message: string,
    public readonly rejectCode?: number,
    public readonly errorCode?: string,
  ) {
    super(message);
  }
}

const offline = (cause: unknown) => new ClipError("We couldn't reach the Internet Computer. Check your connection and try again.", "icp/offline", cause);

export class IcClient {
  constructor(
    private readonly host: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  private async post(path: string, body: Uint8Array): Promise<{ status: number; body: Uint8Array }> {
    let r: Response;
    try {
      r = await this.fetchImpl(`${this.host}${path}`, { method: "POST", headers: { "content-type": "application/cbor" }, body: body as BodyInit });
    } catch (e) {
      throw offline(e);
    }
    return { status: r.status, body: new Uint8Array(await r.arrayBuffer()) };
  }

  /** Anonymous query (sender 0x04): the reply's Candid bytes. */
  async query(canisterId: Uint8Array, method: string, arg: Uint8Array, ingressExpiry: bigint): Promise<Uint8Array> {
    const content: Content = { request_type: "query", canister_id: canisterId, method_name: method, arg, sender: ANONYMOUS, ingress_expiry: ingressExpiry };
    const r = await this.post(`/api/v3/canister/${principalToText(canisterId)}/query`, envelope(content));
    if (r.status !== 200) throw new IcRejectError(`HTTP ${r.status}: ${new TextDecoder().decode(r.body).slice(0, 200)}`);
    const m = cborDecode(r.body) as CborMap;
    if (m.status === "replied") {
      const arg = (m.reply as CborMap | undefined)?.arg;
      if (arg instanceof Uint8Array) return arg;
    }
    throw new IcRejectError(String(m.reject_message ?? "query rejected"), Number(m.reject_code ?? 0), typeof m.error_code === "string" ? m.error_code : undefined);
  }

  /**
   * Submits a signed call to the synchronous endpoint. Returns the certificate when the call finished in time, null on
   * 202 (accepted, still running: poll read_state). A non-replicated rejection or HTTP error throws IcRejectError.
   */
  async call(canisterId: Uint8Array, body: Uint8Array): Promise<Uint8Array | null> {
    const r = await this.post(`/api/v4/canister/${principalToText(canisterId)}/call`, body);
    if (r.status === 202) return null;
    if (r.status !== 200) throw new IcRejectError(`HTTP ${r.status}: ${new TextDecoder().decode(r.body).slice(0, 300)}`);
    const m = cborDecode(r.body) as CborMap;
    if (m.status === "replied" && m.certificate instanceof Uint8Array) return m.certificate;
    throw new IcRejectError(String(m.reject_message ?? "call rejected"), Number(m.reject_code ?? 0), typeof m.error_code === "string" ? m.error_code : undefined);
  }

  /** Signed read_state for a request's status: the certificate. */
  async readState(canisterId: Uint8Array, body: Uint8Array): Promise<Uint8Array> {
    const r = await this.post(`/api/v3/canister/${principalToText(canisterId)}/read_state`, body);
    if (r.status !== 200) throw new IcRejectError(`HTTP ${r.status}: ${new TextDecoder().decode(r.body).slice(0, 300)}`);
    const m = cborDecode(r.body) as CborMap;
    if (!(m.certificate instanceof Uint8Array)) throw new IcRejectError("no certificate");
    return m.certificate;
  }
}
