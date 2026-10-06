# Scaffold-HBAR template

The template (`templates/scaffold-hbar-clip-wallet` in the repo, published as `ColdAI-org/scaffold-hbar-clip-wallet`)
is a [Scaffold-HBAR](https://github.com/hedera-dev/scaffold-hbar) project with two packages: **your wallet** as a
browser extension, and a **Next.js dapp** on Hedera testnet that connects to it.

```sh
npm create scaffold-hbar@latest -- --template ColdAI-org/scaffold-hbar-clip-wallet
cd <your-project>
pnpm install
pnpm wallet:identity --name "Acme Wallet" --rdns com.acme.wallet
pnpm extension:build          # → packages/extension/.output/chrome-mv3
pnpm next:dev                 # → http://localhost:3000
```

Prerequisites: Node 22 or later, pnpm 10 or later, Git, and a Chromium browser. Load the extension unpacked, create a
wallet in it, get testnet HBAR from the [Hedera portal faucet](https://portal.hedera.com/faucet), and open the dapp.

## The demo dapp

| Page | What it shows |
| --- | --- |
| `/` | finds your wallet by its EIP-6963 rdns, connects, signs a sign-in message (verified in the page), sends 0.1 HBAR to yourself with a HashScan link |
| `/clip-connect` | [Clip Connect](../connect/): one connect for your wallet or any other, CAIP-10 accounts, EIP-5792 capabilities, balances by asset, and `pay()` with auxiliary funds |
| `/debug` | Scaffold-HBAR's contract debugger, with Hedera's PRNG (`0x169`) and exchange-rate (`0x168`) system contracts |

The header's **Connect Wallet** (RainbowKit) lists your wallet next to MetaMask and WalletConnect. Every request opens
your wallet's approval window, decoded in plain words.

## Commands

| Command | |
| --- | --- |
| `pnpm extension:build` / `extension:dev` / `extension:zip` | build, watch, or zip the extension for the stores |
| `pnpm extension:build:fixtures` | the extension with sample data and no network, for screenshots |
| `pnpm next:dev` / `next:build` / `next:serve` | the demo dapp |
| `pnpm harness` | the rules; must pass before every commit |
| `pnpm check-types`, `pnpm build`, `pnpm lint` | types, both builds, lint |
| `pnpm wallet:identity`, `wallet:listings`, `wallet:mainnet-check` | identity, listing drafts, what blocks mainnet |
| `pnpm verify:provenance` | checks the kit packages were built by the kit's CI from its public repository |

## How it relates to the monorepo

The template isn't a workspace of the monorepo: it is its own pnpm workspace that installs the kit packages from npm,
pinned to one exact version. In the monorepo, `node tools/release/sync-template.mjs` keeps its pins and its copy of the
harness in step, and `pnpm kit:e2e:scaffold-hbar` builds and tests it from packed tarballs.
