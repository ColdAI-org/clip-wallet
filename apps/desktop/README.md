# Clip Wallet desktop (macOS, Windows, Linux)

Electron app with the shared wallet engine in the main process, the extension's screens (`@clip-wallet/ui`) in the
wallet and approval windows, and a built-in dapp browser where 1Mask is injected the way the extension injects it.
Test networks only (`clip.config.ts`, `mainnet: false`).

```
pnpm --filter @clip-wallet/desktop build      # electron-vite → out/ (main, sandboxed preloads, renderer)
pnpm --filter @clip-wallet/desktop start      # run the built app
pnpm --filter @clip-wallet/desktop test       # unit tests (IPC schema, origin binding, storage, Touch ID PRF, HID relay, i18n QA)
pnpm --filter @clip-wallet/desktop e2e        # build + Playwright _electron end-to-end (real vault, testnets)
pnpm --filter @clip-wallet/desktop dist:mac   # electron-builder: dmg + zip, arm64 + x64 (dist:win, dist:linux, dist:dir)
CLIP_EXTENSION_IDS=<id>[,<id>] pnpm … build   # Chromium extension ids allowed to use Clip Desktop (native messaging)
```

## How it fits together

| Piece | Where | Notes |
|---|---|---|
| Engine + vault | `src/main/host/wallet.ts` | `@clip-wallet/engine` like the phone (`apps/mobile/src/background/host.ts`); the only place in this app that imports `@clip-wallet/vault` (harness allowlist). Features, Ledger/Keystone, social, security attached as on mobile. |
| Storage | `src/main/storage.ts` | `vault.json`: the vault record (already Argon2id-sealed) wrapped again with Electron `safeStorage` (Keychain / DPAPI / libsecret or KWallet). `app.json`: public app data. Atomic writes. |
| IPC | `src/shared/ipc.ts`, `src/main/ipc-guard.ts`, `src/preload/wallet.ts` | One typed bridge object (`window.clipDesktop`) via `contextBridge`. Main checks zod schema, then the sender (registered window role + top frame + `clip-app://wallet` origin), then the engine's own zod schema. |
| Wallet pages | `src/renderer/{wallet,approval}` | Served from `clip-app://wallet/…` (`src/main/app-protocol.ts`) with a strict CSP; only the default session knows the scheme. |
| Browser | `src/main/browser/browser.ts` | `BaseWindow` + toolbar view + one `WebContentsView` per tab, one persistent session per origin. |
| 1Mask | `src/preload/dapp.ts`, `src/main/browser/onemask-relay.ts` | Inpage bundle (`scripts/build-inpage.mjs`) runs in the page's main world at document start (`contextBridge.executeInMainWorld`); the content bridge runs in the preload's isolated world and relays to main over IPC; main sets the origin. |
| Ledger | `src/main/hid.ts`, `src/renderer/shared/hid-agent.ts` | LedgerSigner in main over a relay transport; WebHID in the wallet/approval window does the raw APDU I/O. |
| Touch ID | `src/main/biometric.ts` | PRF in the vault's passkey slot; the main process finishes the ceremony itself. |
| Linked devices | `src/main/host/link.ts`, `src/main/native-hosts.ts`, `src/native-host/main.ts` | `@clip-wallet/link`: Clip Desktop signs for the paired extension (native messaging → per-user socket → engine → approval window), can use a paired phone as its own signer (relay), encrypted settings sync, moving a wallet, "continue on this device". Settings → Linked devices → Browser extension registers / repairs / removes the native-messaging host for Chrome, Chromium, Edge, Brave and Firefox. |
| Deep links | `src/main/deeplink.ts` | `clipwallet://wc?uri=…`, `clipwallet://browse?url=…` (with `&h=…`: a handoff, verified and restored from Linked devices), `clipwallet://link?…` (pairing code), `clipwallet://trade#offer=…`, bare `wc:`. |
| Tray / menu | `src/main/index.ts` | Menu bar (macOS template glyph) / tray: open wallet, open browser, lock, quit; icons from `brand/` (`tools/brand/render.mjs`). |
| Updates | `src/main/updater.ts` | electron-updater wired, **off** until signed releases exist (`CLIP_UPDATES=1`). |

## Security posture

**Every renderer**: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webviewTag: false`,
`navigateOnDragDrop: false`, `<webview>` attachment refused, `window.open` denied (http(s) links from a dapp become a
new tab after the same checks; https links in wallet pages go to the system browser).

**Wallet, approval and toolbar windows** (`clip-app://wallet`): CSP `default-src 'none'; script-src 'self'` (no eval,
no inline script), `connect-src 'self'`, images only from the bundle, `data:`/`blob:` and the configured media proxy,
no frames. A request filter on the default session additionally cancels every http(s)/ws/file request except media
proxy images. App windows never navigate. Permissions: camera (video only, for QR scanning) and clipboard write, for
our own top frames only; WebHID only for Ledger (vendor `0x2c97`) devices the user picked.

**Dapp tabs**: one persistent session per origin (`persist:site-<sha256(origin)>`), so cookies, storage, service
workers and permission grants never cross sites; a cross-origin top-level navigation or redirect swaps the tab to a
new view in the target origin's session. Only https, plus plain http for localhost/LAN development (shown as "Not
secure"). Permission requests: camera, microphone, notifications, clipboard and location prompt the user in the
toolbar (denied by default, grants last for the run); everything else (HID, USB, serial, Bluetooth, MIDI…) is denied.
Downloads ask (native dialog naming the file, the site and the size), then a save dialog. Phishing: the host is
checked against `@clip-wallet/security`'s lists (MetaMask, ScamSniffer, Phantom, Polkadot) before the site loads; a
listed site shows a warning and loads only if the user insists. The address bar always shows the committed origin
(host in bold).

