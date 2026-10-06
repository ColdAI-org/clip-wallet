# @clip-wallet/chains-evm

The EVM `ChainModule` for Clip Wallet: Ethereum, Base, Arbitrum, Optimism, Hedera's EVM (chain 296/295) and any chain by
id. It decodes transactions, permits and typed data into plain words (`DecodedRequest`), simulates (`eth_simulateV1`),
estimates fees and broadcasts. It never touches keys: `prepare()` returns the digest for the vault to sign (secp256k1)
and `finalize()` assembles and sends.

Networks live in `src/networks.ts` (`EvmNetworkSpec`: testnet flag, RPC fallbacks, explorer, indexer); curated tokens
in `src/tokens.ts`, where look-alikes are marked spam. Unlimited approvals and permits are called out in the decode.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/chains-evm @clip-wallet/core
```

## Example

```ts
import type { ChainModule } from "@clip-wallet/core";
import { createEvmModule, EVM_TESTNETS } from "@clip-wallet/chains-evm";

// A wallet's background holds one module per family; it never gives the module a key.
const module: ChainModule = createEvmModule();
console.log(module.family, module.derivationPath(0)); // "evm" "m/44'/60'/0'/0/0"

const network = EVM_TESTNETS[0]!;
console.log(network.id, network.testnet); // a CAIP-2 id, true

// The flow: decode() → the person approves → prepare() → the vault signs → finalize().
```

## Documentation

- [Chain modules](https://coldai.org/clip/docs/architecture/chain-modules.html)
- [Write a chain module](https://coldai.org/clip/docs/extend/chain-module.html)
- [The EVM guide for dapps](https://coldai.org/clip/docs/dapps/evm.html)
- [API reference](https://coldai.org/clip/docs/reference/api/chains-evm.html)

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

See [LICENSE](./LICENSE).
