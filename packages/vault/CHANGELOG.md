# @clip-wallet/vault

## 0.2.0

### Minor Changes

- 20b6dda: Every CLPR network with a self-custodial key model: twelve new families (Cosmos SDK chains Osmosis, dYdX, ZIGChain, Provenance, THORChain and Initia; TRON; XRP Ledger; Vaulta, Telos and XPR Network; MultiversX; Internet Computer; Stacks; Fuel; Bitcoin Cash), Chainflip in chains-substrate, STRATO and Arc mainnet in chains-evm, and their dapp providers where a standard lets the wallet appear as itself.

### Patch Changes

- 07f329b: Relicensed from MIT to the Apache License 2.0 (`Copyright 2026 ColdAI`). Every published package now ships `LICENSE`
  (Apache-2.0) and a `NOTICE` with the trademark note ("Clip Wallet", "1Mask" and the logo are ColdAI trademarks; the
  licence grants no trademark rights). `@clip-wallet/route` keeps the MIT notice of the vendored CLPRouter SDK planner,
  and `create-clip-wallet` keeps the MIT notice of the Scaffold-HBAR / Scaffold-ETH 2 dapp in its bundled template.
  Projects made with `create-clip-wallet` or the Scaffold-HBAR template start as Apache-2.0.
- 86786a8: TON v4r2: the wallet id is the standard one on mainnet only; elsewhere it is bound to the network (standard id XOR
  global_id), so a v4r2 transfer signed on testnet can't be replayed on mainnet. A v4r2 testnet wallet has its own
  address (vault and module agree). New exports `v4WalletId`, `V4_STANDARD_WALLET_ID` (chains-ton) and
  `tonV4R2WalletId` (vault). Audit CHAIN-L.
- 2d940da: Every package README is now an npm landing page: what the package is for, how to install it, a minimal example that compiles, and links to the developer docs.
- 31a0f40: Crypto-critical dependencies (`@noble/*`, `@scure/*`, `hash-wasm`, `@walletconnect/*`, `@ledgerhq/*`,
  `@keystonehq/*`, `@ngraveio/bc-ur`, `@ton/crypto`) are pinned to exact versions, the ones the lockfile already
  resolved. Audit SUP-02.
- Updated dependencies [07f329b]
- Updated dependencies [9b69ba4]
- Updated dependencies [e3fba40]
- Updated dependencies [6d36975]
- Updated dependencies [20b6dda]
- Updated dependencies [2d940da]
  - @clip-wallet/core@0.2.0
