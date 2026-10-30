# @clip-wallet/chains-hedera

## 0.2.0

### Patch Changes

- 07f329b: Relicensed from MIT to the Apache License 2.0 (`Copyright 2026 ColdAI`). Every published package now ships `LICENSE`
  (Apache-2.0) and a `NOTICE` with the trademark note ("Clip Wallet", "1Mask" and the logo are ColdAI trademarks; the
  licence grants no trademark rights). `@clip-wallet/route` keeps the MIT notice of the vendored CLPRouter SDK planner,
  and `create-clip-wallet` keeps the MIT notice of the Scaffold-HBAR / Scaffold-ETH 2 dapp in its bundled template.
  Projects made with `create-clip-wallet` or the Scaffold-HBAR template start as Apache-2.0.
- d0891e8: EVM: multicall(bytes[]), multicall(uint256,bytes[]), aggregate3 and the Universal Router's execute are read step by
  step (three levels deep, 32 calls at most). Each step is listed as "Action n" and its warnings carry up to the
  request. One step that can't be read makes the whole request unreadable. Universal Router plans are read for commands
  0x00–0x0e; any other command is unreadable. A simulated preview now lists the permissions a transaction gives: Approval
  and ApprovalForAll from your account. An allowance that only goes down is not listed. Hedera: a ContractExecute
  multicall is read the same way.
- 6d36975: Fixes found by the testnet dapp matrix (docs/r1/dapp-matrix.md):

  - Hedera EVM dapps (chain 296/295) can connect over EIP-1193: Hedera's EVM is a dapp request network whenever the wallet has Hedera (`dappRequestNetworks`), not only with settle on Hedera. It is still never listed or scanned.
  - 1Mask answers Hedera extension discovery (`@hashgraph/hedera-wallet-connect` DAppConnector / HashConnect v3): `hedera-extension-query` lists the wallet, and `hedera-extension-connect-<id>` pairs over WalletConnect (the proposal still needs approval). On only in builds with a WalletConnect project id.
  - A request a chain module refuses to decode keeps the module's plain-words reason (`decodeFailureReason`) instead of only "can't read this request".
  - Solana: a SOL transfer to yourself is decoded ("Send 0.000000001 SOL to G1zR…dxzk") instead of "Approve a transaction".
  - Aptos, NEAR, Sui: an empty or not-yet-created account gets "not enough to pay the fee" / "doesn't exist yet" instead of misleading reasons.
  - Approval balance changes never show a non-zero amount as "−0".
  - Solana, Sui and Cardano self-transfers say what moves (Cardano: "Move your ADA between your own addresses").
  - Hedera `addressFromPublicKey` returns the EIP-55 alias the vault shows; Cardano counts coins at the payment key's enterprise address.
  - Planning a request on Hedera's EVM checks that network's own balance (it isn't in the portfolio).
  - Stellar Horizon reads retry transient failures twice with backoff before reporting offline.

- ffd0808: `derivationPath(i)` now reports `m/44'/3030'/0'/0/i`, the path the vault derives Hedera ECDSA keys at (the Hiero
  SDK's standard ECDSA path). It said `m/44'/60'/0'/0/i`, the EVM account's path.
- d90f6aa: Trailing slashes, base64 padding and NUL padding are trimmed with a scan from the end, and node error messages are
  matched with plain string searches one line at a time, so this work stays linear in the length of its input.
  `@clip-wallet/core` adds the two helpers this uses: `withoutTrailing(s, chars)` and `includesInOrder(text, ...parts)`.
  The plugin installer takes a pax `path` only from a record of its own, and the Phantom list is read line by line.
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
