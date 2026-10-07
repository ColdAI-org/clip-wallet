import { compactSize, concat, sha256d, utf8 } from "./util.js";

/**
 * Message signing as Electron Cash (and wc2-bch-bcr `bch_signMessage`) does it: the Bitcoin signed-message format,
 * double SHA-256 of CompactSize(24) ‖ "Bitcoin Signed Message:\n" ‖ CompactSize(len) ‖ message, answered as base64 of
 * header ‖ r ‖ s with header = 27 + recovery id + 4 (compressed key).
 */
export const MESSAGE_MAGIC = "Bitcoin Signed Message:\n";

export function messageHash(message: string | Uint8Array): Uint8Array {
  const m = typeof message === "string" ? utf8(message) : message;
  const magic = utf8(MESSAGE_MAGIC);
  return sha256d(concat(compactSize(magic.length), magic, compactSize(m.length), m));
}

export function compactSignatureBase64(rs: Uint8Array, recovery: number): string {
  const b = new Uint8Array(65);
  b[0] = 27 + recovery + 4;
  b.set(rs, 1);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
