/**
 * BIP-32 PUBLIC derivation only (CKDpub, xpub/tpub encoding). No private keys ever: this is what lets
 * the extension show a hardware wallet's addresses from an account-level xpub. Tested against the
 * official BIP-32 test vectors (public-derivation steps).
 * https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hmac } from "@noble/hashes/hmac.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { createBase58check } from "@scure/base";
import { toHex } from "./bytes.js";

const b58c = createBase58check(sha256);
const N = secp256k1.Point.CURVE().n;

export const XPUB_VERSIONS = {
  xpub: 0x0488b21e,
  tpub: 0x043587cf,
} as const;

export interface PublicNode {
  version: number;
  depth: number;
  parentFingerprint: number;
  childNumber: number;
  chainCode: Uint8Array;
  /** 33-byte compressed. */
  publicKey: Uint8Array;
}

export const hash160 = (b: Uint8Array): Uint8Array => ripemd160(sha256(b));

/** First 4 bytes of HASH160(pubkey), as a number and as 8 hex chars. */
export function fingerprintOf(publicKey: Uint8Array): { n: number; hex: string } {
  const h = hash160(publicKey).subarray(0, 4);
  return { n: new DataView(h.buffer, h.byteOffset, 4).getUint32(0, false), hex: toHex(h) };
}

export function decodeXpub(xpub: string): PublicNode {
  const raw = b58c.decode(xpub);
  if (raw.length !== 78) throw new Error("extended key must be 78 bytes");
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.length);
  const version = dv.getUint32(0, false);
  if (version !== XPUB_VERSIONS.xpub && version !== XPUB_VERSIONS.tpub) throw new Error("not an xpub/tpub");
  const publicKey = raw.slice(45, 78);
  if (publicKey[0] !== 2 && publicKey[0] !== 3) throw new Error("not a public extended key");
  secp256k1.Point.fromBytes(publicKey); // throws if not on the curve
  return {
    version,
    depth: raw[4]!,
    parentFingerprint: dv.getUint32(5, false),
    childNumber: dv.getUint32(9, false),
    chainCode: raw.slice(13, 45),
    publicKey,
  };
}

export function encodeXpub(n: PublicNode): string {
  const out = new Uint8Array(78);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, n.version, false);
  out[4] = n.depth;
  dv.setUint32(5, n.parentFingerprint >>> 0, false);
  dv.setUint32(9, n.childNumber >>> 0, false);
  out.set(n.chainCode, 13);
  out.set(n.publicKey, 45);
  return b58c.encode(out);
}

/** CKDpub: non-hardened child of a public node. */
export function deriveChild(node: PublicNode, index: number): PublicNode {
  if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) throw new RangeError("public derivation needs a non-hardened index");
  const data = new Uint8Array(37);
  data.set(node.publicKey, 0);
  new DataView(data.buffer).setUint32(33, index, false);
  const I = hmac(sha512, node.chainCode, data);
  const IL = I.subarray(0, 32);
  const tweak = BigInt(`0x${toHex(IL)}`);
  if (tweak >= N) throw new Error("invalid child (IL >= n); use the next index");
  const child = secp256k1.Point.BASE.multiply(tweak).add(secp256k1.Point.fromBytes(node.publicKey));
  if (child.equals(secp256k1.Point.ZERO)) throw new Error("invalid child (point at infinity); use the next index");
  return {
    version: node.version,
    depth: node.depth + 1,
    parentFingerprint: fingerprintOf(node.publicKey).n,
    childNumber: index,
    chainCode: I.slice(32),
    publicKey: child.toBytes(true),
  };
}

export function derivePublic(node: PublicNode, relative: number[]): PublicNode {
  return relative.reduce(deriveChild, node);
}

/** Builds a node from raw parts (e.g. a Keystone crypto-hdkey). */
export function publicNode(publicKey: Uint8Array, chainCode: Uint8Array, opts: Partial<Omit<PublicNode, "publicKey" | "chainCode">> = {}): PublicNode {
  if (chainCode.length !== 32) throw new Error("chain code must be 32 bytes");
  const pk = secp256k1.Point.fromBytes(publicKey).toBytes(true);
  return {
    version: opts.version ?? XPUB_VERSIONS.xpub,
    depth: opts.depth ?? 0,
    parentFingerprint: opts.parentFingerprint ?? 0,
    childNumber: opts.childNumber ?? 0,
    chainCode,
    publicKey: pk,
  };
}
