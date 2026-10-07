# @clip-wallet/1mask

## 0.2.0

### Minor Changes

- e3fba40: Clip Connect (`@clip-wallet/connect`), a wallet-agnostic dapp SDK, and the EIP-5792 Wallet Call API with ERC-7682 auxiliary funds in 1Mask and over WalletConnect: one approval for a batch of calls, funded from the user's other balances when settle on Hedera can; dapps that never call the new methods see no difference. `window.injectedWeb3` is now writable so `@polkadot/extension-dapp` loads.
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

- 20b6dda: Every CLPR network with a self-custodial key model: twelve new families (Cosmos SDK chains Osmosis, dYdX, ZIGChain, Provenance, THORChain and Initia; TRON; XRP Ledger; Vaulta, Telos and XPR Network; MultiversX; Internet Computer; Stacks; Fuel; Bitcoin Cash), Chainflip in chains-substrate, STRATO and Arc mainnet in chains-evm, and their dapp providers where a standard lets the wallet appear as itself.

### Patch Changes

- 07f329b: Relicensed from MIT to the Apache License 2.0 (`Copyright 2026 ColdAI`). Every published package now ships `LICENSE`
  (Apache-2.0) and a `NOTICE` with the trademark note ("Clip Wallet", "1Mask" and the logo are ColdAI trademarks; the
  licence grants no trademark rights). `@clip-wallet/route` keeps the MIT notice of the vendored CLPRouter SDK planner,
  and `create-clip-wallet` keeps the MIT notice of the Scaffold-HBAR / Scaffold-ETH 2 dapp in its bundled template.
  Projects made with `create-clip-wallet` or the Scaffold-HBAR template start as Apache-2.0.
- b97d4c2: 1Mask: unconnected sites may only proxy cheap chain-state reads (eth_blockNumber, gas price, fee history, syncing,
  client version) through the wallet's RPC; every other read needs the connection. Proxied reads have their own
  per-site limits (5/s, burst 20, 8 in flight; `rateLimit.readsPerSecond` / `readBurst` / `maxInflightReads`). After a
  declined connect the site can't ask again for 30 s, doubling to 10 min (`rateLimit.connectCooldownMs`). The Tezos
  Beacon peer keeps at most 16 uncollected results per site and drops them after 15 minutes. Audit 1MASK-L.
- 2d940da: Every package README is now an npm landing page: what the package is for, how to install it, a minimal example that compiles, and links to the developer docs.
- 31a0f40: Crypto-critical dependencies (`@noble/*`, `@scure/*`, `hash-wasm`, `@walletconnect/*`, `@ledgerhq/*`,
  `@keystonehq/*`, `@ngraveio/bc-ur`, `@ton/crypto`) are pinned to exact versions, the ones the lockfile already
  resolved. Audit SUP-02.
- db17749: WalletConnect: a request naming an account the session didn't approve is refused with 5103 (UNSUPPORTED_ACCOUNTS),
  and one naming another chain (EVM transaction `chainId`, Hedera CAIP-10 signer) with 5100, before it is decoded.
  New export `namedAccounts()`. Audit WC-05.
- Updated dependencies [07f329b]
- Updated dependencies [9b69ba4]
- Updated dependencies [e3fba40]
- Updated dependencies [6d36975]
- Updated dependencies [20b6dda]
- Updated dependencies [2d940da]
  - @clip-wallet/core@0.2.0
