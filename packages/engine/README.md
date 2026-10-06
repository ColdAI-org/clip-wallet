# @clip-wallet/engine

The wallet's orchestration with no environment baked in: approvals, per-site permissions, the portfolio cache, send and
receive (including the "network matters" question), activity, preferences, 1Mask and WalletConnect hosting, and
passkey ceremonies. The same code runs in a React Native app, an Electron main process and tests.

The engine never imports `@clip-wallet/vault`: the host builds the vault and passes it in with `hashPayload`. The root
export is light (no chain SDKs); `@clip-wallet/engine/wiring` brings in the catalogue and the chain modules.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/engine
```

## Example

```ts
import type { ClipConfig } from "@clip-wallet/config";
import { MemoryKV, WalletEngine, createEngineClient } from "@clip-wallet/engine";
import { createEngineDependencies } from "@clip-wallet/engine/wiring";
import type { ClipVault, hashSignablePayload } from "@clip-wallet/vault";

// Host code: `vault` is the host's own ClipVault, built with its storage.
export function startEngine(config: ClipConfig, vault: ClipVault, hash: typeof hashSignablePayload, openApproval: (id: string) => void) {
  const kv = new MemoryKV();
  const deps = createEngineDependencies({ config, vault, hashPayload: hash, currency: async () => "USD", walletConnect: { projectId: undefined, url: "https://wallet.acme.example", iconUrl: "https://wallet.acme.example/icon.png" }, kv });
  const engine = new WalletEngine(deps, kv, {
    walletName: config.name,
    openApproval,
    broadcast: () => undefined,
    armAutoLock: () => undefined,
    fetch: globalThis.fetch,
    randomUUID: () => crypto.randomUUID(),
  });
  engine.start();
  return createEngineClient(engine, { subscribe: () => () => undefined }); // what @clip-wallet/ui talks to
}
```

`engine.handleUntrusted(msg)` validates every message with the extension bus's zod schema. `engine.attachDappPort(port,
senderOrigin)` wires a 1Mask port; `senderOrigin` must come from the host (browser sender, WebView URL), never the page.

## Documentation

- [Engine and hosts](https://coldai.org/clip/docs/architecture/engine.html)
- [The signing flow](https://coldai.org/clip/docs/architecture/signing-flow.html)
- [API reference](https://coldai.org/clip/docs/reference/api/engine.html)

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

See [LICENSE](./LICENSE).
