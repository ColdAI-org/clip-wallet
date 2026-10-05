# r1/connect — integration (Clip Desktop wiring and shared-file edits)

Stream: connect the extension, Clip Desktop and the mobile app (`@clip-wallet/link`, `services/link-relay`,
`/v1/sync` on `services/backup`). Threat model: `packages/link/README.md`.

## Deployed (testnet builds, 2026-10-05, wrangler 4.124.0)

| Service | URL | Notes |
|---|---|---|
| Clip Link relay | https://clip-link-relay.doyoka-platform.workers.dev | new Worker `clip-link-relay`, Durable Object class `LinkChannel` (SQLite-backed, migration tag v1), no secrets, observability off |
| Backup + sync | https://clip-backup.doyoka-platform.workers.dev | redeployed with D1 migration `0003_sync.sql` (tables `sync_spaces`, `sync_records`, `sync_nonces`); no new secrets |

Redeploy: `cd services/link-relay && npx wrangler deploy`;
`cd services/backup && npx wrangler d1 migrations apply clip-backup-db --remote && npx wrangler deploy`.
Teardown of the relay: `npx wrangler delete clip-link-relay` (deletes its Durable Objects).

Smoke (2026-10-05): relay `/v1/health` 200; a pairing between two vaults through the deployed relay (real
X25519, responder joining 1.5 s later so the hello waited in the queue) gave equal codes and an encrypted
round trip; `/v1/health` on backup reports `sync: true`; unsigned `/v1/sync/changes` → 401; relay without
Upgrade → 426; sync push from one device, pull on a second (same public test-vector wallet), then
`DELETE /v1/sync` left 0 rows in `sync_records` / `sync_spaces` (checked with `wrangler d1 execute --remote`).

## Shared files touched (additive, small)

- `packages/vault/src/vault.ts` (+ `link.ts`, `errors.ts`, `index.ts`): `syncKeys()`, `pairingKey()`,
  `exportToDevice()`, `importFromDevice()`, `VaultErrors.transferFailed`.
- `packages/config/src/index.ts`: `services.linkRelayUrl` (optional https base). Both `clip.config.ts` set it
  for testnet builds.
- `packages/ui/src/App.tsx`: `link?: LinkClient` prop, `<LinkProvider>`, `/settings/devices*` route, `/link/receive`
  before onboarding. `Settings.tsx`: "Linked devices" menu entry. `Onboarding.tsx`: "Copy a wallet from another device".
- `apps/extension/src/shared/messages.ts`: `...LINK_REQUESTS`, `LinkResponseMap`.
- `apps/extension/src/background/main.ts`: `startLink()`, `deps.dapps = withRemoteSigner(deps.dapps, link)` before
  `new WalletService`, link requests routed to `handleLink()` (≈25 lines).
- `apps/extension/wxt.config.ts`: `activeTab` permission, `nativeMessaging` optional permission, relay origin in
  host permissions.
- `apps/mobile/src/background/host.ts`: `link` / `linkService` from `createMobileLink()`.
- `packages/engine`: **not changed.** `EngineRequest` doesn't include `LINK_REQUESTS`; hosts route
  `isLinkRequest(msg)` to `LinkService.handle` themselves (extension main.ts and mobile do). If the integration
  step prefers one bus, spread `LINK_REQUESTS` into `packages/engine/src/messages.ts` and add
  `attachLink(link)` + `if (isLinkRequest(m)) return this.link.handle(m)` to `WalletEngine.dispatch` (≈10 lines).

## Clip Desktop (apps/desktop, Electron) — exact wiring

Clip Desktop runs `@clip-wallet/engine` with its own vault (like mobile). It is the **key-holding side**: it serves
signing requests from the paired extension and shows the approval in its own window.

### 1. Main process: LinkService + the local socket

