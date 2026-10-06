/**
 * Auto-update through electron-updater (https://www.electron.build/auto-update). Wired, and OFF: it turns on only in
 * a packaged build made with CLIP_UPDATES=1 (electron.vite.config.ts → __CLIP_UPDATES__), which the release
 * workflow sets once code signing exists (macOS updates require a signed app; Windows NSIS updates verify the
 * publisher of a signed installer). The feed comes from electron-builder's `publish` config (app-update.yml).
 *
 * Behaviour when on: check at start and every 6 hours, download in the background, install on the next quit.
 * Never restarts the app on its own.
 */
import { app } from "electron";

declare const __CLIP_UPDATES__: boolean;

export function updatesEnabled(): boolean {
  return typeof __CLIP_UPDATES__ !== "undefined" && __CLIP_UPDATES__ === true && app.isPackaged;
}

export async function startAutoUpdate(): Promise<void> {
  if (!updatesEnabled()) return;
  const { autoUpdater } = await import("electron-updater");
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined);
  check();
  setInterval(check, 6 * 60 * 60 * 1000).unref();
}
