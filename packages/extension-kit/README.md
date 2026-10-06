# @clip-wallet/extension-kit

The Clip Wallet browser extension as a library, for [WXT](https://wxt.dev). A wallet project keeps its identity
(`clip.config.ts`, icon), `wxt.config.ts` and one-line entrypoints; the background (vault, approvals, security
checks), the pages, 1Mask for all 14 network families and the build wiring come from here, versioned and signed.

```ts
// wxt.config.ts
import { defineConfig } from "wxt";
import { clipWallet } from "@clip-wallet/extension-kit/wxt";
import clipConfig from "./clip.config";

export default defineConfig(clipWallet({ config: clipConfig }));
```

```ts
// src/entrypoints/background.ts
import { defineBackground } from "wxt/utils/define-background";
import { startBackground } from "@clip-wallet/extension-kit/background";
export default defineBackground(() => startBackground());
```

| Entrypoint | Import |
| --- | --- |
| background | `startBackground()` from `/background` |
| content (ISOLATED) | `startContentBridge()`, `CONTENT_MATCHES` from `/content` |
| inpage (MAIN) | `installInpage()`, `CONTENT_MATCHES` from `/inpage` |
| popup, tab | `mountWallet("popup" \| "tab")` from `/pages` |
| approval | `mountApprovalWindow()` from `/pages` |
| plugin-host (offscreen) | `startPluginHost()` from `/plugin-host` |
| plugin-sandbox | `import "@clip-wallet/extension-kit/plugin-sandbox"` |

`npx create-clip-wallet my-wallet` (or the Scaffold-HBAR template) writes all of this for you.

## What `clipWallet()` does

- **Identity.** Manifest name, description and `key` (a fixed extension id) from clip.config.ts; EIP-6963 / Wallet
  Standard name, icon and rdns; `window.<wallet key>` for NEAR, Stellar and Algorand; TON Connect bridge key; Firefox
  gecko id from the rdns. The icon must ship with the extension.
- **Build environment.** `CLIP_WALLETCONNECT_PROJECT_ID`, partner keys (`CLIP_0X_API_KEY`, `CLIP_JUPITER_API_KEY`,
  `CLIP_MOONPAY_*`, `CLIP_BANXA_PARTNER`, `CLIP_C14_*`, `CLIP_COINGECKO_DEMO_KEY`, `CLIP_BLOCKAID_API_KEY`) from the
  environment or `CLIP_*` lines in `.env`. Nothing else in `.env` is read.
- **Security floor.** The open phishing lists are always on and refreshed daily; there is no option to switch them
  off, and `@clip-wallet/security` refuses a mainnet config that tries. Blockaid scanning is added only with a key.
- **Mainnet checklist.** A config with mainnet enabled is refused at build time while `mainnetProblems()` lists anything
  or the project's `MAINNET.md` has an open box.
- **Fixture mode.** `CLIP_MOCKS=1 wxt build` builds with mock chains, route and dapps for screenshots and demos.

Peer dependencies: `wxt`, `@wxt-dev/module-react`, `react`, `react-dom`.

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly. Pre-release: test networks by default.

Apache-2.0 licence: see [LICENSE](LICENSE) and [NOTICE](NOTICE). "Clip Wallet" and "1Mask" are ColdAI trademarks (not licensed).
