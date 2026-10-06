# Launch your own wallet

The Clip Wallet kit lets you ship a wallet under your own name on the same code Clip Wallet runs: fourteen network
families, 1Mask for every dapp, decoded approvals, the security floor, features, plugins and route-and-fund. You change
identity and configuration; the wallet itself is versioned, signed npm packages.

::: warning Test networks first
A new wallet runs on test networks. Mainnet is a later decision by the wallet's owner, behind a checklist the build and
the harness both enforce. See [Build and ship](./build-and-ship.md#mainnet).
:::

## What you get

| | |
| --- | --- |
| **A browser extension with its own identity** | Its own name, icon, extension id, EIP-6963 rdns and WalletConnect project. It never announces itself as Clip Wallet. |
| **Every dapp works** | EIP-1193 + EIP-6963, the Wallet Standard, AIP-62, CIP-30, `injectedWeb3`, get-starknet, TON Connect, NEAR Connect, SEP-43, Beacon and WalletConnect, all under your identity. |
| **A security floor you can't switch off** | Open phishing lists, look-alike and new-contract checks, decode-before-approve, approval review and revoke. |
| **A Scaffold-HBAR dapp** | Next.js on Hedera testnet that connects to your wallet, signs, sends, and demos Clip Connect. |
| **Listing drafts** | For TON Connect, NEAR, Stellar Wallets Kit, Beacon, use-wallet, WalletConnect Explorer and EIP-6963, filled in with your identity. |
| **Agent tooling** | `AGENTS.md`, `llms.txt`, `.harness/` and `pnpm harness` in every project. See [Work with AI agents](./ai-agents.md). |

## Two ways in, one project

```sh
npx create-clip-wallet my-wallet
```

or, with the Scaffold-HBAR command line:

```sh
npm create scaffold-hbar@latest -- --template ColdAI-org/scaffold-hbar-clip-wallet
cd <project> && pnpm install && pnpm wallet:identity --name "Acme Wallet" --rdns com.acme.wallet
```

Both produce **the same project**: they copy the same template the same way, then run the same identity step.

## The steps

1. [Create the project](./create-clip-wallet.md) and give it an identity.
2. [Configure it](./config.md): accent, networks, routing, hardware, services.
3. [Build, test and ship it](./build-and-ship.md): load it unpacked, package it for the stores, submit listings.
4. Keep it current: upgrade the pinned kit version deliberately, read the changelog, verify provenance.

## What lives where in your project

```text
packages/extension/            your wallet: wallet.identity.json, clip.config.ts, icon, one-line WXT entrypoints
packages/nextjs/               the Scaffold-HBAR dapp: home page, /clip-connect, /debug, Hedera testnet
docs/listings/                 listing drafts for your identity
tools/harness/check.mjs        the rules (pnpm harness)
tools/verify-provenance.mjs    checks the kit packages were built by the kit's CI
.harness/  AGENTS.md  llms.txt how agents (and people) change the project safely
```
