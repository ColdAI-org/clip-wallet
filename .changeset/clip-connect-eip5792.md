---
"@clip-wallet/connect": minor
"@clip-wallet/1mask": minor
"@clip-wallet/engine": minor
"@clip-wallet/extension-kit": minor
"@clip-wallet/route": minor
"@clip-wallet/chains-evm": minor
"@clip-wallet/core": minor
"@clip-wallet/ui": minor
"@clip-wallet/link": patch
---

Clip Connect (`@clip-wallet/connect`), a wallet-agnostic dapp SDK, and the EIP-5792 Wallet Call API with ERC-7682 auxiliary funds in 1Mask and over WalletConnect: one approval for a batch of calls, funded from the user's other balances when settle on Hedera can; dapps that never call the new methods see no difference. `window.injectedWeb3` is now writable so `@polkadot/extension-dapp` loads.
