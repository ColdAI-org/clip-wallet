// packages/extension/wxt.config.ts: the whole extension comes from @clip-wallet/extension-kit.
// configDir: the project's one clip.config.ts, icon, MAINNET.md and .env live two folders up, at the root.
import { defineConfig } from "wxt";
import { clipWallet } from "@clip-wallet/extension-kit/wxt";
import clipConfig from "../../clip.config";

export default defineConfig(clipWallet({ config: clipConfig, root: import.meta.dirname, configDir: "../.." }));
