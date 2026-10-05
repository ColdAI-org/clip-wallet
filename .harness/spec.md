# Clip Wallet: product spec

Clip Wallet is a **non-custodial** wallet for every CLPR network. One recovery phrase, one set of accounts across
14 network families, and money that moves to wherever an app needs it. It is also a **kit**: anyone can ship a wallet
of their own on the same packages. Pre-release: **test networks only**.

## Principles

1. **Networks are invisible.** The default UI speaks in assets and apps: "Pay 25 USDC", "Swap on Uniswap", not
   "Base Sepolia". Balances of the same asset merge across networks (same issuer only; bridged copies never merge). The
   network appears only where a mistake loses money: an address valid on several networks, a token that exists only as
   a bridged copy, and Advanced mode. It shows as a small network chip.
2. **Non-custodial.** Keys are derived and used only in `packages/vault`, inside the extension (or mobile) background.
   Nothing leaves the device. No server can move, freeze or recover funds. Recovery is the phrase or a passkey-wrapped
   backup; nobody can reset anything.
3. **Every request is understood before it is approved.** Each dapp request is decoded into a `DecodedRequest` (title,
   lines, balance changes, fee, warnings), then refined by the security checks. Undecodable requests are blind signing,
   off by default.
4. **A security floor.** The open phishing lists, look-alike and address-poisoning checks, new-contract cautions and
   decode-before-approve are always on. Nothing configures them away; a mainnet config below the floor is refused.
5. **Testnet by default.** Mainnet needs the checklist object in `clip.config.ts`; a mainnet build also needs its own
   identity, homepage, extension key and WalletConnect project id (`mainnetProblems`).

## Network families

| Family | Test networks | Curve | Dapp standard (1Mask) |
| --- | --- | --- | --- |
| EVM | Sepolia, Base Sepolia, Arbitrum Sepolia, OP Sepolia, Arc Testnet, Hedera EVM, others by chain id | secp256k1 | EIP-1193 + EIP-6963 |
| Hedera | Hedera Testnet | secp256k1 (ECDSA alias) / ed25519 | Hedera wallet interface, WalletConnect |
| Solana | Devnet | ed25519 | Wallet Standard |
| Bitcoin | Testnet4 | secp256k1 (segwit, taproot) | Wallet Standard (sats-connect style PSBT) |
| Sui | Testnet | ed25519 | Wallet Standard |
| Aptos | Testnet | ed25519 | AIP-62 |
| Cardano | Preprod, Preview | ed25519 (BIP32-Ed25519) | CIP-30 |
| Polkadot SDK | Westend, Paseo and their Asset Hubs | sr25519 | injectedWeb3 |
| Starknet | Sepolia | Stark curve | get-starknet |
| TON | Testnet | ed25519 (wallet v5r1) | TON Connect (JS bridge) |
| NEAR | Testnet | ed25519 | NEAR Connect, Wallet Selector module |
| Stellar | Testnet | ed25519 | SEP-43 |
| Tezos | Shadownet | ed25519 | Beacon (TZIP-10) |
| Algorand | TestNet | ed25519 (ARC-52) | ARC-1 / use-wallet |

Each family is one `ChainModule` (`packages/chains-*`), implementing the contract in `packages/core/src/index.ts`.
Chain modules build and decode; the vault signs `SignablePayload`s; chain modules never see keys. WalletConnect v2 covers
mobile and desktop dapps for every family it supports, with the wallet's own project id.

## Unlock and recovery

Password (Argon2id) by default. **Passkey unlock**: a passkey with the WebAuthn PRF extension wraps the vault key.
**Passkey backup** (optional service): an encrypted blob only the passkey opens, found again by email or Google/Apple
sign-in that can't open it. Hardware accounts: Ledger (WebHID) and Keystone (QR), every signature checked against the
exact bytes approved.

## Features

Staking for every family that has it (Hedera, Solana, Cardano, Polkadot pools, NEAR, Tezos, Sui, Aptos, TON liquid
staking), swaps per family (0x, Jupiter, SaucerSwap, Minswap, STON.fi, Ref, AVNU, Aftermath, Hyperion, Sirius, Tinyman,
Stellar DEX, Asset Hub), on-ramps (MoonPay, Banxa, C14), Secure Trade (Hedera P2P atomic swaps), prices, Explore and LP
positions. Every action ends in a normal approval. Partner keys come from the build environment; without one the feature
says it isn't switched on.

## Security

Settings → Security: app permissions across EVM, Solana and Hedera with one-tap revoke; scam detection (open lists from
MetaMask, ScamSniffer, Phantom and PolkadotJS; local heuristics; optional Blockaid, off unless a key is set); spam
cleanup that gives rent back. What leaves the device is listed for every source.

## Social

Contacts (address book), Clip handles on Hedera (`contracts/handles`), notifications (permission asked only when turned
on) and Discover (market data for what you hold or watch). Names: ENS, SNS, HNS and Clip handles resolve in Send.

## Clip Plugins

Small extensions in the spirit of MetaMask Snaps, narrower and safety-first: off unless Advanced mode and the plugin
switch are on; installed from npm with integrity checks; each runs under SES in an MV3 sandbox page hosted by an
offscreen document. Plugins can add transaction insights, name resolution, notifications and up to three https origins.
They can never sign, see keys or reach storage.

## Route, fund and settle

When a request needs money the user holds elsewhere, the wallet finds the shortfall and offers a route
(`packages/route`, CLPRouter): fee as an asset amount, p90 time, emissions, the weakest verification on the route, and
the steps in plain words. Phase 1 pays on Hedera from EVM balances. **Settle on Hedera** (Phase 3,
`route.settleOnHedera`): bonded Connectors quote, the user deposits, delivery is proven over CLPR to an order book on
Hedera, and a missed deadline is paid from the Connector's bond. Routes that rely on test verifiers are refused outside
test networks.

## The kit

Everything a wallet maker changes is identity and configuration:

- `@clip-wallet/*` packages (one version, built to `dist/`, published only by CI with npm provenance);
- `@clip-wallet/extension-kit`: the whole extension as a library, built by `clipWallet({ config })` for WXT, with no
  switch for the security floor and a build-time mainnet checklist;
- `create-clip-wallet` and the Scaffold-HBAR template (`templates/scaffold-hbar-clip-wallet`,
  `npm create scaffold-hbar@latest -- --template ColdAI-org/scaffold-hbar-clip-wallet`), which produce the same project:
  the wallet extension with its own name, icon, extension id, EIP-6963 rdns and WalletConnect project, plus a Next.js
  dapp on Hedera testnet;
- listing-submission drafts for the new identity (TON Connect, NEAR, Stellar Wallets Kit, Beacon, use-wallet,
  WalletConnect Explorer, EIP-6963);
- agent tooling in every project: `AGENTS.md`, `llms.txt`, `.harness/`, `pnpm harness`.

## Out of scope today

Mainnet, settle-on-Hedera deployments, account abstraction.
