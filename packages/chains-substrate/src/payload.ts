/**
 * Signing payloads for Substrate extrinsics (v4, signed).
 *
 *   payload   = call ‖ extra ‖ additionalSigned        (each extension in metadata order)
 *   signed    = payload.length > 256 ? blake2b-256(payload) : payload
 *   extrinsic = compact(len) ‖ 0x84 ‖ MultiAddress::Id(0x00 ‖ pubkey) ‖ MultiSignature::Sr25519(0x01 ‖ sig) ‖ extra ‖ call
 *
 * Extension values come from the dapp's SignerPayloadJSON (@polkadot/types SignerPayloadJSON; optional fields
 * per @polkadot/types extrinsic/signedExtensions): CheckMortality (era / blockHash), CheckNonce, ChargeTransactionPayment
 * (tip), ChargeAssetTxPayment (tip + Option<assetId>), CheckMetadataHash (mode u8 / Option<[u8;32]>),
 * CheckSpecVersion, CheckTxVersion, CheckGenesis. Extensions whose types are empty encode nothing. Unknown
 * extensions encode as None (Option) / false (bool) when their type allows it; anything else is refused.
 */
import { ClipError } from "@clip-wallet/core";
import { blake2b } from "@noble/hashes/blake2.js";
import { compact, getSs58AddressInfo, u32 } from "@polkadot-api/substrate-bindings";
import type { Runtime } from "./metadata.js";
import { concat, fromHex, isHex, toBig } from "./util.js";

export interface SignerPayloadJSON {
  address: string;
  assetId?: string | null;
  blockHash: string;
  blockNumber: string;
  era: string;
  genesisHash: string;
  metadataHash?: string | null;
  method: string;
  mode?: number;
  nonce: string;
  specVersion: string;
  tip: string;
  transactionVersion: string;
  signedExtensions: string[];
  version: number;
  withSignedTransaction?: boolean;
}

export interface Payload {
  json: SignerPayloadJSON;
  address: string;
  publicKey: Uint8Array;
  method: Uint8Array;
  era: Uint8Array;
  nonce: bigint;
  tip: bigint;
  specVersion: number;
  transactionVersion: number;
  genesisHash: Uint8Array;
  blockHash: Uint8Array;
  blockNumber: bigint;
  assetId: Uint8Array | null;
  mode: number;
  metadataHash: Uint8Array | null;
  signedExtensions: string[];
  withSignedTransaction: boolean;
}

function bad(what: string, cause?: unknown): ClipError {
  return new ClipError(`This request's ${what} can't be read.`, "substrate/bad-payload", cause);
}

export function publicKeyOf(address: string): Uint8Array {
  if (isHex(address) && address.length === 66) return fromHex(address);
  const info = getSs58AddressInfo(address);
  if (!info.isValid || info.publicKey.length !== 32) throw new ClipError("That isn't a Polkadot-style address.", "substrate/bad-address");
  return info.publicKey;
}

const hash32 = (v: unknown, what: string) => {
  if (!isHex(v) || v.length !== 66) throw bad(what);
  return fromHex(v);
};

export function parsePayload(json: unknown): Payload {
  if (!json || typeof json !== "object") throw bad("details");
  const j = json as SignerPayloadJSON;
  if (j.version !== 4) throw new ClipError("Clip Wallet only signs version 4 transactions.", "substrate/unsupported-version");
  if (!isHex(j.method)) throw bad("action");
  if (!isHex(j.era) || (j.era !== "0x00" && j.era.length !== 6)) throw bad("validity period");
  try {
    const opt = (v: unknown) => (v === undefined || v === null || v === "0x" ? null : isHex(v) ? fromHex(v) : (() => { throw bad("asset id"); })());
    const metadataHash = opt(j.metadataHash);
    if (metadataHash && metadataHash.length !== 32) throw bad("metadata hash");
    const mode = j.mode === undefined || j.mode === null ? 0 : Number(j.mode);
    if (mode !== 0 && mode !== 1) throw bad("metadata mode");
    if (mode === 1 && !metadataHash) throw bad("metadata hash");
    return {
      json: j,
      address: j.address,
      publicKey: publicKeyOf(j.address),
      method: fromHex(j.method),
      era: fromHex(j.era),
      nonce: toBig(j.nonce, "nonce"),
      tip: toBig(j.tip, "tip"),
      specVersion: Number(toBig(j.specVersion, "spec version")),
      transactionVersion: Number(toBig(j.transactionVersion, "transaction version")),
      genesisHash: hash32(j.genesisHash, "network"),
      blockHash: hash32(j.blockHash, "block"),
      blockNumber: toBig(j.blockNumber, "block number"),
      assetId: opt(j.assetId),
      mode,
      metadataHash: mode === 1 ? metadataHash : null,
      signedExtensions: Array.isArray(j.signedExtensions) ? j.signedExtensions.map(String) : [],
      withSignedTransaction: j.withSignedTransaction === true,
    };
  } catch (e) {
    if (e instanceof ClipError) throw e;
    throw bad("details", e);
  }
}

const u8 = (n: number) => Uint8Array.of(n);
const none = u8(0);
const some = (b: Uint8Array) => concat(u8(1), b);

function isVoid(rt: Runtime, id: number): boolean {
  return rt.lookup(id).type === "void";
}

