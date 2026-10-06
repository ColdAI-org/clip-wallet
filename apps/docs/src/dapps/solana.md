# Solana

Clip Wallet registers a **Wallet Standard** wallet for Solana. `@solana/wallet-adapter` lists every Wallet Standard
wallet by itself, so pass `wallets={[]}` (or keep your existing adapters) and Clip appears.

| Feature | |
| --- | --- |
| `standard:connect` | supports `silent` (no prompt for a site that is already connected) |
| `solana:signTransaction`, `solana:signAndSendTransaction` | legacy and v0 transactions |
| `solana:signMessage` | |
| `solana:signIn` | Sign In With Solana: connect and sign in with one approval |
| Chains | `solana:devnet` while Clip is pre-release |

## React

<<< @/snippets/dapps/solana-react.tsx

## Without React

<<< @/snippets/dapps/solana-standard.ts

Clip registers one Wallet Standard wallet per ecosystem, all named "Clip Wallet" (as Phantom and others do). Filter
by the features you need, as the adapter's `isWalletAdapterCompatibleStandardWallet` does above.

## Prefer Clip with one adapter

`clipSolanaAdapter()` from Clip Connect returns a single adapter that prefers Clip Wallet and falls back to another
installed Solana wallet. See [Solana adapter](../connect/solana.md).

## Tested

- **Dapp matrix**, devnet: `StandardWalletAdapter` over the Wallet Standard connects, signs a message verified with
  `verifyMessageSignature`, sends a transfer the network confirms, and the approval names the amount and recipient.
  [Results](../testing/results/dapp-matrix.md) · [test page](repo:apps/extension/e2e/matrix/dapps/solana.ts)
- **Picker matrix**: `@solana/wallet-adapter-react-ui`'s `WalletMultiButton` lists Clip, connects, reconnects and
  restores with `autoConnect`. The hosted wallet-adapter example connects through Sign In With Solana and signs.
  [Results](../testing/results/picker-matrix.md) · [test page](repo:apps/extension/e2e/pickers/dapps/src/solana.tsx)