```ts
// apps/desktop/src/main/link.ts  (main process; may import the vault like apps/mobile/src/background)
import { app } from "electron";
import { LinkService, contactsSource, walletSources } from "@clip-wallet/link";
import { startDesktopLinkServer, defaultSocketPath } from "@clip-wallet/link/node";
import { CONTACTS_KEY, encryptedContactStore } from "@clip-wallet/social/contacts";
import config from "../../clip.config";

export async function startDesktopLink({ kv, vault, engine, broadcast, openApproval }) {
  const contacts = encryptedContactStore(kv, { seal: (p) => vault.sealAppData("contacts", p), open: (b) => vault.openAppData("contacts", b) }, CONTACTS_KEY);
  const link = new LinkService({
    platform: "desktop",
    deviceName: () => "Clip Desktop",
    kv,
    vault,                                   // ClipVault satisfies LinkVault
    fetch: globalThis.fetch,
    WebSocket: globalThis.WebSocket,         // Node 22+ / Electron 33+ have a global WebSocket
    relayUrl: config.services.linkRelayUrl,  // phone pairing / moving a wallet from the desktop
    syncUrl: config.services.backupUrl,
    sources: () => [...walletSources(kv), contactsSource(contacts)],
    signerHost: {
      approveConnect: (p) => engine.approveConnect(p),
      accountsFor: (o, f) => engine.accountsFor(o, f),
      request: (r, dapp) => engine.request(r, dapp),     // → env.openApproval → the desktop approval window
      cancel: (id) => engine.cancel(id),
      decode: (r) => engine.decodeForFeatures(r),
    },
    grantOrigin: async (origin, families) => { for (const f of families) await engine.permissions.grant(origin, f); },
    onChange: broadcast,
  });
  await link.init();
  await link.startServing();                 // relay-paired devices (if the desktop also links a phone)

  // Extension ids this build trusts (store ids + the unpacked dev id). Same list goes into the host manifests.
  const allowedOrigins = [`chrome-extension://${CHROME_EXTENSION_ID}/`, FIREFOX_ADDON_ID];
  const server = await startDesktopLinkServer({
    path: defaultSocketPath(),
    allowedOrigins,
    onConnection: ({ channel }) => void link.acceptNative(channel),
  });
  app.on("before-quit", () => void server.close());
  setInterval(() => void link.syncNow().catch(() => undefined), 5 * 60_000);
  return link;
}
```

Bus: route `isLinkRequest(msg)` (from `@clip-wallet/link`) to `link.handle(msg)` in the IPC handler that already
serves `engine.handleUntrusted` for the renderer. Renderer: pass `link={createLinkClient(call)}` (from
`@clip-wallet/ui`) to `<WalletApp>`; Settings → Linked devices then shows the pairing code when the extension
starts "Use Clip Desktop" (`acceptNative` creates the pairing run; the renderer polls `linkStatus`). Bring the
window to the front on a new pairing: `onChange` → if `(await link.status()).pairings.some(p => p.state === "compare")`, `win.show(); win.focus()`.

### 2. The native-messaging host program

Bundle `packages/link/src/native/node.ts`'s `nativeHostMain` as a tiny Node script or a single binary:

```ts
// apps/desktop/native-host/main.ts
import { nativeHostMain } from "@clip-wallet/link/node";
void nativeHostMain();
```

Build with `esbuild --bundle --platform=node --format=cjs native-host/main.ts --outfile=dist/clip-native-host.cjs`,
then either ship it with a launcher that runs Electron's Node (`ELECTRON_RUN_AS_NODE=1 "<app>/Clip Desktop" dist/clip-native-host.cjs "$@"`)
or compile a standalone binary (`node --experimental-sea-config`, Node SEA) — macOS: sign it with the app's
identity; Windows: `.exe`. The manifest `path` must be absolute on macOS/Linux. The host needs no arguments of its
own: browsers pass the caller origin (Chromium: argv[1]; Firefox: argv[1] = manifest path, argv[2] = add-on id;
`--parent-window=` on Windows is ignored). `CLIP_DESKTOP_SOCKET` overrides the socket path (tests only).

### 3. Install the host manifests (first run and every update)

```ts
import { installPlan, registryCommand } from "@clip-wallet/link/native";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";

