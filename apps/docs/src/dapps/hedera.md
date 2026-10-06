# Hedera

Hedera dapps reach Clip Wallet in two ways, and Clip supports both:

| Path | Who uses it | What the dapp sees |
| --- | --- | --- |
| **EIP-1193 on chain 296** (testnet) | Scaffold-HBAR, wagmi/viem `hederaTestnet`, SaucerSwap's EVM side, any EVM dapp | an EVM wallet on the Hashio JSON-RPC relay |
| **Hedera's own API over WalletConnect** | HashConnect v3, `@hashgraph/hedera-wallet-connect` (DAppConnector) | a Hedera account `0.0.x` with `hedera_*` methods |

## EIP-1193 on chain 296

Exactly like any EVM chain. `wallet_switchEthereumChain` to `0x128` (296) succeeds whenever the wallet has Hedera.

<<< @/snippets/dapps/hedera-evm.ts

::: info Two accounts, one phrase
Injected EVM dapps on 296 see the wallet's **EVM** account (key `m/44'/60'/0'/0/0`, as MetaMask would). Clip's native
Hedera account uses a separate key (`m/44'/3030'/0'/0/0`). HBAR sent to the EVM-path account is spendable from dapps,
but Home shows the native Hedera account's balance. On Hedera's EVM, `value` is in weibar: 1 tinybar = 10¹⁰ weibar.
:::

## HashConnect and WalletConnect

`@hashgraph/hedera-wallet-connect`'s `DAppConnector` lists extension wallets by asking the page
(`hedera-extension-query`). Clip answers in builds that have a WalletConnect project id, and `connectExtension()` hands
the pairing to Clip's own WalletConnect; the session still needs the person's approval.

<<< @/snippets/dapps/hedera-walletconnect.ts

Methods: `hedera_signMessage`, `hedera_signTransaction`, `hedera_signAndExecuteTransaction`,
`hedera_executeTransaction`, `hedera_signAndExecuteQuery`, `hedera_getNodeAddresses`. Accounts are
`hedera:testnet:0.0.x`. Hedera refuses a transfer to yourself, so test with two accounts.

## Scaffold-HBAR

[Scaffold-HBAR](https://github.com/hedera-dev/scaffold-hbar) apps connect through RainbowKit and wagmi, which find Clip
through EIP-6963. Nothing to install in the dapp: run it, open it in a browser with Clip loaded, and choose
**Clip Wallet**. The [Scaffold-HBAR template](../kit/scaffold-hbar.md) ships a wallet and a dapp together.

## Tested

- **Dapp matrix**, Hedera testnet 296: wagmi + viem `hederaTestnet` connects, signs, sends a transfer the network
  confirms, and the approval shows it decoded. [Results](../testing/results/dapp-matrix.md) ·
  [test page](repo:apps/extension/e2e/matrix/dapps/hedera-evm.ts)
- **WalletConnect / HashConnect**: the matrix row and the picker row are ready but skip until a WalletConnect project
  id is configured for the test run. [DAppConnector test page](repo:apps/extension/e2e/matrix/dapps/hedera.ts)
- **HashScan** lists Clip through EIP-6963; connecting there needs accepting its terms, so the run stops at "listed".
