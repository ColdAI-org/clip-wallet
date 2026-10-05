# Integration: desktop app (apps/desktop)

New package `@clip-wallet/desktop` (Electron 44, electron-vite 5, electron-builder 26). Everything lives in
`apps/desktop`; no shared package source changed. Edits outside the app:

1. `tools/harness/check.mjs`: `VAULT_IMPORT_ALLOW` gains `/^apps\/desktop\/src\/main\/host\//` (the main-process
   host, like `apps/mobile/src/background/`), and the vault-import message names the mobile/desktop hosts.
   `tools/harness/test/check.test.mjs` asserts the host is allowed and that the desktop main bootstrap, browser,
   preloads, renderer and a look-alike folder (`src/main/hostile/`) are not.
2. `pnpm-workspace.yaml` `allowBuilds`: `electron: true` (downloads the platform binary on install),
   `electron-winstaller: false` (Squirrel.Windows helper, unused: NSIS + zip only).
3. `.github/workflows/desktop.yml`: macOS / Windows / Ubuntu matrix (typecheck, unit tests, build, Playwright e2e,
   electron-builder, packaged smoke test, artifacts). Not run yet.
4. `pnpm-lock.yaml`: the new app's dev dependencies.

Shared engine/UI contracts are used as-is: `WalletEngine.handleUntrusted`, `EngineHardware.handleUntrusted`,
`engine.attachDappPort`, `createEngineDependencies`, `WalletApp` / `ApprovalWindowApp`, `createSocialClient`.

Follow-ups worth considering in shared code (not done here):
- `packages/ui`: hide the "Unlock with Face ID or Touch ID?" onboarding offer when the host passes no `passkeys`
  factory (Windows/Linux desktop currently show it, and tapping it says biometric unlock isn't available).
- `packages/engine`: an optional `env.finishCeremonyInHost` would let hosts that run the PRF in the engine's own
  process skip the renderer round trip that `apps/desktop/src/main/host/wallet.ts` short-circuits today.