/** extra (in the extrinsic) and additionalSigned (only in the signed payload), in metadata order. */
export function extensionParts(rt: Runtime, p: Payload): { extra: Uint8Array; additional: Uint8Array; unknown: string[] } {
  const extra: Uint8Array[] = [];
  const additional: Uint8Array[] = [];
  const unknown: string[] = [];
  for (const e of rt.extensions) {
    const voidType = isVoid(rt, e.type);
    const voidAdd = isVoid(rt, e.additionalSigned);
    switch (e.identifier) {
      case "CheckMortality":
      case "CheckEra":
        extra.push(p.era);
        additional.push(p.era[0] === 0 ? p.genesisHash : p.blockHash);
        continue;
      case "CheckNonce":
        extra.push(compact.enc(p.nonce));
        continue;
      case "ChargeTransactionPayment":
        extra.push(compact.enc(p.tip));
        continue;
      case "ChargeAssetTxPayment":
        extra.push(compact.enc(p.tip), p.assetId ? some(p.assetId) : none);
        continue;
      case "SkipCheckIfFeeless": {
        // Wraps one of the two payment extensions; its type is the wrapped one's.
        const t = rt.lookup(e.type) as { type: string; value?: Record<string, unknown> };
        if (t.type === "compact") extra.push(compact.enc(p.tip));
        else if (t.type === "struct" && t.value && "asset_id" in t.value) extra.push(compact.enc(p.tip), p.assetId ? some(p.assetId) : none);
        else unknown.push(e.identifier);
        continue;
      }
      case "CheckMetadataHash":
        extra.push(u8(p.mode));
        additional.push(p.mode === 1 && p.metadataHash ? some(p.metadataHash) : none);
        continue;
      case "CheckSpecVersion":
      case "CheckVersion":
        additional.push(u32.enc(p.specVersion));
        continue;
      case "CheckTxVersion":
        additional.push(u32.enc(p.transactionVersion));
        continue;
      case "CheckGenesis":
        additional.push(p.genesisHash);
        continue;
    }
    // Anything else: only empty types, Option (None) or bool (false) can be filled without the dapp's input.
    if (!voidType) {
      const t = rt.lookup(e.type).type;
      const prim = rt.lookup(e.type) as { type: string; value?: unknown };
      if (t === "option") extra.push(none);
      else if (t === "primitive" && prim.value === "bool") extra.push(u8(0));
      else unknown.push(e.identifier);
    }
    if (!voidAdd) unknown.push(e.identifier);
  }
  return { extra: concat(...extra), additional: concat(...additional), unknown };
}

/** The exact bytes the sr25519 key signs. */
export function signingBytes(rt: Runtime, p: Payload): Uint8Array {
  const { extra, additional, unknown } = extensionParts(rt, p);
  if (unknown.length) {
    throw new ClipError(`This network uses a transaction extension Clip Wallet doesn't know yet (${unknown.join(", ")}).`, "substrate/unknown-extension");
  }
  const payload = concat(p.method, extra, additional);
  return payload.length > 256 ? blake2b(payload, { dkLen: 32 }) : payload;
}

/** MultiAddress::Id for runtimes whose Address is MultiAddress; the raw account id otherwise. */
function addressBytes(rt: Runtime, publicKey: Uint8Array): Uint8Array {
  const t = rt.lookup(rt.addressType) as { type: string; value?: Record<string, { idx: number }> };
  if (t.type === "enum" && t.value?.Id) return concat(u8(t.value.Id.idx), publicKey);
  return publicKey;
}

/** MultiSignature::Sr25519 (index from metadata, 1 on every Polkadot SDK chain). */
export function multiSignature(rt: Runtime | null, signature: Uint8Array): Uint8Array {
  const t = rt ? (rt.lookup(rt.signatureType) as { type: string; value?: Record<string, { idx: number }> }) : null;
  const idx = t?.type === "enum" && t.value?.Sr25519 ? t.value.Sr25519.idx : 1;
  return concat(u8(idx), signature);
}

/** Signed v4 extrinsic, length-prefixed (what author_submitExtrinsic takes). */
export function signedExtrinsic(rt: Runtime, p: Payload, signature: Uint8Array): Uint8Array {
  const { extra } = extensionParts(rt, p);
  const body = concat(u8(0x84), addressBytes(rt, p.publicKey), multiSignature(rt, signature), extra, p.method);
  return concat(compact.enc(body.length), body);
}

/** Mortal era for `period` blocks (power of two, 4..65536) starting at `blockNumber`. */
export function mortalEra(blockNumber: bigint, period = 64): Uint8Array {
  const p = Math.min(Math.max(period, 4), 1 << 16);
  const calPeriod = 2 ** Math.ceil(Math.log2(p));
  const phase = Number(blockNumber % BigInt(calPeriod));
  const quantizeFactor = Math.max(calPeriod >> 12, 1);
  const quantizedPhase = Math.floor(phase / quantizeFactor) * quantizeFactor;
  const trailingZeros = Math.log2(calPeriod);
  const encoded = Math.min(15, Math.max(1, trailingZeros - 1)) + ((quantizedPhase / quantizeFactor) << 4);
  return Uint8Array.of(encoded & 0xff, encoded >> 8);
}

/** { period, birth } of a mortal era relative to the block it was made at; null for immortal. */
export function eraInfo(era: Uint8Array, blockNumber: bigint): { period: number; birth: bigint } | null {
  if (era[0] === 0) return null;
  const encoded = era[0]! + (era[1]! << 8);
  const period = 2 << (encoded % (1 << 4));
  const quantizeFactor = Math.max(period >> 12, 1);
  const phase = (encoded >> 4) * quantizeFactor;
  const current = blockNumber;
  const birth = ((current > BigInt(phase) ? current - BigInt(phase) : 0n) / BigInt(period)) * BigInt(period) + BigInt(phase);
  return { period, birth };
}
