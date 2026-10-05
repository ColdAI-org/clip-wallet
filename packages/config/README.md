# @clip-wallet/config

The typed schema for `clip.config.ts`, the one file a wallet maker edits: identity (name, description, rdns, homepage,
icon, extension key), theme, networks (14 families), routing defaults and settle-on-Hedera, hardware wallets,
WalletConnect, passkeys, optional hosted services, and the mainnet switch.

```ts
// clip.config.ts
import { defineConfig } from "@clip-wallet/config";

export default defineConfig({
  name: "Acme Wallet",
  rdns: "com.acme.wallet",              // EIP-6963 id: a reverse domain you own
  homepage: "https://wallet.acme.com",
  icon: "./icon.svg",
  theme: { accent: "#0B7A3B" },          // contrast with accentText must be at least 3:1
  networks: ["evm:*", "hedera", "solana", "bitcoin"],
  mainnet: false,                        // test networks only
});
```

`defineConfig` validates and fills defaults; problems come back as plain sentences, one per setting
(`ConfigError.problems`). The WalletConnect project id is read from `CLIP_WALLETCONNECT_PROJECT_ID`, never committed.

Mainnet is off until `mainnet: { enabled: true, acknowledged: MAINNET_ACKNOWLEDGEMENT }`, and the extension build also
refuses it while `mainnetProblems(config)` lists anything (placeholder rdns, no homepage, no extension key, no
WalletConnect project id, a remote icon). Helpers: `walletKey`, `rdnsDomain`, `enabledFamilies`, `includesEvmChain`,
`isMainnetEnabled`, `defaults`.

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly. Pre-release: test networks by default.

MIT licence.
