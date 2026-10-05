// Smoke test for a PACKAGED app (CI, after electron-builder): it starts, the wallet window serves the onboarding
// screen from the app bundle over clip-app:, a dapp page can't see Node, and it quits. Usage: node scripts/smoke-packaged.mjs <executable>
import { _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exe = process.argv[2];
if (!exe) {
  console.error("usage: smoke-packaged.mjs <path to the packaged executable>");
  process.exit(2);
}
const home = mkdtempSync(join(tmpdir(), "clip-smoke-"));
// macOS: a mock keychain (no login-Keychain items or consent prompts on the runner). No system integration: the
// smoke run must not register native-messaging hosts or a socket on the runner / this machine.
const launchOnce = () =>
  electron.launch({
    executablePath: exe,
    args: [`--user-data-dir=${home}`, ...(process.platform === "darwin" ? ["--use-mock-keychain"] : [])],
    env: { ...process.env, CLIP_DESKTOP_NO_SYSTEM_INTEGRATION: "1" },
    timeout: 30_000,
  });
// Playwright's attach to a packaged Electron app occasionally misses the app's start when it is very fast (seen on
// Apple silicon: the app itself starts every time when run directly). Retry the attach, not the checks.
let app;
for (let attempt = 1; !app; attempt++) {
  try {
    app = await launchOnce();
  } catch (e) {
    if (attempt >= 3) throw e;
    console.error(`launch attempt ${attempt} timed out; retrying`);
  }
}
try {
  const win = await app.firstWindow();
  await win.waitForURL(/^clip-app:\/\/wallet\/wallet\//, { timeout: 30_000 });
  await win.getByRole("button", { name: "Create a new wallet" }).waitFor({ timeout: 30_000 });
  const csp = await win.evaluate(() => typeof window.clipDesktop === "object" && typeof window.require === "undefined" && typeof window.process === "undefined");
  if (!csp) throw new Error("the wallet window exposes more than the bridge");
  console.log(`smoke ok: ${await app.evaluate(({ app: a }) => `${a.getName()} ${a.getVersion()} (Electron ${process.versions.electron})`)}`);
} finally {
  await app.close().catch(() => undefined);
  rmSync(home, { recursive: true, force: true });
}
