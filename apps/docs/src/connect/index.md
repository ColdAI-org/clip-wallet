# Clip Connect

`@clip-wallet/connect` is the dapp side of Clip Wallet: a small, wallet-agnostic SDK for apps that want more than
"connect and sign". It finds Clip Wallet first, falls back to any other wallet, and gives you one way to ask for money
that lets a capable wallet bring it in from the person's other networks.

::: tip You don't need it to support Clip
Clip Wallet works with your existing dapp through each ecosystem's own standard. Clip Connect is opt-in, for its
extras. See [Clip works with your dapp](../dapps/).
:::

- **Built on public standards only**: EIP-1193, EIP-6963, EIP-5792, ERC-7682, the Wallet Standard, CAIP-2/10. It
  imports no wallet internals and has no runtime dependencies; the core is about 5 KB minified and gzipped.
- **Any wallet.** It prefers Clip Wallet, and works with any EIP-6963 or Wallet Standard wallet, `window.ethereum`, a
  provider you pass (Reown AppKit), or WalletConnect.
- **Accounts as CAIP-10** across families: `eip155:84532:0x…`, `solana:EtWT…:9xQe…`.
- **Network-invisible payments.** `pay({ asset: "usdc", amount: "25", to })` picks the chain itself: where the person
  holds enough, else where the wallet can bring the money in.

## Install

```sh
npm i @clip-wallet/connect
```

Optional peers, only for the parts you use: `react` (hooks), `@wagmi/core` (the wagmi connector),
`@solana/wallet-standard-wallet-adapter-base` (the Solana adapter) and `@walletconnect/ethereum-provider` (the
WalletConnect fallback).

## Quick start

<<< @/snippets/connect/quickstart.ts

## What's in it

| Import | What |
| --- | --- |
| `@clip-wallet/connect` | [`connect()`](./connect.md), and on the connection [`request()`](./request.md), [`pay()`, `canPay()`, `balances()`](./pay.md), `capabilities()`, `on()`, `disconnect()`; CAIP and amount helpers |
| `@clip-wallet/connect/react` | [`ClipConnectProvider`, `useClipConnect`, `usePay`, `useBalances`](./react.md) |
| `@clip-wallet/connect/wagmi` | [`clipConnect()`](./wagmi.md), a wagmi connector that prefers Clip |
| `@clip-wallet/connect/solana` | [`clipSolanaAdapter()`](./solana.md), a wallet-adapter adapter that prefers Clip |

Generated API reference: [`@clip-wallet/connect`](../reference/api/connect.md).

## What happens with each kind of wallet

| Wallet | `pay()` sends | `result.fallback` |
| --- | --- | --- |
| Clip Wallet, on a chain where it can bring money in | `wallet_sendCalls` with ERC-7682 `auxiliaryFunds` | none |
| Clip Wallet, other chains | `wallet_sendCalls` | `"no-auxiliary-funds"` |
| Another EIP-5792 wallet (a smart account) | `wallet_sendCalls`, plus `requiredAssets` if it advertises ERC-7682 | as advertised |
| A wallet without EIP-5792 | `eth_sendTransaction` on one chain | `"no-eip5792"` |

Details: [Wallet calls (EIP-5792)](./wallet-calls.md). The promise that none of this changes anything for dapps that
don't use it: [Compatibility promise](./compatibility.md).

## Try it

The [Scaffold-HBAR template](../kit/scaffold-hbar.md)'s demo dapp has a `/clip-connect` page: one connect for your
wallet or any other, accounts as CAIP-10, capabilities, balances by asset and `pay()` with auxiliary funds.
