# Integration: stream "mobile-screens" (`p25/mobile-screens`)

This stream adds the missing React Native screens in `apps/mobile`, on `@clip-wallet/engine`:
- Stake, Swap, Buy, Secure Trade
- Backup (recovery phrase and passkey) and Accounts
- Hardware wallets: Keystone by camera, Ledger over Bluetooth

It also gives the engine hardware-account support. Nothing in `apps/extension`, `packages/ui`, `packages/1mask`,
`packages/config` or `packages/vault` changed.

## Shared files touched

| File | Change |
| --- | --- |
| `packages/engine/src/engine.ts` | +27 / −8, additive hooks only (below) |
| `packages/engine/src/index.ts` | type re-exports of `EngineHardware`, `EngineHardwareDeps`, `HardwareHost` |
| `packages/engine/package.json` | dependency `@clip-wallet/hardware`; export `./hardware` |

### `engine.ts` hooks

All of these are no-ops when no hardware module is attached, so the engine behaves exactly as before:

1. `import type { EngineHardware } from "./hardware.js"`. New field `private hardware?: EngineHardware`. New
   method `attachHardware(h)`, which binds `refreshAccounts` (= `afterUnlock`), `broadcast`, `isUnlocked` and
   `touch` (re-arms auto-lock).
2. `getApproval`: `this.hardware?.withState(v) ?? v`. This shows a Keystone QR exchange while `sign()` waits.
3. `lock()`: `this.hardware?.lock()`. This drops hardware approvals and cancels open exchanges.
4. `afterUnlock()` and `account()`: `(await this.hardware?.walletAccount(f)) ?? (await this.platform.activeAccount(f))`.
   A hardware account picked for a family replaces the phrase account, as in the extension. A site's own
   choice still wins (`siteAccount` is unchanged).
5. `ctx()`: no vault change addresses for a hardware Bitcoin account (`|| this.hardware?.owns(account.id)`).
6. `approve()`: if `this.hardware.owns(ctx.account.id)`, register the approval with the keyring and sign through
   `hw.sign(p.view, payload, { request, decoded })`, which sets `view.hardware` for the Ledger step. Revoke on
   failure. Otherwise the vault path runs unchanged.

These are the same rules as the extension's `service.ts` (docs/phase2/integration/hardware.md §4). The logic
lives in the new `packages/engine/src/hardware.ts`:
- `EngineHardware`: the hardware request schema, view mapping, and "first account added becomes active".
- `createEngineHardwareClient`: the UI's `HardwareClient & HardwareApprovalClient`.

### Moving the extension onto the engine later

Replace `service.ts`'s hardware branches with `engine.attachHardware(new EngineHardware({ keyring, ledger,
keystone: { signer, bridge }, kv }))`. Route the `hw*` bus messages to `engineHardware.handleUntrusted(msg)`.
The zod schema in `hardware.ts` is the one in `apps/extension/src/shared/messages.ts`, and the KV key
`clip/hardware/active` is the same, so stored choices carry over.

## Mobile wiring (all in `apps/mobile`)

- `src/background/host.ts`:
  - Builds `HardwareKeyring` + `KeystoneBridge` and loads the signers on first use (`import("@clip-wallet/hardware")`).
  - Ledger uses the Bluetooth transport from `ledger-ble.ts`.
  - Exposes `hardware`, `ledger`, `passkeyPrf` (react-native-passkey for backup ceremonies), `openSheet`
    (expo-web-browser) and `confirmPresence` (LocalAuthentication).
  - Sets `env.passkey` (rpId from `EXPO_PUBLIC_PASSKEY_RP_ID`).
  - Sets `tradeLinkBase` (`APP.tradeLinkBase`).
- Routes (`src/ui/context.tsx`): `stake`, `swap`, `buy`, `trade`, `trade-new`, `trade-open`, `trade-detail`,
  `backup`, `backup-phrase`, `backup-passkey`, `accounts`, `hardware`, `hardware-connect`. Explore is now a tab.
- Deep links: `clipwallet://trade#offer=…` / `?offer=…` and `https://<domain>/trade#offer=…`. The Android
  intent filter gains `/trade`.
- The approval sheet re-fetches on every change and shows `HardwareStep` over the request while
  `ApprovalView.hardware` is set.
- `app.config.ts`: Bluetooth and camera text, the ble-plx plugin (no background modes, `neverForLocation`),
  `BLUETOOTH_CONNECT`, the expo-web-browser plugin.
- `metro.config.js`: `crypto` and `stream` shims for the Keystone SDK's `hdkey` / `cipher-base`.

New dependencies (apps/mobile):
- `@clip-wallet/hardware`
- `@ledgerhq/react-native-hw-transport-ble` 6.41.0
- `react-native-ble-plx` 3.4.0 (the version the transport pins)
- `expo-web-browser` ~57.0.3
- `readable-stream` ^3.6.2

## Tests

| Where | What |
| --- | --- |
| `packages/engine/test/hardware.test.ts` (5) | active hardware account replaces the phrase account; refuses unseen ids / locked; Ledger routing with the device step and no vault signing; Keystone exchange through `getApproval` + wrong-QR refusal; cancel + lock |
| `apps/mobile/test/features.test.tsx` (15) | Stake (all providers, unstake, SOL amount + validator, HBAR whole balance), Swap (quote, execute, bad amount), Buy (sheet URL, off-in-build), Trade (share sheet + QR, create, review/accept, problem blocks Accept), entry points (Explore tab, Home row, asset prefill, deep link) |
| `apps/mobile/test/platform.test.tsx` (8) | Backup hub; phrase reveal rules (password, biometrics, hold/tap, background hide, copy toggle, quiz), 60 s auto-hide, cancelled Face ID; passkey backup gating and email sign-in; Accounts add/rename/use and per site |
| `apps/mobile/test/hardware.test.tsx` (6) | Ledger connect (Bluetooth pick → accounts), Keystone connect (camera, wrong UR refused), Settings, Ledger signing step, Keystone QR exchange, cancel |
| `apps/mobile/test/links.vitest.ts` (+1) | trade deep links |

`pnpm export:ios` bundles: 6229 modules, a 27 MB Hermes bytecode file (23 MB before).

## Not verified (no iOS Simulator runtime on this machine)

- Nothing ran on a simulator or device. The jest screens run the real engine with fakes for the vault, chains,
  features and devices. Metro bundling succeeded, but the bundle was not evaluated in Hermes on iOS.
- **Ledger Bluetooth.** Untested end to end: pairing, MTU, opening apps, and above all ble-plx on the New
  Architecture (see the README caveat and dotintent/react-native-ble-plx#1277). The Android permission
  requests have not run on a device.
- **Keystone through expo-camera.** Not tested against a real device: animated QR readability at 5 fps /
  200-char fragments on a phone screen, and the camera reading Keystone's dense animated codes.
- **Not run against real services.** Buy in SFSafariViewController / Custom Tabs, the native share sheet, and
  passkey backup (needs `services.backupUrl` and an associated passkey domain).
- **Biometrics-only phrase reveal.** Not possible yet. The vault reveals the phrase only for the password, so
  Face ID is an extra check, not a replacement. Reveal-by-PRF would need a vault API.
- **Not built.** Passkey restore in onboarding (`PasskeyRestore`) and screenshot blocking on the phrase screen
  (would need `expo-screen-capture`).
