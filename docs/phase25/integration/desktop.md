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

## r1/connect in the desktop (docs/r1/integration/connect.md applied)

- `apps/desktop/src/main/host/link.ts`: `LinkService` (platform "desktop") with the engine as `signerHost`,
  `grantOrigin` for handoffs, relay serving, sync every 5 minutes, and `startDesktopLinkServer` on the per-user socket.
  The built-in browser's dapp connector is wrapped with `withRemoteSigner` so a paired phone can sign for it.
- IPC: link requests (`isLinkRequest`) are zod-checked with `LinkRequest`, refused while locked unless in
  `LINK_LOCKED_OK`, then go to `LinkService.handle` (`linkHandoffCreate` gets this wallet's connected families).
- Pairing focus: a native pairing (or a scanned code) brings the wallet window to `/settings/devices/pair/<id>`;
  link-originated approvals focus the approval window (`app.focus({ steal: true })` on macOS).
- Native-messaging host: `src/native-host/main.ts` → `out/native-host/clip-native-host.cjs` (asarUnpack), launched by
  a per-install launcher (`ELECTRON_RUN_AS_NODE=1 <app> <script>`); manifests for Chrome, Chromium, Edge, Brave and
  Firefox from `installPlan` (Windows: HKCU keys). Installed on first run / after updates in packaged builds;
  Settings → Linked devices → Browser extension: "Set up again" / "Remove".
- Deep links: `clipwallet://browse?url=…&h=…` → `handoffOpen` (after unlock) → Linked devices "Continue" restores the
  connection and opens the page in the built-in browser; `clipwallet://link?…` → `scan`.
- Brand: `tools/brand/render.mjs` renders `apps/desktop/build/icon{,-mac}.png` and the tray icons and copies the mark
  (`icon.svg`, the identity data URI in `src/shared/app-config.ts`); `tools/harness/test/brand.test.mjs` checks them.

Shared files touched for this (small, additive):
- `packages/ui/src/link/client.ts`: optional `LinkClient.browserConnector` + `BrowserConnectorView`;
  `createLinkClient` passes it through.
- `packages/ui/src/link/LinkedDevices.tsx`: the signer section and "Use for signing" show on every platform but
  mobile (the desktop can use a phone); a `BrowserConnector` section when `link.browserConnector` exists.
- `packages/ui/src/i18n/*/link.ts`: six `link.connector.*` strings in all 12 languages (Arabic values isolated).
- `packages/ui/test/link.test.tsx`: one test for the desktop case.
- `tools/harness/check.mjs`: also allows `apps/desktop/e2e/mock-extension.ts` (the e2e's stand-in extension: an empty
  vault used only for ephemeral pairing keys); `tools/harness/test/check.test.mjs` covers it.
- `tools/brand/render.mjs`, `tools/harness/test/brand.test.mjs`: desktop outputs.
