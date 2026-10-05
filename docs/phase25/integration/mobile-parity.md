# Integration: mobile parity (`r1/mobile-parity`)

The phone gets the extension's Settings → Security screens and Clip Plugins. Everything runs on `@clip-wallet/engine`.
Nothing in `apps/extension`, `packages/ui`, `packages/1mask`, `packages/config` or `packages/vault` changed.

## Shared files touched

| File | Change |
| --- | --- |
| `packages/engine/src/engine.ts` | +23 / −1, additive hooks only (below) |
| `packages/engine/src/types.ts` | `NameResolver.serviceFor?` (optional; `MultiNameResolver` already has it) |
| `packages/engine/src/wiring.ts` | `EngineWiringOptions.extraNames?` → `MultiNameResolver({ …, extra })` |
| `packages/engine/src/client.ts`, `index.ts` | `createEngineSecurityClient`, `createEnginePluginsClient`, `EnginePlugins` type |
| `packages/engine/src/plugins.ts` (new), `package.json` | `EnginePlugins` interface; dependency `@clip-wallet/plugins`; export `./plugins` |
| `packages/plugins/src/npm.ts`, `package.json` | Hermes-safe install (see "Plugins package" below); dependency `@noble/hashes` |

### `engine.ts` hooks

All of these are no-ops until `attachPlugins` runs, so the extension and existing hosts behave exactly as before.

1. `attachPlugins(p: EnginePlugins)` stores the plugins and runs `p.sync()`.
2. `handleUntrusted`: a `plugins*` message goes to `p.service.handle` (zod-checked there), and only while unlocked
   (`vault/locked` otherwise). This matches the extension, where `service.ts` routes `plugins*` after `requireUnlocked`.
3. `setPrefs`: when `advanced` changes, `p.sync()` runs. Advanced mode gates every plugin.
4. `enqueueTransaction`: after the wallet's own lines and warnings, and only for readable (non-blind) requests,
   `withPluginInsights(decoded, await p.insights(toInsightInput(decoded, origin, address)))`. Errors become `[]`.
5. `resolveRecipient`: a name counts as a name when `deps.names.serviceFor(name) === "plugin"`, as in the extension.

Moving the extension onto the engine later: `engine.attachPlugins({ service, sync, insights })` from
`apps/extension/src/background/plugins.ts` (`createPlugins` already has this shape).

## Security screens (mobile)

The security service was already attached in `apps/mobile/src/background/host.ts`. Its `sec*` messages are already
in `EngineRequest`. New pieces:

- `wallet.security = createEngineSecurityClient(engine)`. It sends the same messages as the extension's
  `security-bus.ts`.
- `src/screens/Security.tsx` has `SecurityHome`, `Permissions`, `Cleanup` and `Protection`, with the same logic and
  copy as `packages/ui/src/security`. `src/lib/security-text.ts` is the mobile copy of `ui/security/text.ts`.
- Routes: `security`, `security-permissions`, `security-cleanup`, `security-protection`. To get there: Settings →
  "Backup and accounts" → Security.
- Removing a permission or cleaning up queues the approval through the engine, which opens the normal approval
  sheet. The screen also calls `showApproval(queued.approvalId)`. The vault signs there, one transaction at a time.
- Clean up's button says what one tap does ("Get back ~0.0041 SOL", "Tidy up your wallet").
- Scam protection lists each source, whether it's on, when it was last updated and what it sees. Blockaid shows
  "Off. Add a Blockaid API key…" because mobile builds have no key.

## Clip Plugins on the phone

### How it's isolated

