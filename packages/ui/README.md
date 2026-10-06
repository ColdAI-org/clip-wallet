# @clip-wallet/ui

Clip Wallet's React screens, components and theme tokens: onboarding, home, send and receive, approvals (every request
decoded in plain words), activity, collectibles, settings, security, hardware, plugins, social and the route-and-fund
flow. Screens read state through a `WalletClient` (they never import the vault) and brand from `clip.config.ts` (name,
accent, font, radius), so a kit-built wallet looks like itself.

In an extension you normally don't use this directly: `@clip-wallet/extension-kit` mounts it. React 19 is a peer.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/ui react react-dom
```

## Example

```tsx
import "@clip-wallet/ui/styles.css";
import { WalletApp, mergeBalances, type ClipConfig, type WalletClient } from "@clip-wallet/ui";
import type { TokenBalance } from "@clip-wallet/core";

// The whole wallet, for a client you provide (the extension's message bus, or createEngineClient()).
export function Wallet({ client, config }: { client: WalletClient; config: ClipConfig }) {
  return <WalletApp client={client} config={config} variant="popup" />;
}

// One row per asset: same-issuer balances merge across networks; bridged copies stay apart.
export const rows = (balances: TokenBalance[]) => mergeBalances(balances).assets;
```

## Documentation

- [Engine and hosts](https://coldai.org/clip/docs/architecture/engine.html)
- [Networks are invisible](https://coldai.org/clip/docs/architecture/networks-invisible.html)
- [Add a language](https://coldai.org/clip/docs/extend/languages.html)
- [API reference](https://coldai.org/clip/docs/reference/api/ui.html)

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

See [LICENSE](./LICENSE).
