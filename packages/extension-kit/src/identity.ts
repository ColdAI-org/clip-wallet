/** Identity helpers shared by the build (wxt.ts) and the pages. Pure functions. */
import type { ClipConfig } from "@clip-wallet/config";

/**
 * The Chrome extension id for a manifest `key` (base64 DER SubjectPublicKeyInfo): the first 128 bits of its
 * SHA-256, written with the letters a-p. `sha256` is injected so this file stays free of Node built-ins.
 */
export function extensionIdFromDigest(digest: Uint8Array): string {
  let id = "";
  for (const byte of digest.subarray(0, 16)) id += String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15));
  return id;
}

/**
 * Where the passkey web-bridge page lives: `<rpOrigin>/clip-passkey-bridge` when passkeys are bound to an https
 * origin you own, else a placeholder that is never contacted (the extension origin is the WebAuthn RP).
 */
export function passkeyBridgeUrl(config: Pick<ClipConfig, "passkeys">): string {
  const o = config.passkeys.rpOrigin;
  return o?.startsWith("https://") ? `${o}/clip-passkey-bridge` : "https://passkey.clipwallet.example/bridge";
}
