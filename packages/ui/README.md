# @clip-wallet/ui

Clip Wallet's React screens, components and theme tokens: onboarding, home, send/receive, approvals (every request
decoded in plain words), activity, collectibles, settings, security, hardware, plugins, social and the route-and-fund
flow. Screens read state through a `WalletClient` (they never import the vault) and brand from `clip.config.ts`
(name, accent, font, radius), so a kit-built wallet looks like itself.

```tsx
import "@clip-wallet/ui/styles.css";
import { WalletApp, ApprovalWindowApp } from "@clip-wallet/ui";

<WalletApp client={client} config={config} variant="popup" />;
```

React 19 is a peer dependency. In an extension you normally don't use this directly: `@clip-wallet/extension-kit`
mounts it.

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly. Pre-release: test networks by default.

Apache-2.0 licence: see [LICENSE](LICENSE) and [NOTICE](NOTICE). "Clip Wallet" and "1Mask" are ColdAI trademarks (not licensed).
