# @clip-wallet/engine

The wallet's orchestration with no environment baked in: approvals, per-site permissions, portfolio cache,
send / receive (including the "network-matters" prompt), activity, prefs, 1Mask and WalletConnect hosting,
and passkey ceremonies. It reimplements the extension background's `service.ts` on injected seams, so the
same code runs in an MV3 service worker, React Native (Hermes) and tests.

```ts
import { WalletEngine, createEngineClient, MemoryKV } from "@clip-wallet/engine";
import { createEngineDependencies } from "@clip-wallet/engine/wiring";
import { ClipVault, hashSignablePayload } from "@clip-wallet/vault"; // host code only (harness rule)

const vault = new ClipVault({ storage, argon2id /* optional, e.g. native on RN */ });
const deps = createEngineDependencies({ config, vault, hashPayload: hashSignablePayload, currency, walletConnect: { projectId, url, iconUrl } });
const engine = new WalletEngine(deps, kv, { walletName, openApproval, broadcast, armAutoLock, fetch, randomUUID });
engine.start();
const client = createEngineClient(engine, { subscribe }); // a @clip-wallet/ui WalletClient
```

- The engine never imports `@clip-wallet/vault`. The host builds the vault and passes it in with `hashPayload`.
- `handleUntrusted(msg)` validates with the same zod schema as the extension bus (`EngineRequest`).
- `attachDappPort(port, senderOrigin)` wires a 1Mask port. `senderOrigin` must come from the host (browser
  sender, WebView URL), never from the page.
- The root export is light (no chain SDKs). `@clip-wallet/engine/wiring` brings in the chain packages.

Tests: `pnpm --filter @clip-wallet/engine test` (20 tests: lifecycle, schema, portfolio, send with the
network-matters prompt, connect + `personal_sign` over a real 1Mask router port, reject → 4001, origin
cross-check, lock, WalletConnect off, in-process PRF passkeys, real wiring testnets-only). The vault is a test
double with no keys (`test/fixtures.ts`).

Migration notes for the extension: `docs/phase2/integration/mobile.md`.
