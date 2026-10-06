/**
 * The extension is @clip-wallet/extension-kit; this project is the brand. clipWallet() builds the WXT config from the
 * wallet's one clip.config.ts (at the project root, shared with the desktop and phone apps): manifest identity, 1Mask
 * announcements, the security floor (not configurable) and the mainnet checklist (a mainnet build is refused until it
 * is done).
 */
import { defineConfig } from "wxt";
import { clipWallet } from "@clip-wallet/extension-kit/wxt";
import clipConfig from "../../clip.config";

export default defineConfig(clipWallet({ config: clipConfig, root: import.meta.dirname, configDir: "../.." }));
