import { sha256 } from "@noble/hashes/sha2.js";
import { type CV, serializeCV } from "./clarity.js";
import { concat, utf8 } from "./util.js";

/**
 * Message signing as Leather and Xverse do it (SIP-030 `stx_signMessage` / `stx_signStructuredMessage`):
 *  - plain: SHA-256("\x17Stacks Signed Message:\n" ‖ varint(len) ‖ utf8(message)) (@stacks/encryption
 *    `hashMessage`/`encodeMessage`; 0x17 = 23 = the prefix's length; varint as Bitcoin's CompactSize).
 *  - structured (SIP-018): SHA-256("SIP018" ‖ SHA-256(domain) ‖ SHA-256(message)) over the SIP-005 serialization of
 *    each Clarity value (@stacks/transactions `encodeStructuredDataBytes`). The domain is a tuple with
 *    name (string-ascii), version (string-ascii) and chain-id (uint).
 * The result is "RSV": r ‖ s ‖ recovery id, hex (what @stacks/encryption `verifyMessageSignatureRsv` checks).
 */
export const MESSAGE_PREFIX = "\x17Stacks Signed Message:\n";
export const SIP018_PREFIX = utf8("SIP018");

export function compactSize(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) return new Uint8Array([0xfd, n & 0xff, n >> 8]);
  return new Uint8Array([0xfe, n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
}

export function messageHash(message: string | Uint8Array): Uint8Array {
  const m = typeof message === "string" ? utf8(message) : message;
  return sha256(concat(utf8(MESSAGE_PREFIX), compactSize(m.length), m));
}

export function isDomain(v: CV): boolean {
  if (v.type !== "tuple") return false;
  const { name, version } = v.value;
  const chainId = v.value["chain-id"];
  return name?.type === "ascii" && version?.type === "ascii" && chainId?.type === "uint";
}

export function structuredHash(domain: CV, message: CV): Uint8Array {
  if (!isDomain(domain)) throw new Error("bad SIP-018 domain");
  return sha256(concat(SIP018_PREFIX, sha256(serializeCV(domain)), sha256(serializeCV(message))));
}
