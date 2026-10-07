# @clip-wallet/plugins

## 0.2.0

### Patch Changes

- 07f329b: Relicensed from MIT to the Apache License 2.0 (`Copyright 2026 ColdAI`). Every published package now ships `LICENSE`
  (Apache-2.0) and a `NOTICE` with the trademark note ("Clip Wallet", "1Mask" and the logo are ColdAI trademarks; the
  licence grants no trademark rights). `@clip-wallet/route` keeps the MIT notice of the vendored CLPRouter SDK planner,
  and `create-clip-wallet` keeps the MIT notice of the Scaffold-HBAR / Scaffold-ETH 2 dapp in its bundled template.
  Projects made with `create-clip-wallet` or the Scaffold-HBAR template start as Apache-2.0.
- 2d940da: Every package README is now an npm landing page: what the package is for, how to install it, a minimal example that compiles, and links to the developer docs.
- 31a0f40: Crypto-critical dependencies (`@noble/*`, `@scure/*`, `hash-wasm`, `@walletconnect/*`, `@ledgerhq/*`,
  `@keystonehq/*`, `@ngraveio/bc-ur`, `@ton/crypto`) are pinned to exact versions, the ones the lockfile already
  resolved. Audit SUP-02.
- b25505f: Size limits hold while downloading: a plugin's network fetch (256 KB), the npm tarball (5 MB) and npm's listing
  (16 MB) are read as a stream and cut off past their limit (a larger Content-Length is refused before reading); an
  oversized fetch now fails instead of arriving truncated. Bundles between 256 KB and the 1 MB install limit start
  (the sandbox accepted only 256 KB messages), and whole 256 KB fetch bodies reach the plugin. New exports
  `readBodyCapped`, `readTextCapped`, `BodyTooLargeError`, `MAX_METADATA_BYTES`. Audit PLG-02.
- Updated dependencies [07f329b]
- Updated dependencies [9b69ba4]
- Updated dependencies [e3fba40]
- Updated dependencies [6d36975]
- Updated dependencies [20b6dda]
- Updated dependencies [2d940da]
  - @clip-wallet/core@0.2.0
