/**
 * Brand config comes from `@clip-wallet/config` (the single schema for clip.config.ts): name, icon,
 * theme { accent, accentText, font, radius }, passkeys, networks, route, mainnet opt-in.
 * Screens never hard-code a colour or the product name; they read tokens derived from it (tokens.ts).
 *
 * `UiOptions` holds the few app-runtime values that are not brand config: the bundled icon URL the
 * extension resolved, the untrusted-media proxy, and the display currencies offered in Settings.
 */
import { defineConfig, type ClipConfig } from "@clip-wallet/config";

export type { ClipConfig };

export interface UiOptions {
  /** URL of the bundled brand icon (the extension copies clip.config's icon into its public dir). */
  iconUrl: string;
  /**
   * Media proxy for untrusted NFT media. Every image/video URL from token metadata is rewritten to
   * `${mediaProxyUrl}?url=<encoded>` and fetched only from there. Unset = no remote media at all
   * (placeholders are drawn instead).
   */
  mediaProxyUrl?: string;
  /** Display currencies offered in Settings. */
  currencies: string[];
}

/** Clip Wallet's own look: ColdAI orange with white text on orange buttons (owner preference), Inter. */
export const defaultClipConfig: ClipConfig = defineConfig({
  name: "Clip Wallet",
  rdns: "org.coldai.clipwallet",
  theme: { accent: "#FF3C00", accentText: "#FFFFFF", font: "Inter", radius: 14 },
  mainnet: false,
});

export const defaultUiOptions: UiOptions = {
  iconUrl: "/icon/128.png",
  currencies: ["USD", "EUR", "GBP"],
};
