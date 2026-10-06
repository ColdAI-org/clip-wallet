// packages/desktop/electron.vite.config.ts: the whole desktop app comes from @clip-wallet/desktop-kit.
// clipDesktop() returns the complete electron-vite config (main process, preloads, pages, native-messaging host).
import { clipDesktop } from "@clip-wallet/desktop-kit/electron-vite";
import clipConfig from "../../clip.config";

export default clipDesktop({ config: clipConfig, root: import.meta.dirname, configDir: "../.." });
