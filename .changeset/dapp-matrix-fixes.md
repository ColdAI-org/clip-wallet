---
"@clip-wallet/1mask": minor
"@clip-wallet/engine": patch
"@clip-wallet/extension-kit": patch
"@clip-wallet/core": minor
"@clip-wallet/ui": patch
"@clip-wallet/chains-solana": patch
"@clip-wallet/chains-aptos": patch
"@clip-wallet/chains-near": patch
"@clip-wallet/chains-sui": patch
"@clip-wallet/chains-cardano": patch
"@clip-wallet/chains-hedera": patch
"@clip-wallet/chains-stellar": patch
---

Fixes found by the testnet dapp matrix (docs/r1/dapp-matrix.md):

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
