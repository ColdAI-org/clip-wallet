/**
 * The desktop app is @clip-wallet/desktop-kit; this project is the brand. clipDesktop() builds the electron-vite config
 * from the wallet's one clip.config.ts (at the project root, shared with the extension and the phone app): identity,
 * the resolved config for the main process and the pages, the native-messaging host, and the mainnet checklist.
 *
 * Build-time values (public only; never secrets), from the environment or CLIP_* lines in ../../.env or .env:
 *   CLIP_WALLETCONNECT_PROJECT_ID   your WalletConnect Cloud project id (unset: WalletConnect says it isn't switched on)
 *   CLIP_EXTENSION_IDS              your extension's Chromium ids, so it can use this app over native messaging
 *   CLIP_UPDATES=1                  auto-update from GitHub releases (signed builds only; see ../../docs/signing.md)
 */
import { defineConfig } from "electron-vite";
import { clipDesktop } from "@clip-wallet/desktop-kit/electron-vite";
import clipConfig from "../../clip.config";

// electron-vite's progress line needs a TTY; plain no-ops keep CI and piped builds working.
const out = process.stdout as unknown as Record<string, unknown>;
out.clearLine ??= () => true;
out.cursorTo ??= () => true;
out.moveCursor ??= () => true;

export default defineConfig(clipDesktop({ config: clipConfig, root: import.meta.dirname, configDir: "../.." }) as never);
