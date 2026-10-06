# @clip-wallet/chains-evm

The EVM `ChainModule` for Clip Wallet: Ethereum, Base, Hedera EVM (chain 296/295) and any chain by id. It decodes
transactions, permits and typed data into plain words (`DecodedRequest`), simulates, estimates fees and broadcasts. It
never touches keys: `prepare()` returns the digest for the vault to sign (secp256k1) and `finalize()` assembles and
sends.

```ts
import { createEvmModule, EVM_TESTNETS, CURATED_TOKENS } from "@clip-wallet/chains-evm";
const evm = createEvmModule();
```

Networks live in `src/networks.ts` (`EvmNetworkSpec`: testnet flag, RPC fallbacks, explorer, indexer); curated tokens
in `src/tokens.ts`, where look-alikes are marked spam. Unlimited approvals and permits are called out in the decode.

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly. Pre-release: test networks by default.

Apache-2.0 licence: see [LICENSE](LICENSE) and [NOTICE](NOTICE). "Clip Wallet" and "1Mask" are ColdAI trademarks (not licensed).
