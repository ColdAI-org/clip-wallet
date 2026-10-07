/**
 * Clip Wallet desktop is @clip-wallet/desktop-kit; this project is the brand. clipDesktop() builds the electron-vite
 * config from clip.config.ts: identity, the resolved config for the main process and pages, the native-messaging host
 * and the mainnet checklist.
 *
 * Build-time switches (public values only; never secrets):
 *   CLIP_WC_PROJECT_ID   Reown project id for WalletConnect (unset: WalletConnect says it isn't switched on)
 *   CLIP_UPDATES=1       turn electron-updater on (only for signed release builds, see the kit's src/main/updater.ts)
 *   CLIP_EXTENSION_IDS   Chromium extension ids allowed to use Clip Desktop over native messaging (Firefox's is fixed)
 */
import { defineConfig } from "electron-vite";
import { clipDesktop } from "@clip-wallet/desktop-kit/electron-vite";
import clipConfig from "./clip.config";

// electron-vite 5's isolated-entries progress line calls process.stdout.clearLine/cursorTo, which exist only on a
// TTY (also moveCursor); in CI and piped builds they are missing and the preload build throws. No-ops keep the output plain.
const out = process.stdout as unknown as Record<string, unknown>;
out.clearLine ??= () => true;
out.cursorTo ??= () => true;
out.moveCursor ??= () => true;

export default defineConfig(clipDesktop({ config: clipConfig, root: import.meta.dirname }) as never);
