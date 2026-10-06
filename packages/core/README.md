# @clip-wallet/core

The shared contract between Clip Wallet packages: networks and assets, accounts, the `Vault` and `ChainModule`
interfaces, `DappRequest` → `DecodedRequest`, `SignablePayload`, and `ClipError` (a plain-words `userMessage` plus a
stable `code`). Types and a few constants only; no dependencies.

```ts
import type { ChainModule, DecodedRequest, Network } from "@clip-wallet/core";
import { ClipError } from "@clip-wallet/core";
```

The rules every package follows (enforced by `pnpm harness` in the monorepo and in kit-built wallets):

- only `@clip-wallet/vault` touches recovery phrases and private keys;
- chain modules build and decode, hand the vault a `SignablePayload`, and get signatures back;
- every dapp request is decoded into a `DecodedRequest` before anyone approves it (undecodable = blind, off by default).

Changes are additive only: a field is never renamed or removed in a minor version.

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly. Pre-release: test networks by default.

Apache-2.0 licence: see [LICENSE](LICENSE) and [NOTICE](NOTICE). "Clip Wallet" and "1Mask" are ColdAI trademarks (not licensed).
