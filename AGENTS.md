# AGENTS.md — Clip Wallet

Clip Wallet is a non-custodial wallet for every CLPR network. Pre-release: testnets only.

## Rules that never break
1. Only `packages/vault` touches seed phrases or private keys. `tools/harness/check.mjs` fails otherwise.
2. Chain modules (`packages/chains-*`) implement `ChainModule` from `@clip-wallet/core` and never import the vault.
3. Every dapp request becomes a `DecodedRequest` before approval. Undecodable = blind signing, off by default.
4. Networks are invisible in the default UI: speak in assets and apps; show the network only where a mistake loses money (see the plan's "Networks are invisible").
5. Never log, print or commit key material, phrases, API keys or `.env` values. Tests use the public BIP-39 test vectors only.
6. Testnet by default. Mainnet needs an explicit build flag.

## Commands that must pass
pnpm install && pnpm typecheck && pnpm test && pnpm harness

## Layout
packages/core        shared types (the contract)
packages/vault       phrase, derivation, encryption, signing
packages/1mask       dapp connectors: EIP-1193/6963, Solana Wallet Standard, Bitcoin, Hedera, WalletConnect
packages/chains-*    evm, hedera, solana, bitcoin modules
packages/route       CLPRouter quotes and funding
packages/ui          React screens and theme
apps/extension       MV3 browser extension
tools/harness        validators coding agents must pass