**1Mask origin**: never from the page. The main process derives it from the IPC sender frame
(`WebFrameMain.url` cross-checked with `WebFrameMain.origin`; opaque origins refused) and overwrites whatever the
message said. **Iframes**: only the top frame of a tab talks to the wallet. Preloads don't run in subframes
(`nodeIntegrationInSubFrames: false`), the content bridge accepts only same-window messages, and anything arriving
from a subframe is dropped in main. A dapp that needs the wallet inside an iframe isn't supported (by design, like
most extension wallets' default). Replies go to the exact frame the port was opened for, only while it still shows
that origin; any new document closes the port.

**Keys**: only the vault, only in the main process. The vault file is the extension's format (Argon2id, AES-GCM)
wrapped with the OS secret store. Auto-lock: the user's timer, plus lock on screen lock and sleep (`powerMonitor`).

**Touch ID (macOS)**: a random device secret, encrypted with `safeStorage` (key in the login Keychain), released only
after `systemPreferences.promptTouchID`; its HMAC over the vault's PRF input wraps the vault key in the passkey slot.
The PRF output never reaches a renderer. Limit: the fingerprint check is enforced by the app, not by a Keychain
access-control list (Electron has none), so malware already running as the user with Keychain access could read the
secret. The password always works and is never stored.

**Windows Hello**: not implemented. Electron has no Windows Hello API (it would need a native module around
`UserConsentVerifier`), and WebAuthn platform passkeys need an https relying party, which `clip-app:` isn't. Windows
uses the password, with the vault file wrapped by DPAPI. **Linux**: password; libsecret/KWallet wrapping when a keyring
is running, otherwise (`basic_text`) the vault's own encryption only (shown in `desktop.info().storage`).

**Linked devices (r1/connect)**: the browser launches the native-messaging host only for extension ids listed in
the manifest (`CLIP_EXTENSION_IDS` at build time for Chromium browsers; Firefox's add-on id is fixed); the host
program is a size-checked pipe to a per-user socket (Unix: 0600 socket in a 0700 directory; Windows: a per-user pipe
name) and the app accepts only the same origins. Pairing ends with the same 6-digit code on both screens, confirmed
on both; afterwards every frame is end-to-end encrypted (threat model: `packages/link/README.md`). Requests from the
extension show in this app's approval window (brought to the front, naming the app and the linked device); the vault
signs only what is approved here. The host runs with the app's own executable as Node (`ELECTRON_RUN_AS_NODE`), so
the `RunAsNode` Electron fuse must stay enabled; a standalone host binary (Node SEA) would allow turning it off.
Dev builds never write into real browser profiles unless "Set up again" is pressed (`CLIP_DESKTOP_NM_HOME`
redirects tests).

## Verified vs not

- Verified on macOS (arm64): build, unit tests, both Playwright e2e specs against the built app (`desktop.spec.ts`:
  browser + 1Mask; `link.spec.ts`: native-messaging host registration, pairing with a mock extension over the real
  host program and socket, connect + personal_sign from the extension approved in the desktop approval window,
  removal), packaged arm64 `.app` started by `scripts/smoke-packaged.mjs`.
- Built here but not run: macOS x64 dmg/zip, Windows x64/arm64 zip, Linux x64/arm64 tar.gz. Windows NSIS and Linux
  AppImage/deb need electron-builder's x86_64 helper binaries (makensis, mksquashfs/fpm), which can't run on this
  Apple-silicon Mac without Rosetta: CI-only.
- Not run here: Windows and Linux runtime (no VM / wine on the build Mac). `.github/workflows/desktop.yml` builds,
  tests, packages and smoke-tests on `macos-latest`, `windows-latest` and `ubuntu-latest`; it has not been run yet.
- Not exercised: the phone-as-signer path from the desktop and settings sync against the deployed relay / backup
  (covered by `@clip-wallet/link` tests and the mobile/extension e2e), a real Chrome/Firefox launching the host.
- Not exercised with devices: Ledger over WebHID and Keystone over the camera (logic covered by `@clip-wallet/hardware`
  and the relay tests), real Touch ID prompts (PRF covered by unit tests with a fake prompt), WalletConnect (needs a
  `CLIP_WC_PROJECT_ID`).

## Sources

- Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- `contextBridge.executeInMainWorld`: https://www.electronjs.org/docs/latest/api/context-bridge
- `WebContentsView` / `BaseWindow`: https://www.electronjs.org/docs/latest/api/web-contents-view
- Sessions and partitions: https://www.electronjs.org/docs/latest/api/session
- WebHID `select-hid-device`, `setDevicePermissionHandler`: https://www.electronjs.org/docs/latest/tutorial/devices
- `WebFrameMain` (`origin`, `url`, `parent`): https://www.electronjs.org/docs/latest/api/web-frame-main
- `safeStorage`: https://www.electronjs.org/docs/latest/api/safe-storage
- `systemPreferences.promptTouchID`: https://www.electronjs.org/docs/latest/api/system-preferences
- Custom protocols (`protocol.handle`, privileged schemes): https://www.electronjs.org/docs/latest/api/protocol
- Native messaging: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging ·
  https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/Native_messaging · `ELECTRON_RUN_AS_NODE`:
  https://www.electronjs.org/docs/latest/api/environment-variables · fuses: https://www.electronjs.org/docs/latest/tutorial/fuses
- electron-vite: https://electron-vite.org/config/ · electron-builder: https://www.electron.build/configuration ·
  auto-update: https://www.electron.build/auto-update · Playwright Electron: https://playwright.dev/docs/api/class-electron
- EIP-6963: https://eips.ethereum.org/EIPS/eip-6963 · WalletConnect pairing URI: https://specs.walletconnect.com/2.0/specs/clients/core/pairing/pairing-uri
