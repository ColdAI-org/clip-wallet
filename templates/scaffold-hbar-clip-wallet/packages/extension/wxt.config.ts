/**
 * The extension is @clip-wallet/extension-kit; this project is the brand. clipWallet() builds the WXT config from
 * clip.config.ts: manifest identity, 1Mask announcements, the security floor (not configurable) and the mainnet
 * checklist (a mainnet build is refused until it is done).
 */
import { defineConfig } from "wxt";
import { clipWallet } from "@clip-wallet/extension-kit/wxt";
import clipConfig from "./clip.config";

export default defineConfig(clipWallet({ config: clipConfig, root: import.meta.dirname }));
