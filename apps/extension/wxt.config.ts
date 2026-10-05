/**
 * Clip Wallet's own extension: the same shape every kit-built wallet has (templates/scaffold-hbar-clip-wallet/
 * packages/extension). The extension itself is @clip-wallet/extension-kit; this project is the brand.
 *
 * In this monorepo the scripts run Node with --conditions=development, so workspace packages resolve to their
 * TypeScript source and nothing needs building first.
 */
import { defineConfig } from "wxt";
import { clipWallet } from "@clip-wallet/extension-kit/wxt";
import clipConfig from "./clip.config";

export default defineConfig(clipWallet({ config: clipConfig, root: import.meta.dirname }));
