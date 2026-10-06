# Solana adapter

`clipSolanaAdapter()` from `@clip-wallet/connect/solana` returns a `StandardWalletAdapter` for Clip Wallet's Solana
wallet, or for another installed Solana wallet if Clip isn't there, or `null` when there is none.
`@solana/wallet-standard-wallet-adapter-base` is an optional peer.

<<< @/snippets/connect/solana-adapter.tsx

`@solana/wallet-adapter-react` already lists every Wallet Standard wallet by itself; this helps an app that wants a
single adapter that prefers Clip (or the wallet you name: `clipSolanaAdapter({ name: "My Wallet" })`).

Also exported: `findSolanaWallet(prefer?)` (the Wallet Standard wallet itself) and `isSolanaWallet(w)` (the adapter's own
feature requirements).
