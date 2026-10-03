# Clip Wallet: product spec

Clip Wallet is a **non-custodial** browser wallet for every CLPR network. One recovery phrase, one set of
accounts, and money that moves to wherever an app needs it. Pre-release: **test networks only**.

## Principles

1. **Networks are invisible.** The default UI speaks in assets and apps: "Pay 25 USDC", "Swap on Uniswap",
   not "Base Sepolia". Balances of the same asset merge across networks (same issuer only; bridged copies never
   merge). The network appears only where a mistake loses money: sending to an address valid on several networks,
   a token that exists only as a bridged copy, and Advanced mode. It shows as a small network chip.
2. **Non-custodial.** Keys are derived and used only in `packages/vault`, inside the extension background. Nothing
   leaves the device. No server can move, freeze or recover funds. Recovery is the phrase or a passkey-wrapped
   backup; we cannot reset anything.
3. **Every request is understood before it is approved.** Each dapp request is decoded into a `DecodedRequest`
   (title, lines, balance changes, fee, warnings). Undecodable requests are blind signing, off by default.
4. **Testnet by default.** Mainnet needs an explicit build flag and the checklist in `clip.config.ts`.

## 1Mask: one wallet for every dapp

`packages/1mask` injects one provider per family so existing dapps work unchanged: EIP-1193 + EIP-6963 for
EVM, the Solana Wallet Standard, a Bitcoin provider (sats-connect style PSBT signing) and the Hedera wallet
interface, plus WalletConnect v2 for mobile and desktop dapps. Every request from every connector goes through
the same decode-and-approve path. A compatibility mode can announce Clip Wallet under a generic name for dapps
that allow-list wallets.

## Phase 1 network families

| Family | Networks (testnet) | Curve | Notes |
| --- | --- | --- | --- |
| EVM | Sepolia, Base Sepolia, Hedera EVM, others by chain id | secp256k1 | one address everywhere, so sends show "network matters" |
| Hedera | Hedera testnet | secp256k1 (ECDSA alias) / ed25519 | account id 0.0.x created on first receive |
| Solana | devnet / testnet | ed25519 | Wallet Standard |
| Bitcoin | testnet4 / signet | secp256k1 (segwit, taproot) | PSBT signing |

Each family is one `ChainModule` (`packages/chains-*`), implementing the contract in `packages/core/src/index.ts`.
Chain modules build and decode; the vault signs `SignablePayload`s; chain modules never see keys.

## Unlock

Password (Argon2id) by default. **Passkey unlock**: a passkey with the WebAuthn PRF extension wraps the vault
key, so the user unlocks with Touch ID / Windows Hello / a security key. The phrase is still the root of recovery
and is shown once during onboarding.

## Route and fund

When a request needs money the user holds elsewhere, the wallet finds the shortfall and offers a route
(`packages/route`, built on CLPRouter): fee as an asset amount, p90 time, emissions, the weakest verification on
the route, and the steps in plain words. Phase 1 pays on Hedera from EVM balances (CLPR proofs run chain →
Hedera). Phase 3 settles anywhere through bonded Connectors, with orders proven on Hedera and missed deadlines
paid from the bond. Routes that rely on test verifiers are refused outside test networks.

## Rebrandable

Everything a wallet maker changes lives in `clip.config.ts` (`@clip-wallet/config`): name, icon, rdns, theme,
networks, routing defaults, hardware wallets, WalletConnect, passkeys, mainnet. `create-clip-wallet` scaffolds a
branded copy (experimental).

## Out of scope for Phase 1

Mainnet, fiat on-ramps, swaps inside the wallet, mobile apps, account abstraction, settle-on-Hedera orders.
