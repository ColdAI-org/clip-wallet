# Product spec

This project is **a non-custodial browser wallet with its own identity**, built on the Clip Wallet kit, and a
Scaffold-HBAR dapp that shows it working on Hedera testnet. Pre-release: **test networks only** until the owner
completes `packages/extension/MAINNET.md`.

## Principles (from the kit)

1. **Non-custodial.** Keys are derived and used only inside the extension's background (`@clip-wallet/vault`). Nothing
   leaves the device; no server can move, freeze or recover funds. Recovery is the phrase or a passkey-wrapped backup.
2. **Every request is understood before it is approved.** Each dapp request becomes a decoded request (title, lines,
   balance changes, fee, warnings). Undecodable requests are blind signing, off by default.
3. **Networks are invisible** in the default UI: assets and apps, not chains. The network appears only where a mistake
   loses money (an address valid on several networks, a bridged-only token, Advanced mode).
4. **A security floor.** Open phishing lists, look-alike and new-contract checks, permission review and revoke, and
   spam cleanup are always on. Blockaid scanning is optional (a key).
5. **Testnet by default.** Mainnet needs the owner's checklist; the build and the harness enforce it.

## What the wallet maker controls

| Area | Where | Notes |
| --- | --- | --- |
| Identity | `wallet.identity.json` | name, description, rdns, homepage, icon, extension key; `pnpm wallet:identity` |
| Look | `clip.config.ts` `theme` + icon files | accent contrast ≥ 3:1 |
| Networks | `clip.config.ts` `networks` | 14 families: EVM, Hedera, Solana, Bitcoin, Sui, Aptos, Cardano, Polkadot SDK, Starknet, TON, NEAR, Stellar, Tezos, Algorand |
| Routing | `clip.config.ts` `route` | mode, filters, settle-on-Hedera quotes |
| Features | `.env` partner keys | swaps, on-ramps, prices; staking needs none |
| Social | `clip.config.ts` `services.clipHandles` | contacts, notifications, Discover need nothing |
| Plugins | nothing | users opt in (Advanced mode); SES sandbox |
| Hosted services | `clip.config.ts` `services` | backup, NFT media proxy; unset = hidden |
| Hardware | `clip.config.ts` `hardware` | Ledger (WebHID), Keystone (QR) |
| Mainnet | `MAINNET.md` → `clip.config.ts` `mainnet` | the owner only |

What it doesn't control: the vault, the approval path, the security floor. They come from the pinned, signed kit.

## 1Mask: one wallet for every dapp

The extension answers each family's own wallet standard with this wallet's identity: EIP-1193 + EIP-6963 (rdns), the
Solana/Sui/Bitcoin Wallet Standard, AIP-62 (Aptos), CIP-30 (Cardano), injectedWeb3 (Polkadot), get-starknet, TON
Connect (bridge key from the name), `window.<key>.{near,stellar,algorand}` (NEAR Connect, SEP-43, ARC-1), the Tezos
Beacon relay, and WalletConnect v2 with the wallet's own project id.

## The dapp

Next.js (Scaffold-HBAR) on Hedera testnet (296): connect through EIP-6963, sign, send HBAR, and the debug page with
Hedera's PRNG and exchange-rate system contracts.
