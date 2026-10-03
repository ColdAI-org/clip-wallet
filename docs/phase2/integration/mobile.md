# Integration: mobile stream (`p2/mobile`)

New: `packages/engine` (`@clip-wallet/engine`), `apps/mobile` (`@clip-wallet/mobile`, Expo SDK 57 / React Native
0.86 / Hermes / New Architecture). Nothing in `apps/extension` was edited.

## Edits outside new files (all additive)

| File | Change | Why |
| --- | --- | --- |
| `packages/vault/src/kdf.ts` (new) | `Argon2idFn`, `hashWasmArgon2id` | injectable Argon2id |
| `packages/vault/src/crypto.ts` | `deriveKek(password, kdf, impl = hashWasmArgon2id)`; checks the output is 32 bytes | same |
| `packages/vault/src/vault.ts` | `ClipVaultOptions.argon2id?: Argon2idFn` (default `hashWasmArgon2id`), passed to the 3 `deriveKek` calls | Hermes has no `WebAssembly` ([facebook/hermes#429](https://github.com/facebook/hermes/issues/429)); hash-wasm 4.12 throws `WebAssembly is not supported in this environment!` |
| `packages/vault/src/index.ts` | exports `hashWasmArgon2id`, `Argon2idFn`, `Argon2idInput` | |
| `packages/vault/test/kdf.test.ts` (new) | cross-implementation vectors (hash-wasm == @noble), injection, no-WASM proof | |
| `tools/harness/check.mjs` | `VAULT_IMPORT_ALLOW` += `/^apps\/mobile\/src\/background\//` | the mobile "background" builds the vault, like the extension's |
| `tools/harness/test/check.test.mjs` | asserts the new allow entry and that `packages/engine` / mobile screens are still refused | |
| `pnpm-workspace.yaml` | `allowBuilds`: `'@parcel/watcher': false`, `unrs-resolver: false` | pnpm 12 refuses unlisted build scripts (Expo toolchain); both ship prebuilt binaries |

Vault defaults (hash-wasm, 64 MiB / t=3 / p=1, record format) are unchanged. If the vault-v2 stream also edits
`vault.ts`, the merge is the one option field plus three call sites.

No lines are needed in `wiring.ts`, `catalog.ts`, `inpage/index.ts`, `methods.ts` or `router.ts`.

## `@clip-wallet/engine`

`WalletEngine` reimplements `apps/extension/src/background/service.ts` on injected seams:

| Service (extension) | Engine |
| --- | --- |
| `new WalletService(deps, kv, env)` | `new WalletEngine(deps, kv, env)` |
| `Env.openApprovalWindow(id)` | `EngineEnv.openApproval(id)` |
| `Env.openTab(route)` | `EngineEnv.openRoute?(route)` |
| `Env.broadcast / armAutoLock / walletName` | same names |
| `Env.passkey()` (ceremony meta) | `EngineEnv.passkey?()` |
| `crypto.randomUUID`, `globalThis.fetch`, `Date.now` | `env.randomUUID`, `env.fetch`, `env.now?` |
| `hashSignablePayload` imported from the vault | `deps.hashPayload` (the engine never imports the vault) |
| `shared/messages.ts` `Request` / `ResponseMap` | `EngineRequest` / `EngineResponseMap` (same schema, minus `devSimulateRequest`) |
| `shared/storage.ts` `KV`, `MemoryKV` | `KV`, `MemoryKV`, `JsonKV` (any string store) |
| `passkey-proxy.ts` `PasskeyCeremonies` | `PasskeyCeremonies` (randomness injected) |
| `wiring.ts` `createDependencies` (real branch) | `@clip-wallet/engine/wiring` `createEngineDependencies({ config, vault, hashPayload, currency, walletConnect })` |
| `shared/catalog.ts` | `@clip-wallet/engine/wiring` `walletNetworks`, `walletAssets`; `publicNetworks` in the root export |
| `real.ts` adapters | `OneMaskConnector`, `WalletConnectAdapter`, `RoutePlannerAdapter`, `ReferencePriceFeed`, `NoNameResolver`, `KnownDappRegistry` |

Additions: `handleUntrusted(msg)` (zod + dispatch), `attachDappPort(port, senderOrigin)`,
`enrollPasskeyWith(password, prf)` / `unlockWithPasskeyWith(prf, credentialId?)` / `listPasskeys` /
`removePasskey(s)` for PRF providers in the same JS context, `walletConnectEnabled`, and
`createEngineClient(engine, { subscribe })`, an in-process `WalletClient` for `@clip-wallet/ui` screens.

Two behaviour changes:
1. `lock()` rejects approvals still waiting (`vault/locked`). The seed is wiped on lock, so they could not be signed anyway.
2. `request()` / `approveConnect()` reject with `vault/locked` while locked. The extension service queued them and
   then failed on `deriveAccount`. If the extension wants "unlock, then approve", keep the queue in its own `openApproval`.

### Moving the extension background onto the engine (later, one PR)

1. `apps/extension/src/background/main.ts`: build `new WalletEngine(deps, kv, env)` with
   `env = { walletName, openApproval: openApprovalWindow, openRoute: openTab, broadcast, armAutoLock, passkey,
   fetch: fetch.bind(globalThis), randomUUID: () => crypto.randomUUID() }`. The bus handler becomes
   `engine.handleUntrusted(msg)`. Keep `devSimulateRequest` as an extension-only branch in front of it
   (fixture mode), or move `simulate()` into a small `mocks/simulate.ts` that calls `engine.handle`.
2. `wiring.ts`: the real branch becomes
   `createEngineDependencies({ config, vault, hashPayload: hashSignablePayload, currency, walletConnect: { projectId: config.walletConnect.projectId, url: "https://clipwallet.example", iconUrl } })`.
   Add `hashPayload: hashSignablePayload` to the mock branch, and `enabled: true` to `MockWalletConnect`.
3. `shared/storage.ts`: `AreaKV` already satisfies the engine's `KV`. `messages.ts` can re-export
   `EngineRequest` as `Request` and add `devSimulateRequest`.
4. Delete `service.ts`, `real.ts`, `passkey-proxy.ts` and `shared/catalog.ts`. Point `test/service.test.ts` at
   `WalletEngine` (the method names are unchanged).

## Mobile app: how it maps to the extension

| Extension | Mobile (`apps/mobile/src`) |
| --- | --- |
| service worker + `main.ts` | `background/host.ts` (`createMobileWallet`): vault + engine + env (JS timer + AppState auto-lock) |
| `chrome.storage.local` | AsyncStorage (`JsonKV`). The vault record goes to expo-secure-store (Keychain `WhenUnlockedThisDeviceOnly` / Keystore) |
| hash-wasm Argon2id | `background/argon2.ts`: react-native-argon2 (Argon2Swift / argon2kt), self-tested against the vault's vectors; @noble pure-JS fallback |
| passkey unlock (WebAuthn PRF) | `background/device-key.ts`: a Face ID / Touch ID device key (Keychain `.biometryCurrentSet` / Keystore auth-required) as a PRF. `background/passkey.ts`: real passkeys via react-native-passkey PRF |
| content script + runtime port | `browser/bridge.ts` + `browser/inpage-entry.ts` (1Mask inpage + content bridge in one injected bundle). The origin comes from the WebView's own URL |
| approval popup window | approval sheet (RN `Modal`), `screens/Approval.tsx` |
| `@clip-wallet/ui` DOM screens | RN screens with the same flows and copy. They reuse ui's tokens (`tokensFor`), `mergeBalances`, `formatFiat/Units`, `passwordStrength`, `pickConfirmIndexes`, `groupCollectibles`, `isWalletConnectUri`, `hueFor` and the `WalletClient` types |

## Notes for other streams

- **Hedera on React Native**: `@hiero-ledger/sdk` 2.89 resolves `"react-native"` to `lib/native.js`, whose
  `Client.forName(name)` takes one argument. `chains-hedera` passes `{ scheduleNetworkUpdate: false }`, which RN
  ignores, so the periodic address-book update stays on there. Types differ too, so `apps/mobile/tsconfig.json`
  sets `customConditions: []`. Metro still bundles the RN build. Suggested fix in chains-hedera: call
  `client.setNetworkUpdatePeriod(...)` or construct the client explicitly instead of passing the option.
- **zod in the inpage bundle**: 453 of the 466 KiB injected per page is zod v4 (`import { z } from "zod"` isn't
  tree-shaken). Moving 1Mask's page-side schemas to `zod/mini` would shrink the extension's inpage script too.
- New chain families reach mobile with no mobile edits once `createEngineDependencies` registers their modules.
  The engine's `families` comes from the network list, not a hard-coded four.
