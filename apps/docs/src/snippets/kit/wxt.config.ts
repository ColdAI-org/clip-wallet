// packages/extension/wxt.config.ts: the whole extension comes from @clip-wallet/extension-kit.
import { defineConfig } from "wxt";
import { clipWallet } from "@clip-wallet/extension-kit/wxt";
import clipConfig from "./clip.config";

export default defineConfig(clipWallet({ config: clipConfig, root: import.meta.dirname }));
