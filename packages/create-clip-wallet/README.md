# create-clip-wallet

Start your own non-custodial wallet on the [Clip Wallet](https://github.com/ColdAI-org/clip-wallet) kit: a branded
browser extension for 14 network families, with its own name, icon, extension id and EIP-6963 rdns, plus a
Scaffold-HBAR dapp that connects to it on Hedera testnet. Test networks by default.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Use

```sh
npx create-clip-wallet my-wallet
```

## Example

```sh
npx create-clip-wallet my-wallet
# or, without questions
npx create-clip-wallet my-wallet --name "Acme Wallet" --rdns com.acme.wallet --accent "#0B7A3B" \
  --networks "evm:*,hedera,solana,bitcoin" --homepage https://wallet.acme.example --yes
cd my-wallet && pnpm install && pnpm extension:build && pnpm next:dev
```

It makes **the same project** as the Scaffold-HBAR template followed by its identity step:

```sh
npm create scaffold-hbar@latest -- --template ColdAI-org/scaffold-hbar-clip-wallet
cd <project> && pnpm install && pnpm wallet:identity --name "Acme Wallet" --rdns com.acme.wallet
```

Both copy the template the same way (create-scaffold-hbar's copy step: skip `.git`/`node_modules`/`.env`, apply
`template.json`'s rename map, delete it, `git init`), then write the identity.

## Documentation

- [Launch your own wallet](https://coldai.org/clip/docs/kit/)
- [create-clip-wallet](https://coldai.org/clip/docs/kit/create-clip-wallet.html)
- [CLI reference](https://coldai.org/clip/docs/reference/cli.html)

## What the identity step writes

| | |
| --- | --- |
| `packages/extension/wallet.identity.json` | name, description, rdns (EIP-6963), homepage, icon, `extension.key` |
| `packages/extension/.keys/extension.pem` | the extension's private key: 0600, gitignored, never printed; the public half fixes the Chrome extension id |
| `packages/extension/icon.svg`, `public/icon/*.png` | a starter mark in your accent colour, or your `--icon` |
| `packages/extension/clip.config.ts` | `theme.accent` and `networks`, when given |
| `packages/extension/.env`, `packages/nextjs/.env.local` | your WalletConnect project id (`--walletconnect-project-id`), never committed |
| `docs/listings/` | listing-submission drafts for this identity: EIP-6963, WalletConnect Explorer and, for the families you turn on, TON Connect, NEAR, Stellar Wallets Kit, Tezos Beacon, Algorand use-wallet |

It refuses Clip Wallet's own identity (`org.coldai.*`, the name "Clip Wallet") and anything `@clip-wallet/config`
rejects, and writes nothing then. Run again, it keeps the extension key unless you pass `--new-key`.

## Commands

```
create-clip-wallet <folder> [options]   new project
create-clip-wallet identity [options]   in a project (pnpm wallet:identity)
create-clip-wallet listings             in a project (pnpm wallet:listings)
create-clip-wallet mainnet-check        in a project (pnpm wallet:mainnet-check): exit 0 ready, 2 work left, 1 mainnet on but not ready
```

Options: `--name`, `--rdns`, `--accent`, `--networks`, `--homepage`, `--description`, `--icon`,
`--walletconnect-project-id`, `--new-key`, `--no-git`, `--root <dir>`, `--yes`. Run with `--help` for details.

## Testnet first

New wallets run on test networks. There is no `--mainnet`: mainnet is a later decision by the wallet's owner, after
`packages/extension/MAINNET.md`. `pnpm harness` and the extension build both refuse mainnet while a box is open, and the
build also while `mainnetProblems()` (placeholder rdns, no homepage, no extension key, no WalletConnect project id, a
remote icon) lists anything.

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

Apache-2.0: see [LICENSE](./LICENSE) and [NOTICE](./NOTICE). "Clip Wallet" and "1Mask" are ColdAI trademarks (not licensed).