for (const { target, manifest } of installPlan(process.platform as "darwin" | "linux" | "win32", {
  rdns: config.rdns,                        // "org.coldai.clipwallet" → host "org.coldai.clipwallet.link"
  hostPath: HOST_BINARY_ABSOLUTE_PATH,
  chromiumExtensionIds: [CHROME_EXTENSION_ID, EDGE_EXTENSION_ID],   // 32 chars a–p each
  firefoxAddonIds: [FIREFOX_ADDON_ID],      // "wallet@clipwallet.coldai.org" (wxt.config.ts gecko id)
  home: homedir(),
  appData: process.env.LOCALAPPDATA,
})) {
  mkdirSync(dirname(target.manifestPath), { recursive: true });
  writeFileSync(target.manifestPath, JSON.stringify(manifest, null, 2));
  if (target.kind === "registry") execFileSync(registryCommand(target)[0]!, registryCommand(target).slice(1));
}
```

Per-user locations written (no admin rights):

| | macOS (`~/Library/Application Support/…`) | Linux | Windows (HKCU key → manifest under `%LOCALAPPDATA%\Clip Wallet\NativeMessagingHosts\<browser>\`) |
|---|---|---|---|
| Chrome | `Google/Chrome/NativeMessagingHosts/` | `~/.config/google-chrome/NativeMessagingHosts/` | `Software\Google\Chrome\NativeMessagingHosts\<name>` |
| Chromium | `Chromium/NativeMessagingHosts/` | `~/.config/chromium/NativeMessagingHosts/` | `Software\Chromium\NativeMessagingHosts\<name>` |
| Edge | `Microsoft Edge/NativeMessagingHosts/` | `~/.config/microsoft-edge/NativeMessagingHosts/` | `Software\Microsoft\Edge\NativeMessagingHosts\<name>` |
| Brave | `BraveSoftware/Brave-Browser/NativeMessagingHosts/` | `~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/` | `Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\<name>` (Brave also falls back to Chrome's key) |
| Firefox | `Mozilla/NativeMessagingHosts/` | `~/.mozilla/native-messaging-hosts/` | `Software\Mozilla\NativeMessagingHosts\<name>` |

Uninstall: delete those files / keys. The extension id must be final before release (store ids differ from the
unpacked dev id; list both while testing).

### 4. Deep links

Register `clipwallet://` (`app.setAsDefaultProtocolClient("clipwallet")`, plus `open-url` on macOS and the
second-instance argv on Windows/Linux). Handle:
- `clipwallet://browse?url=…&h=…` → `link.handoffOpen({ link })` then show Settings → Linked devices (the
  "Continue" card restores the connection after one tap and opens the URL in the system browser),
- `clipwallet://link?…` → `link.scan(uri)` (pairing codes pasted or opened from another device).

## Extension notes
- "Use Clip Desktop" asks for the optional `nativeMessaging` permission from the click (`shared/link-bus.ts`).
- While another device signs, `withRemoteSigner` sends 1Mask connects and requests there; reads stay local.
  WalletConnect sessions keep using the local vault (out of scope this release).
- Linked devices e2e: `apps/extension/e2e/link.spec.ts` (fixture build), screenshots `r1-linked-devices.png`,
  `r1-link-phone-qr.png`.

## Gaps / follow-ups
- No push notifications: the phone must be open to approve (the extension says so and waits 2 minutes).
- Stored link secrets aren't sealed by the vault (the extension may have no wallet in signer mode); see threat model.
- Windows named-pipe DACL can't be set from Node; pairing + encryption cover it (threat model).
- `apps/desktop` must add the IPC routing and approval window focus described above.
