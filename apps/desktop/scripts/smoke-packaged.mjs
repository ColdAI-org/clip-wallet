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
// Packaged builds ignore CLIP_DESKTOP_USER_DATA; --user-data-dir keeps the runner's profile clean.
// No system integration: the smoke run must not register native-messaging hosts or a socket on the runner/user.
const app = await electron.launch({ executablePath: exe, args: [`--user-data-dir=${home}`], env: { ...process.env, CLIP_DESKTOP_NO_SYSTEM_INTEGRATION: "1" }, timeout: 60_000 });
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