| Layer | What |
| --- | --- |
| Process | One hidden `react-native-webview` per running plugin (`src/plugins/PluginSandboxes.tsx`), mounted at the app root. Web content runs in WebKit's WebContent process or Android's renderer process, so a plugin stuck in a loop freezes only its own WebView. |
| Page | Inline HTML (`sandbox.generated.ts`, built by `scripts/build-plugin-sandbox.mjs`) loaded with `baseUrl: "about:blank"`, so the origin is opaque. CSP: `default-src 'none'`, `script-src 'sha256-<this script>' 'unsafe-eval'`, and `'none'` for connect, img, style, font, media, object, frame, child, worker, manifest, form-action and base-uri. |
| Navigation | `originWhitelist={["about:blank"]}` and `onShouldStartLoadWithRequest = allowSandboxLoad`: only about:blank, top frame only. JavaScript is enabled, but it only ever runs in the sandbox HTML. |
| WebView settings | No DOM storage, cache, file access, universal or file-URL access, extra windows, link preview, media, AirPlay, geolocation, form data or debugging. `incognito` on iOS only (a non-persistent data store). On Android, react-native-webview's `incognito` calls `CookieManager.removeAllCookies`, which would log the in-app browser out of every site. The opaque origin there has no cookie access, and DOM storage is off. |
| Bridge | Nothing of ours is injected (no `injectedJavaScript*`). The only channel is react-native-webview's `postMessage`. App → page is `ref.postMessage(string)`, which arrives as a `MessageEvent` on `window` (iOS) or `document` (Android). Page → app is `ReactNativeWebView.postMessage(string)`. The page keeps that function and deletes the global before `lockdown()`. |
| Schema | `src/plugins/protocol.ts` checks every message in both directions. App → page: `parseFromHost` before sending. Page → app: the frame URL must be about:blank, the message must be under the size cap, must be JSON, and must pass `parseFromSandbox`. `PluginHost` then validates every result again. |
| SES | `src/plugins/sandbox-entry.ts` runs `lockdown()` with the same options as the extension sandbox, then the shared `createSandboxRuntime`. That gives a `Compartment` with only `module`, `exports`, the granted `clip.*` functions and a no-op console. |
| Host | `src/plugins/host.ts` uses the same `PluginRegistry`, `PluginsService`, `PluginHost` and `HostBridgeServer` as the extension. The host checks the bundle's sha256 before loading it and calls only granted handlers. Each call has a 1.5 s timeout, and two misses stop the plugin and unmount its WebView. An outer 2 s timeout stops everything. Network is GET only, to the manifest's exact https origins, made by the app. Notifications: 3 an hour and 10 a day, shown only when the user turned notifications on. Syncs run one at a time. |
| Storage | The registry lives in app storage (`clip/plugins`), which the WebView can't reach. A plugin gets its own source, its grant, and `toInsightInput(...)` for each request, and nothing from the vault. |

### Flow (same as the extension)

- Settings → Advanced → Plugins only appears with Advanced mode on. The screen has the Plugins switch (off by
  default). To install, type an npm package name. The app then downloads the package and checks npm's
  `dist.integrity` (sha512), the tarball's origin, the package identity, the manifest and the bundle's sha256. It
  shows the plain-language permission prompt and stores nothing until you tap Install.
- On the approval sheet, each plugin's notes appear in their own "From <plugin>" card under the request's lines,
  with "Added by the <plugin> plugin, not checked by Clip Wallet". The wallet's own lines and warnings never change.
- Names: `PluginBackend` is passed through `extraNames`. Built-in name services always win, and only suffixes
  claimed by running plugins are asked.

### Plugins package (Hermes)

Hermes has no `crypto.subtle` and no `DecompressionStream`. The `fast-text-encoding` polyfill also refuses
`TextDecoder({ fatal: true })`. So:
- sha256 and sha512 now come from `@noble/hashes`. This also changes the extension's code path; the results are
  the same.
- `NpmOptions.gunzip` takes an injected gunzip. Mobile uses `src/plugins/gunzip.ts`, built on pako 2.2.0 `Inflate`,
  and stops at 20 MB of output.
- `decodeUtf8Strict` falls back to re-encoding and comparing when `fatal` isn't supported.

### Dependencies (apps/mobile)

`@clip-wallet/plugins`, `@clip-wallet/names`, `ses` 2.3.0 (bundled only into the sandbox page, never into the
Hermes bundle), and `pako` 2.2.0 (already in the lockfile through the Keystone SDK).

## Tests

