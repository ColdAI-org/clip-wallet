# @clip-wallet/link

## 0.2.0

### Patch Changes

- 07f329b: Relicensed from MIT to the Apache License 2.0 (`Copyright 2026 ColdAI`). Every published package now ships `LICENSE`
  (Apache-2.0) and a `NOTICE` with the trademark note ("Clip Wallet", "1Mask" and the logo are ColdAI trademarks; the
  licence grants no trademark rights). `@clip-wallet/route` keeps the MIT notice of the vendored CLPRouter SDK planner,
  and `create-clip-wallet` keeps the MIT notice of the Scaffold-HBAR / Scaffold-ETH 2 dapp in its bundled template.
  Projects made with `create-clip-wallet` or the Scaffold-HBAR template start as Apache-2.0.
- e3fba40: Clip Connect (`@clip-wallet/connect`), a wallet-agnostic dapp SDK, and the EIP-5792 Wallet Call API with ERC-7682 auxiliary funds in 1Mask and over WalletConnect: one approval for a batch of calls, funded from the user's other balances when settle on Hedera can; dapps that never call the new methods see no difference. `window.injectedWeb3` is now writable so `@polkadot/extension-dapp` loads.
- d90f6aa: Trailing slashes, base64 padding and NUL padding are trimmed with a scan from the end, and node error messages are
  matched with plain string searches one line at a time, so this work stays linear in the length of its input.
  `@clip-wallet/core` adds the two helpers this uses: `withoutTrailing(s, chars)` and `includesInOrder(text, ...parts)`.
  The plugin installer takes a pax `path` only from a record of its own, and the Phantom list is read line by line.
- b98fe95: The desktop link server listens first and replaces a socket left behind only when nothing answers on it, so a copy of
  the app that is running keeps its socket (starting a second one fails with `EADDRINUSE` instead). create-clip-wallet
  reads the files it edits once instead of checking for them first.
- 2d940da: Every package README is now an npm landing page: what the package is for, how to install it, a minimal example that compiles, and links to the developer docs.
- 31a0f40: Crypto-critical dependencies (`@noble/*`, `@scure/*`, `hash-wasm`, `@walletconnect/*`, `@ledgerhq/*`,
  `@keystonehq/*`, `@ngraveio/bc-ur`, `@ton/crypto`) are pinned to exact versions, the ones the lockfile already
  resolved. Audit SUP-02.
- Updated dependencies [07f329b]
- Updated dependencies [9b69ba4]
- Updated dependencies [e3fba40]
- Updated dependencies [6d36975]
- Updated dependencies [a84b2ab]
- Updated dependencies [d90f6aa]
- Updated dependencies [20b6dda]
- Updated dependencies [2d940da]
- Updated dependencies [c6bf6f0]
  - @clip-wallet/core@0.2.0
