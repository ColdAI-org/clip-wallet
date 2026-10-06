# @clip-wallet/chains-bitcoin

The Bitcoin `ChainModule` for Clip Wallet: testnet4 and signet by default, native segwit and taproot, PSBT signing
(sats-connect style), BIP-322 messages and largest-first coin selection. It never touches keys: `prepare()` returns
the sighashes for the vault to sign and `finalize()` puts the signatures into the PSBT. Inscribed coins are warned
about before they are spent.

```ts
import { createBitcoinModule, BITCOIN_TESTNET4 } from "@clip-wallet/chains-bitcoin";
const btc = createBitcoinModule();
```

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly. Pre-release: test networks by default.

Apache-2.0 licence: see [LICENSE](LICENSE) and [NOTICE](NOTICE). "Clip Wallet" and "1Mask" are ColdAI trademarks (not licensed).
