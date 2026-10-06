# @clip-wallet/chains-bitcoin

The Bitcoin `ChainModule` for Clip Wallet: testnet4 and signet by default, native segwit and taproot, PSBT signing
(sats-connect style), BIP-322 and BIP-137 messages and largest-first coin selection. It never touches keys: `prepare()`
returns the sighashes for the vault to sign and `finalize()` puts the signatures into the PSBT. Inscribed coins are
warned about before they are spent.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/chains-bitcoin @clip-wallet/core
```

## Example

```ts
import type { ChainModule } from "@clip-wallet/core";
import { createBitcoinModule, BITCOIN_TESTNET4, networkById } from "@clip-wallet/chains-bitcoin";

// A wallet's background holds one module per family; it never gives the module a key.
const module: ChainModule = createBitcoinModule();
console.log(module.family, module.derivationPath(0)); // "bitcoin" "m/84'/1'/0'/0/0"

const network = networkById(BITCOIN_TESTNET4)!;
console.log(network.id, network.testnet); // a CAIP-2 id, true

// The flow: decode() → the person approves → prepare() → the vault signs → finalize().
```

## Documentation

- [Chain modules](https://coldai.org/clip/docs/architecture/chain-modules.html)
- [Write a chain module](https://coldai.org/clip/docs/extend/chain-module.html)
- [The Bitcoin guide for dapps](https://coldai.org/clip/docs/dapps/bitcoin.html)
- [API reference](https://coldai.org/clip/docs/reference/api/chains-bitcoin.html)

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

See [LICENSE](./LICENSE).
