# Clip works with your dapp

You don't need to add anything for Clip Wallet. It answers each ecosystem's own wallet standard, so the libraries your
dapp already uses (wagmi, RainbowKit, the Solana wallet adapter, dapp-kit, Mesh, `@polkadot/extension-dapp`…) find it
and talk to it like any other wallet.

::: tip The compatibility promise
For every connector, Clip never changes method results, events, error codes or timing that a dapp library can observe.
New capabilities are opt-in: they answer only when a dapp asks for them. An end-to-end suite runs real, unmodified dapp
libraries against every build to prove it. See [Compatibility promise](../connect/compatibility.md).
:::

## Find your ecosystem

| Ecosystem | Standard Clip answers | Works out of the box | Guide |
| --- | --- | --- | --- |
| EVM chains | EIP-1193 + EIP-6963 | wagmi, RainbowKit, ConnectKit, Reown AppKit, viem, ethers | [EVM](./evm.md), [wagmi and RainbowKit](./wagmi-rainbowkit.md), [AppKit](./appkit.md) |
| Hedera | EIP-1193 on chain 296; WalletConnect (`hedera_*`) | wagmi / viem `hederaTestnet`, Scaffold-HBAR; HashConnect v3 / DAppConnector (with a WalletConnect build) | [Hedera](./hedera.md) |
| Solana | Wallet Standard | `@solana/wallet-adapter`, Sign In With Solana | [Solana](./solana.md) |
| Sui | Wallet Standard | `@mysten/dapp-kit` | [Sui](./sui.md) |
| Aptos | AIP-62 | `@aptos-labs/wallet-adapter-react` | [Aptos](./aptos.md) |
| Bitcoin | Wallet Standard `bitcoin:*`, sats-connect provider | Wallet Standard discovery | [Bitcoin](./bitcoin.md) |
| Cardano | CIP-30 | Mesh and any CIP-30 dapp | [Cardano](./cardano.md) |
| Polkadot SDK | `injectedWeb3` | `@polkadot/extension-dapp`, polkadot.js apps | [Polkadot](./polkadot.md) |
| Starknet | get-starknet v4 | get-starknet; starknetkit with one connector | [Starknet](./starknet.md) |
| TON | TON Connect JS bridge | `@tonconnect/sdk`; `@tonconnect/ui` with one list entry | [TON Connect](./ton.md) |
| NEAR | NEAR Connect; Wallet Selector module | NEAR Connect; Wallet Selector with `@clip-wallet/kit-modules/near` | [NEAR](./near.md) |
| Stellar | SEP-43 | Stellar Wallets Kit with `@clip-wallet/kit-modules/stellar` | [Stellar](./stellar.md) |
| Algorand | ARC-1 | use-wallet with `@clip-wallet/kit-modules/algorand` | [Algorand](./algorand.md) |
| Tezos | Beacon (TZIP-10) | Beacon finds Clip; its modal needs a listing to connect | [Tezos](./tezos.md) |
| Cosmos SDK (Osmosis, dYdX, ZIGChain, Provenance, THORChain, Initia) | Keplr-compatible API at `window.clipwallet.cosmos` | cosmjs and Keplr-style dapps, passing Clip's object instead of `window.keplr` | [Cosmos](./cosmos.md) |
| TRON | TIP-1193 + TIP-6963 | TIP-6963 discovery; TronWeb for building transactions | [TRON](./tron.md) |
| XRP Ledger | XLS-72d (Wallet Standard) | `@wallet-standard/app` with the XRPL feature filter | [XRP Ledger](./xrpl.md) |
| Stacks | SIP-030 + WBIP-004 | `@stacks/connect` 8 | [Stacks](./stacks.md) |
| Fuel | FuelConnector | fuels-ts `Fuel` | [Fuel](./fuel.md) |
| Bitcoin Cash | WalletConnect (wc2-bch-bcr) | Cashonize-style WalletConnect dapps | [Bitcoin Cash](./bitcoincash.md) |
| MultiversX | best effort: sdk-dapp's custom-provider hook | `@multiversx/sdk-dapp` 5, where the dapp keeps `window.multiversx` | [MultiversX](./multiversx.md) |
| Any (phones, desktop apps) | WalletConnect v2 | Any WalletConnect dapp | [WalletConnect](./walletconnect.md) |

Antelope (Vaulta, Telos, XPR Network) and the Internet Computer have no wallet standard Clip can answer as itself
(WharfKit's plugins live in the dapp, Anchor Link and Scatter would mean posing as those wallets, and ICRC-94 is still a
draft), so on those networks Clip sends and receives but doesn't connect to dapps. Every network, with how dapps reach
it: [Networks](../reference/networks.md).

Some ecosystems' pickers show only the wallets in their own registry. For those, the guide shows the one line a dapp
adds (a module, an adapter, a list entry) until Clip is listed. Listing submissions are drafted and wait for the public
release.

## How we test this

Every guide links to two kinds of evidence, both run against the real extension build on public testnets:

- **The [dapp matrix](../testing/results/dapp-matrix.md)**: for each family, that ecosystem's own dapp library in a
  page connects (L1), signs a message the ecosystem's verifier accepts (L2), sends a transaction the testnet confirms
  (L3), and the approval shows the decoded request (L4).
- **The [picker matrix](../testing/results/picker-matrix.md)**: each ecosystem's stock connect UI lists Clip with the
  right name and icon, connects, reconnects and restores after a reload; plus real hosted testnet dapps.

How to run them yourself: [Dapp and picker matrices](../testing/matrices.md).

## Things that are the same everywhere

- **Test networks only** while Clip is pre-release. Point your dapp at a testnet (Sepolia, Base Sepolia, Hedera testnet
  296, Solana devnet…). Get test tokens: [Fund a test wallet](../testing/test-wallet.md).
- **The person sees plain words.** Every request is decoded before approval. A request Clip can't read is blocked by
  default, so send standard, decodable requests (typed data rather than raw hashes, real transactions rather than
  opaque blobs).
- **Errors are standard.** Rejection is the ecosystem's own "user rejected" (EIP-1193 `4001`). See
  [Dapp-facing error codes](../reference/dapp-errors.md).
- **`localhost` works.** 1Mask is injected on `https://` pages and on `http://localhost` and `http://127.0.0.1`.

Want Clip's extras, such as `pay()` that brings money in from the person's other networks? See
[Clip Connect](../connect/).
