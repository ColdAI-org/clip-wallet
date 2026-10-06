<div align="center">

# Scaffold-HBAR × Clip Wallet

**Your own non-custodial wallet, plus a Hedera dapp that connects to it. One command.**

A [Scaffold-HBAR](https://github.com/hedera-dev/scaffold-hbar) template by [ColdAI](https://coldai.org), built on the
[Clip Wallet kit](https://github.com/ColdAI-org/clip-wallet).

[![CI](https://github.com/ColdAI-org/scaffold-hbar-clip-wallet/actions/workflows/ci.yaml/badge.svg)](https://github.com/ColdAI-org/scaffold-hbar-clip-wallet/actions/workflows/ci.yaml)
[![Fresh scaffold](https://github.com/ColdAI-org/scaffold-hbar-clip-wallet/actions/workflows/fresh-scaffold.yaml/badge.svg)](https://github.com/ColdAI-org/scaffold-hbar-clip-wallet/actions/workflows/fresh-scaffold.yaml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENCE)
[![Hedera testnet](https://img.shields.io/badge/Hedera-testnet-8259EF?logo=hedera)](#the-demo-dapp)
[![npm provenance](https://img.shields.io/badge/npm-provenance-2ea043)](#signed-versioned-kit)

</div>

```bash
npm create scaffold-hbar@latest -- --template ColdAI-org/scaffold-hbar-clip-wallet
# or, the same project in one step:
npx create-clip-wallet my-wallet
```

---

## What you get

| | | |
|---|---|---|
| 🧩 | **A real wallet, under your name** | A Manifest V3 browser extension with its own name, icon, extension id, EIP-6963 rdns and WalletConnect project. It never announces itself as Clip Wallet. |
| 🌐 | **14 network families** | EVM (any chain id), Hedera, Solana, Bitcoin, Sui, Aptos, Cardano, Polkadot SDK, Starknet, TON, NEAR, Stellar, Tezos, Algorand. Turn them on and off in `clip.config.ts`. |
| 🔌 | **1Mask: every dapp works** | EIP-1193 + EIP-6963, Wallet Standard, AIP-62, CIP-30, injectedWeb3, get-starknet, TON Connect, NEAR Connect, SEP-43, Beacon and WalletConnect, all announced with your identity. |
| 🧾 | **Every request in plain words** | Each dapp request is decoded before approval (balance changes, fee, warnings); blind signing is off by default. |
| 🛡️ | **A security floor you can't switch off** | Open phishing lists, address-poisoning and new-contract checks, permission review and revoke, spam cleanup. Blockaid scanning when you add a key. |
| ✨ | **Features, social, plugins, settle** | Staking and swaps per family, on-ramps, Secure Trade on Hedera, contacts and Clip handles, notifications, Discover, sandboxed Clip Plugins, route-and-fund and settle-on-Hedera quotes on CLPRouter. |
| 🧪 | **A Scaffold-HBAR dapp** | Next.js on Hedera testnet: connect your wallet through 1Mask, sign, send HBAR, and call Hedera system contracts from the debug page. |
| 🔏 | **Testnet by default** | Mainnet needs a checklist a person ticks (`packages/extension/MAINNET.md`); the build and the harness refuse it otherwise. |
| 🤖 | **Agent-friendly** | `AGENTS.md` recipes, `llms.txt`, a typed `clip.config.ts`, and `pnpm harness` validators an agent must pass. |

## Quick start

Prerequisites: Node **22+**, [pnpm](https://pnpm.io) **10+**, Git, Chrome or another Chromium browser.

```bash
npm create scaffold-hbar@latest -- --template ColdAI-org/scaffold-hbar-clip-wallet
cd <your-project>
pnpm install
pnpm wallet:identity --name "Acme Wallet" --rdns com.acme.wallet     # your identity (see below)
pnpm extension:build                                                  # → packages/extension/.output/chrome-mv3
pnpm next:dev                                                         # → http://localhost:3000
```

Load `packages/extension/.output/chrome-mv3` with **Load unpacked** in `chrome://extensions` (Developer mode on),
create a wallet in it, get testnet HBAR from the [faucet](https://portal.hedera.com/faucet), and open the dapp.

This template manages its own package manager (pnpm), so create-scaffold-hbar skips the install step and prints these
commands. `npx create-clip-wallet my-wallet` does the copy and the identity step in one go and asks for anything you
don't pass as flags; both produce the same project.

## Your wallet's identity

`pnpm wallet:identity` (or `create-clip-wallet`) gives the wallet everything that makes it yours:

| | Where | |
|---|---|---|
| Name, description, homepage | `packages/extension/wallet.identity.json` | Manifest, wallet pickers, WalletConnect metadata |
| EIP-6963 rdns | same file | A reverse domain you own; dapps and wallet lists key on it |
| Extension id | `extension.key` in the same file | An RSA public key that fixes the Chrome extension id; the private key goes to `packages/extension/.keys/extension.pem` (gitignored, 0600) |
| Icon | `packages/extension/icon.svg`, `public/icon/*.png` | A starter mark in your accent colour; replace with your art (`--icon logo.svg`) |
| WalletConnect project id | `packages/extension/.env`, `packages/nextjs/.env.local` | `--walletconnect-project-id`; never committed |
| Window global, TON Connect key | derived from the name | `window.acmewallet.near`, TON Connect `acmewallet` |
| Listing drafts | `docs/listings/` | TON Connect, NEAR, Stellar Wallets Kit, Beacon, use-wallet, WalletConnect Explorer, EIP-6963 |

```bash
pnpm wallet:identity --name "Acme Wallet" --rdns com.acme.wallet --homepage https://wallet.acme.com \
  --accent "#0B7A3B" --icon ./acme.svg --walletconnect-project-id <32 hex>
pnpm wallet:listings           # regenerate docs/listings after an identity change
```

Running it again keeps the extension key (and so the id) unless you pass `--new-key`.

## The demo dapp

`packages/nextjs` is Scaffold-HBAR's Next.js app on Hedera testnet (chain 296):

| Page | What it shows |
|---|---|
| `/` | Finds your wallet by its EIP-6963 rdns, connects, signs a sign-in message (verified in the page), sends 0.1 HBAR to yourself with a HashScan link |
| `/clip-connect` | Clip Connect (`@clip-wallet/connect`): one connect for your wallet or any other, accounts as CAIP-10, what the wallet can do (EIP-5792), balances by asset, and `pay()` that uses auxiliary funds (ERC-7682) when the wallet has them |
| `/debug` | Scaffold-HBAR's contract debugger, with Hedera's PRNG (`0x169`) and exchange-rate (`0x168`) system contracts |

Every request opens your wallet's approval window, decoded in plain words. The header's **Connect Wallet** (RainbowKit)
lists your wallet next to MetaMask and WalletConnect.

## Commands

| Command | |
|---|---|
| `pnpm extension:build` / `extension:dev` / `extension:zip` | Build, watch, or zip the extension for the stores |
| `pnpm extension:build:fixtures` | The extension with sample data and no network, for screenshots |
| `pnpm next:dev` / `next:build` / `next:serve` | The demo dapp |
| `pnpm harness` | The rules (below). Must pass before every commit |
| `pnpm check-types` · `pnpm build` · `pnpm lint` | Types, both builds, lint |
| `pnpm wallet:identity` · `wallet:listings` · `wallet:mainnet-check` | Identity, listing drafts, what blocks mainnet |
| `pnpm verify:provenance` | Check the kit packages were built by the kit's CI from its public repo |

## The rules (`pnpm harness`)

`tools/harness/check.mjs` (Node built-ins only) fails with `file:line` and a plain sentence when:

- key material is handled outside `@clip-wallet/vault`, a secret is logged, a recovery phrase is committed, or a `.env`
  or key file is tracked by git;
- the wallet announces Clip Wallet's identity (`org.coldai.*` or the name "Clip Wallet");
- `wxt.config.ts` stops building through `clipWallet()`, or anything switches the phishing lists off;
- mainnet is on while `packages/extension/MAINNET.md` has an open box;
- a kit package isn't pinned to one exact version.

It warns while the template's placeholder identity is still in place.

## Signed, versioned kit

The wallet itself is `@clip-wallet/extension-kit` and the `@clip-wallet/*` packages it depends on, all released together
with one version and published by the kit's CI with **npm provenance** (Sigstore-signed, traceable to the commit and
workflow). This project pins that version exactly (the harness insists); `pnpm verify:provenance` checks every package's
attestation against `github.com/ColdAI-org/clip-wallet`, and `npm audit signatures` verifies the signatures in an npm
install. Upgrading is a deliberate change: bump the pin in `packages/extension/package.json` and the root
`create-clip-wallet`, read the kit's changelog, run `pnpm install && pnpm verify:provenance && pnpm harness && pnpm build`.

## Testnet first

Everything runs on test networks. `packages/extension/MAINNET.md` lists what a person must do first (own rdns and
homepage, the extension key backed up and matching the store item, your own WalletConnect project, production services,
an independent review of your changes, usability tests, support and security contacts). The build and the harness both
refuse a mainnet config while a box is open, and the build also until `pnpm wallet:mainnet-check` is clean.

## Project layout

```
packages/extension/            your wallet: wallet.identity.json, clip.config.ts, icon, one-line WXT entrypoints
packages/nextjs/               the Scaffold-HBAR dapp: demo page, /debug, Hedera testnet
docs/listings/                 listing-submission drafts for your identity
tools/harness/check.mjs        the rules above
tools/verify-provenance.mjs    provenance check for the kit packages
.harness/                      spec, PRD and hedera-harness validators for coding agents
AGENTS.md · llms.txt           how agents (and people) change this project safely
```

## For coding agents

[AGENTS.md](AGENTS.md) is written for Claude Code, Codex, Cursor and friends: the rules that never break, the commands
that must pass, and recipes for identity, networks, tokens, routing and settle-on-Hedera, features, security, social,
plugins and the dapp. [`.harness/`](.harness/README.md) holds the spec, the PRD and a hedera-harness recipe with
validators.

## License

Apache-2.0, see [LICENCE](LICENCE) and [NOTICE](NOTICE). Created by [ColdAI](https://coldai.org). The dapp
(`packages/nextjs`) builds on Scaffold-HBAR (hedera-dev) and Scaffold-ETH 2 (BuidlGuidl) and keeps their MIT licence
([`packages/nextjs/LICENSE`](packages/nextjs/LICENSE)); the wallet is the Clip Wallet kit. "Clip Wallet", "1Mask" and
the Clip Wallet logo are ColdAI trademarks and aren't licensed: your wallet uses its own name and icon.
