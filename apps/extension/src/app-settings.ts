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

/** WebAuthn rp.id from clip.config passkeys.rpOrigin; null = use the extension id (passed explicitly: extension pages have no default RP id). */
export function passkeyRpId(): string | null {
  const o = config.passkeys.rpOrigin;
  if (!o) return null;
  if (o.startsWith("https://")) return new URL(o).hostname;
  return o.replace(/^(chrome|moz)-extension:\/\//, "");
}

/**
 * Untrusted NFT media proxy (services/media-proxy), from clip.config `services.mediaProxyUrl`. Unset until the
 * proxy is deployed: placeholders, nothing remote fetched.
 */
export const MEDIA_PROXY_URL: string | undefined = config.services.mediaProxyUrl;

/**
 * Backup service (services/backup), from clip.config `services.backupUrl`. Unset = passkey backup hidden
 * ("isn't available in this version"). Not deployed yet. Passkey backups only restore where the same rpId
 * works: set passkeys.rpOrigin before turning this on.
 */
export const BACKUP_SERVICE_URL: string | undefined = config.services.backupUrl;

export const CURRENCIES = ["USD", "EUR", "GBP"];