| Where | What |
| --- | --- |
| `apps/mobile/test/plugins-sandbox.vitest.ts` (9) | The real generated page (SES) in its own realm (happy-dom), wired by strings exactly like react-native-webview, against the real `createMobilePlugins` → `PluginHost` → `channels.ts`. Covers: npm install (noble + pako) runs nothing until Advanced mode + the switch; Advanced off unmounts the sandbox; a zip bomb is refused. Ported isolation tests, with iOS and Android delivery: no window, document, fetch, XHR, WebSocket, storage, timers, navigator, location or bridge global; no escape through Function, the AsyncFunction constructor or indirect eval; prototype pollution throws; inputs are frozen; no Date or Math.random; the page realm is frozen and the bridge global is gone. Also: `import()` is refused at load; only granted handlers run; network reaches only declared https origins, through the app; bad or bidi output is dropped; a tampered bundle is refused; a plugin that stops answering is stopped and unmounted. |
| `apps/mobile/test/plugins-bridge.vitest.ts` (7) | The schema in both directions (unknown keys, handlers, bidi, size, non-JSON, wrong frame URL); the navigation rule; boot queue, per-frame keys, destroy and crash; the generated page's CSP (script hash, no network or frames, one inline script). |
| `apps/mobile/test/security-plugins.test.tsx` (10, jest) | Security menu; permissions (risk flags, risky ones ticked, the approval is queued and nothing is signed); cleanup ("Get back ~0.0041 SOL", lines, confirmations, the hide-only path); protection (sources, privacy text, Blockaid off); German; Plugins entry gating; install prompt (nothing stored before Install); integrity refusal; the "From <plugin>" card on an approval. |
| `packages/engine/test/plugins.test.ts` (2) | `pluginInsights` stays apart from lines; what a plugin sees; `plugins*` need the vault unlocked; Advanced mode re-syncs. |
| `packages/plugins/test/portable.test.ts` (3) | Install without WebCrypto or DecompressionStream (injected gunzip), and strict UTF-8 without `fatal`. |

## Only verifiable on a device (no simulator on this machine)

- Process isolation: a plugin in `while (true) {}` freezes only its WebContent or renderer process, the app stays
  responsive, and unmounting the WebView kills it. In tests the page shares Node's thread, so only the
  "stops answering" path is covered there.
- WKWebView and Android WebView enforcing the meta CSP: the hash-matched script and `'unsafe-eval'` for SES on the
  sandbox page, and no network. In tests, no network globals is checked inside the compartment, not the CSP.
- What `nativeEvent.url` reports for `loadDataWithBaseURL(baseUrl = "about:blank")` on Android. The bridge drops
  anything that isn't exactly `about:blank`, so if Android reports something else, plugins fail to start (fail
  closed) rather than run unchecked.
- Whether `delete window.ReactNativeWebView` succeeds on Android, where it's a Java bridge object. The plugin can't
  reach `window` either way.
- SES `lockdown()` on the iOS and Android WebView engines (MetaMask Mobile runs Snaps under SES in a WebView, which
  is a good sign). The size of the sandbox HTML (534 KiB) and how long a plugin takes to start.
- Notifications from plugins through expo-notifications.
- Security screens against live networks: permission scans, the Solana close and burn, and Hedera dissociate. The
  service is unit-tested in `packages/security`; here the screens run on fixtures.

## Sources (checked 2026-10-05)

- react-native-webview 13.16.1 (installed source):
  - `apple/RNCWebViewImpl.m`: `postMessage` dispatches `new MessageEvent('message', {data})` on `window`; `loadHTMLString:baseURL:` defaults to about:blank; the `ReactNativeWebView.postMessage` user script runs at document start, main frame only.
  - `android/.../RNCWebViewManagerImpl.kt`: `postMessage` dispatches on `document`; `loadDataWithBaseURL(baseUrl, html…)`; `setIncognito` calls `CookieManager.removeAllCookies`.
  - `src/WebViewShared.tsx`: `originWhitelist` always allows about:blank; `onShouldStartLoadWithRequest`.
- SES 2.3.0 (installed and run): `Date.now()` and `Math.random()` throw in compartments; dynamic `import(` is rejected at evaluation (`SES_IMPORT_REJECTED`).
- MetaMask Snaps on mobile run in a WebView: https://github.com/MetaMask/snaps/tree/main/packages/snaps-controllers/src/services/webview (`WebViewExecutionService`, `WebViewMessageStream`).
- pako 2.2.0 `lib/inflate.js` (`Inflate`, `onData`, `windowBits` 16+15 for gzip).
- fast-text-encoding 1.0.6 (`text.min.js`): `TextDecoder` throws on `fatal`.
