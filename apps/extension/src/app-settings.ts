/**
 * Runtime settings that are not brand config (brand lives in clip.config.ts / @clip-wallet/config).
 */
import config from "../clip.config";

/**
 * PLACEHOLDER origin for the passkey web-bridge page (passkey-bridge/). Used only when passkeys must run
 * on a web origin (Chrome < 122, Firefox < 150, or rpOrigin set to an https origin). Not hosted yet.
 */
export const PASSKEY_BRIDGE_URL =
  config.passkeys.rpOrigin?.startsWith("https://") ? `${config.passkeys.rpOrigin}/clip-passkey-bridge` : "https://passkey.clipwallet.example/bridge";

/** WebAuthn rp.id: null = the extension id (default origin of the calling extension page). */
export function passkeyRpId(): string | null {
  const o = config.passkeys.rpOrigin;
  if (!o) return null;
  if (o.startsWith("https://")) return new URL(o).hostname;
  return o.replace(/^(chrome|moz)-extension:\/\//, "");
}

/** Untrusted NFT media proxy. Unset until the proxy service exists: placeholders, nothing remote fetched. */
export const MEDIA_PROXY_URL: string | undefined = undefined;

export const CURRENCIES = ["USD", "EUR", "GBP"];
