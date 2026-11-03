# @coldai/clip-wallet-chains-antelope

## 0.2.0

### Minor Changes

- 20b6dda: Every CLPR network with a self-custodial key model: twelve new families (Cosmos SDK chains Osmosis, dYdX, ZIGChain, Provenance, THORChain and Initia; TRON; XRP Ledger; Vaulta, Telos and XPR Network; MultiversX; Internet Computer; Stacks; Fuel; Bitcoin Cash), Chainflip in chains-substrate, STRATO and Arc mainnet in chains-evm, and their dapp providers where a standard lets the wallet appear as itself.
- e267fc9: The kit's packages are published as `@coldai/clip-wallet-<name>`: every `@clip-wallet/<name>` becomes
  `@coldai/clip-wallet-<name>`, for example `@clip-wallet/core` → `@coldai/clip-wallet-core`, and imports use the new
  names (`import { defineConfig } from "@coldai/clip-wallet-config"`). `create-clip-wallet` is unchanged:
  `npx create-clip-wallet` scaffolds a wallet as before.

### Patch Changes

- Updated dependencies [07f329b]
- Updated dependencies [9b69ba4]
- Updated dependencies [e3fba40]
- Updated dependencies [6d36975]
- Updated dependencies [a84b2ab]
- Updated dependencies [d90f6aa]
- Updated dependencies [20b6dda]
- Updated dependencies [e267fc9]
- Updated dependencies [2d940da]
- Updated dependencies [876cb31]
- Updated dependencies [c6bf6f0]
  - @coldai/clip-wallet-core@0.2.0
