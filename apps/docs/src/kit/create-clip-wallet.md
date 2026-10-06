# create-clip-wallet

`create-clip-wallet` makes a new wallet project and gives it an identity of its own.

```sh
npx create-clip-wallet my-wallet
```

It asks for anything you don't pass as a flag. Without questions:

```sh
npx create-clip-wallet my-wallet --name "Acme Wallet" --rdns com.acme.wallet --accent "#0B7A3B" \
  --networks "evm:*,hedera,solana,bitcoin" --homepage https://wallet.acme.example --yes
cd my-wallet && pnpm install && pnpm extension:build && pnpm next:dev
```

Then load `packages/extension/.output/chrome-mv3` with **Load unpacked** in `chrome://extensions`, create a wallet in
it, and open the dapp at `http://localhost:3000`.

## What the identity step writes

| File | What |
| --- | --- |
| `packages/extension/wallet.identity.json` | name, description, rdns, homepage, icon and `extension.key` (a public key) |
| `packages/extension/.keys/extension.pem` | the extension's **private** key: mode 0600, gitignored, never printed. Its public half fixes the Chrome extension id. Back it up offline. |
| `packages/extension/icon.svg`, `public/icon/*.png` | a starter mark in your accent colour, or your `--icon` |
| `packages/extension/clip.config.ts` | `theme.accent` and `networks`, when given |
| `packages/extension/.env`, `packages/nextjs/.env.local` | your WalletConnect project id (`--walletconnect-project-id`), never committed |
| `docs/listings/` | listing drafts for this identity |

It refuses Clip Wallet's own identity (`org.coldai.*`, the name "Clip Wallet") and anything `@clip-wallet/config`
rejects, and then writes nothing. Run again, it keeps the extension key (and so the id) unless you pass `--new-key`.

## Commands

| Command | In a project | What |
| --- | --- | --- |
| `create-clip-wallet <folder>` | | a new project |
| `create-clip-wallet identity` | `pnpm wallet:identity` | set or change the identity |
| `create-clip-wallet listings` | `pnpm wallet:listings` | regenerate the listing drafts after an identity change |
| `create-clip-wallet mainnet-check` | `pnpm wallet:mainnet-check` | what still blocks a mainnet build (exit `0` ready, `2` work left, `1` mainnet on but not ready) |

Every option and exit code: [create-clip-wallet CLI](../reference/cli.md).

## Same project as the template

`npx create-clip-wallet my-wallet` and
`npm create scaffold-hbar@latest -- --template ColdAI-org/scaffold-hbar-clip-wallet` followed by
`pnpm wallet:identity` give the same files: both skip `.git`, `node_modules` and `.env`, apply the template's rename
map, `git init`, then run the same identity code. The kit's CI checks it (`pnpm kit:e2e` and
`pnpm kit:e2e:scaffold-hbar`, from packed tarballs).
