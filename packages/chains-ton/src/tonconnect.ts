import "./buffer.js";
import { ClipError } from "@clip-wallet/core";
import { type Address, beginCell } from "@ton/core";
import { sha256 } from "@noble/hashes/sha2.js";
import { cellFromB64 } from "./payload.js";
import { b64decode, concat, crc32, i32, u32, u64 } from "./util.js";

/**
 * TON Connect payloads (ton-connect/docs: spec/rpc.md, spec/connect.md). Requests reach the module with the
 * payload as an object, a JSON string, or TON Connect's wire form `[jsonString]`.
 */
export function payloadOf(params: unknown): Record<string, unknown> {
  let p = params;
  if (Array.isArray(p)) p = p[0];
  if (typeof p === "string") {
    try {
      p = JSON.parse(p);
    } catch {
      throw new ClipError("This request can't be read.", "ton/bad-params");
    }
  }
  if (!p || typeof p !== "object" || Array.isArray(p)) throw new ClipError("This request can't be read.", "ton/bad-params");
  return p as Record<string, unknown>;
}

export interface RawMessage {
  address: string;
  amount: string;
  payload?: string;
  stateInit?: string;
  extra_currency?: Record<string, string>;
}
export type TxItem =
  | ({ type: "ton" } & RawMessage)
  | {
      type: "jetton";
      master: string;
      destination: string;
      amount: string;
      attachAmount?: string;
      queryId?: string;
      responseDestination?: string;
      customPayload?: string;
      forwardAmount?: string;
      forwardPayload?: string;
    }
  | {
      type: "nft";
      nftAddress: string;
      newOwner: string;
      attachAmount?: string;
      queryId?: string;
      responseDestination?: string;
      customPayload?: string;
      forwardAmount?: string;
      forwardPayload?: string;
    };

export interface SendTxPayload {
  valid_until?: number;
  network?: string;
  from?: string;
  messages?: RawMessage[];
  items?: TxItem[];
}

const DEC = /^\d+$/;

export function parseSendTx(params: unknown): SendTxPayload {
  const p = payloadOf(params) as SendTxPayload & Record<string, unknown>;
  const hasM = Array.isArray(p.messages);
  const hasI = Array.isArray(p.items);
  if (hasM === hasI) throw new ClipError("This request must list either messages or items.", "ton/bad-params");
  const list = (hasM ? p.messages : p.items) as unknown[];
  if (!list.length) throw new ClipError("This request has nothing to send.", "ton/bad-params");
  for (const m of list) {
    const o = (m ?? {}) as Record<string, unknown>;
    if (hasM && (typeof o.address !== "string" || typeof o.amount !== "string" || !DEC.test(o.amount))) {
      throw new ClipError("This request has a message without a valid address or amount.", "ton/bad-params");
    }
    if (o.extra_currency !== undefined) throw new ClipError("Clip Wallet doesn't send extra currencies yet.", "ton/unsupported");
  }
  if (p.valid_until !== undefined && (typeof p.valid_until !== "number" || !Number.isFinite(p.valid_until))) {
    throw new ClipError("This request has an invalid expiry.", "ton/bad-params");
  }
  return p;
}

/* ------------------------------------------------------------------ signData */

export type SignDataPayload =
  | { type: "text"; text: string; network?: string; from?: string }
  | { type: "binary"; bytes: string; network?: string; from?: string }
  | { type: "cell"; schema: string; cell: string; network?: string; from?: string };

export function parseSignData(params: unknown): SignDataPayload {
  const p = payloadOf(params) as Record<string, unknown>;
  if (p.type === "text" && typeof p.text === "string") return p as SignDataPayload;
  if (p.type === "binary" && typeof p.bytes === "string") return p as SignDataPayload;
  if (p.type === "cell" && typeof p.schema === "string" && typeof p.cell === "string") return p as SignDataPayload;
  throw new ClipError("This signature request can't be read.", "ton/bad-params");
}

const enc = new TextEncoder();

/**
 * Hash the wallet signs for signData (rpc.md "Signature — text and binary" / "— cell"). Integers are big-endian,
 * as in the TON Connect sign-data reference implementation (github.com/mois-ilya/ton-sign-data-reference).
 */
export function signDataHash(p: SignDataPayload, address: Address, domain: string, timestamp: number): Uint8Array {
  if (p.type === "cell") {
    const cell = cellFromB64(p.cell, "cell");
    return new Uint8Array(
      beginCell()
        .storeUint(0x75569022, 32)
        .storeUint(crc32(enc.encode(p.schema)), 32)
        .storeUint(timestamp, 64)
        .storeAddress(address)
        .storeStringRefTail(dnsWire(domain))
        .storeRef(cell)
        .endCell()
        .hash(),
    );
  }
  const domainBytes = enc.encode(domain);
  const data = p.type === "text" ? enc.encode(p.text) : b64decode(p.bytes);
  return sha256(
    concat(
      new Uint8Array([0xff, 0xff]),
      enc.encode("ton-connect/sign-data/"),
      i32(address.workChain),
      new Uint8Array(address.hash),
      u32(domainBytes.length),
      domainBytes,
      u64(timestamp),
      enc.encode(p.type === "text" ? "txt" : "bin"),
      u32(data.length),
      data,
    ),
  );
}

/** TEP-81 DNS wire form: labels reversed, each followed by \0 ("app.example" → "example\0app\0"). */
export function dnsWire(domain: string): string {
  const d = domain.toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
  return d.split(".").reverse().map((l) => `${l}\0`).join("");
}

/* ------------------------------------------------------------------ ton_proof */

/**
 * ton_proof (connect.md "Address proof signature"): domain length and timestamp are little-endian here.
 * signature = Ed25519(sha256(0xffff ++ "ton-connect" ++ sha256(message))).
 */
export function tonProofHash(address: Address, domain: string, timestamp: number, payload: string): Uint8Array {
  const domainBytes = enc.encode(domain);
  const message = concat(
    enc.encode("ton-proof-item-v2/"),
    i32(address.workChain),
    new Uint8Array(address.hash),
    u32(domainBytes.length, true),
    domainBytes,
    u64(timestamp, true),
    enc.encode(payload),
  );
  return sha256(concat(new Uint8Array([0xff, 0xff]), enc.encode("ton-connect"), sha256(message)));
}
