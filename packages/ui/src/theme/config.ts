/**
 * `clip.config` — everything a kit-built wallet changes to rebrand.
 *
 * A wallet built from the Clip kit edits one object (apps/extension/clip.config.ts) and gets its own
 * name, icon, accent and fonts everywhere: buttons, focus rings, the approval screen, onboarding.
 * Screens never hard-code a colour or a product name; they read the tokens derived from this object.
 */

export interface ClipConfig {
  /** Product name shown in onboarding, the lock screen and approval footers. */
  name: string;
  /** Path or URL of the square brand icon (bundled with the extension, never remote). */
  icon: string;
  /** Primary accent. Buttons, focus rings, selected states. */
  accent: string;
  /** Text colour on top of the accent (owner preference for Clip Wallet: white on orange). */
  accentText: string;
  fonts: {
    /** CSS font-family stack for all UI text. */
    body: string;
    /** CSS font-family stack for addresses, amounts in Advanced mode and raw data. */
    mono: string;
  };
  /** Corner radius scale in px: small controls, cards, sheets. */
  radius?: { sm: number; md: number; lg: number };
  /**
   * Media proxy for untrusted NFT media. Every image/video URL from token metadata is rewritten to
   * `${mediaProxyUrl}?url=<encoded>` and fetched only from there. Unset = no remote media at all
   * (placeholders are drawn instead).
   */
  mediaProxyUrl?: string;
  /** Passkey (WebAuthn PRF) unlock. */
  passkey: {
    /**
     * WebAuthn relying-party id. `null` = the extension's own id (Chrome 122+ lets an extension page
     * use its id as rp.id). A web domain works too when it is listed in host_permissions; that domain
     * keeps passkeys stable across extension ids and browsers.
     */
    rpId: string | null;
    /** Fallback ceremony page on a web origin (older browsers, Firefox < 150). Placeholder until hosted. */
    bridgeUrl: string;
    /** "extension" runs the ceremony in an extension tab; "web-bridge" opens bridgeUrl. */
    mode: "extension" | "web-bridge";
  };
  /** Display currencies offered in Settings. */
  currencies: string[];
  /** Support / docs link shown in Settings. */
  supportUrl?: string;
}

export const defaultClipConfig: ClipConfig = {
  name: "Clip Wallet",
  icon: "/icon/128.png",
  accent: "#FF3C00",
  accentText: "#FFFFFF",
  fonts: {
    body: '"Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  },
  radius: { sm: 10, md: 14, lg: 20 },
  passkey: {
    rpId: null,
    bridgeUrl: "https://passkey.clipwallet.example/bridge",
    mode: "extension",
  },
  currencies: ["USD", "EUR", "GBP"],
};

/** Shallow-merges a partial config onto the defaults (nested objects merged one level deep). */
export function defineClipConfig(partial: Partial<ClipConfig>): ClipConfig {
  return {
    ...defaultClipConfig,
    ...partial,
    fonts: { ...defaultClipConfig.fonts, ...partial.fonts },
    radius: { ...defaultClipConfig.radius!, ...partial.radius },
    passkey: { ...defaultClipConfig.passkey, ...partial.passkey },
  };
}
