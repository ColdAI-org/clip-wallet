<p align="center">
  <a href="https://coldai.org">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/coldai-logo-white.png">
      <img alt="ColdAI" src=".github/assets/coldai-logo-dark.png" width="96">
    </picture>
  </a>
</p>

<p align="center">
  <img alt="Clip Wallet" src="brand/clip-mark.svg" width="88">
</p>

<h1 align="center">Clip Wallet</h1>

<p align="center">
  <strong>A calm, non-custodial wallet for every CLPR network.</strong><br>
  One recovery phrase, one balance, and plain words before you sign anything.<br>
  Browser extension and iOS/Android app. Fourteen network families. Networks stay out of your way.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-black"></a>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white">
  <img alt="Manifest V3" src="https://img.shields.io/badge/extension-MV3%20%C2%B7%20Chrome%20%C2%B7%20Edge%20%C2%B7%20Firefox-555">
  <img alt="Expo" src="https://img.shields.io/badge/mobile-Expo%2057%20%C2%B7%20iOS%20%C2%B7%20Android-000?logo=expo">
  <img alt="Built on CLPR" src="https://img.shields.io/badge/built%20on-CLPR%20(LF%20Decentralized%20Trust)-FF3C00">
  <img alt="Status" src="https://img.shields.io/badge/status-pre--release%20%C2%B7%20testnets%20only-orange">
  <a href=".github/workflows/repro.yml"><img alt="Reproducible build" src="https://img.shields.io/badge/build-reproducible-2ea043"></a>
</p>

---

> **Pre-release. Test networks only.** Test tokens have no value. Clip Wallet has not had an external security
> audit. Don't use it with real funds.

## What it is

Most wallets make you think like a blockchain: pick a network, check a chain id, wonder why your USDC "is on the
wrong one". Clip Wallet speaks in **assets and apps** instead. It holds one recovery phrase for fourteen families
of networks, shows one balance per asset, decodes every request into plain words, and only mentions a network
where getting it wrong would lose money.

It is built on [CLPR](https://github.com/LFDT-CLPR), the bridgeless cross-ledger protocol from LF Decentralized
Trust, and on [CLPRouter](https://github.com/ColdAI-org/clprouter): when an app asks for money you hold somewhere
else, the wallet offers a route to fund it.

<p align="center">
  <img alt="Home: one balance across networks" src="apps/extension/store/screenshots/01-home.png" width="49%">
  <img alt="A payment request decoded into plain words" src="apps/extension/store/screenshots/02-approval.png" width="49%">
</p>
<p align="center">
  <img alt="The network question, asked only when it matters" src="apps/extension/store/screenshots/03-send.png" width="49%">
  <img alt="Scam protection sources, checked on the device" src="apps/extension/store/screenshots/05-security.png" width="49%">
</p>

## Networks are invisible

The one design rule everything else follows ([`.harness/spec.md`](.harness/spec.md)):

| You see | You don't see |
|---|---|
| "Pay 25 USDC", "Swap on Uniswap" | "Base Sepolia", chain ids, RPCs |
| **USDC $412**: one row, merged across every network the same issuer runs on | Five USDC rows, one per chain (bridged copies never merge; they stay separate and labelled) |
| A small network chip **only** where a mistake loses money: an address valid on several networks, a bridged-only token, Advanced mode | Network pickers on every screen |
| "Where should the USDC arrive?", asked once per address and remembered | A send that silently picks a chain |

`pnpm harness` fails a change that hard-codes a network name into a default screen.

## Features

- **Fourteen network families, one phrase:** EVM (Ethereum, Base, Arbitrum, Optimism, Hedera EVM and more by chain
  id), Hedera, Solana, Bitcoin, Sui, Aptos, Cardano, Polkadot/Substrate, Starknet, TON, NEAR, Stellar, Tezos,
  Algorand.
- **Every request decoded:** title, balance changes, fee, time and warnings. Unlimited approvals and permits are
  called out. Requests the wallet can't read are **blocked by default** (no blind signing).
- **1Mask, one connector for every dapp:** EIP-1193 + EIP-6963, Solana and Sui Wallet Standard, Bitcoin (PSBT),
  Hedera, Cardano CIP-30, Polkadot, Starknet, TON Connect, NEAR, Stellar (SEP-43), Tezos (Beacon), Algorand, and
  WalletConnect v2. Modules for NEAR Wallet Selector, Stellar Wallets Kit and use-wallet in
  [`packages/kit-modules`](packages/kit-modules).
- **Security:** scam lists checked on the device (MetaMask, ScamSniffer, Phantom, polkadot-js lists), optional
  Blockaid scanning, look-alike address warnings, App permissions (see and revoke token approvals), spam cleanup.
- **Swap, stake, buy, Secure Trade (P2P):** each ends in the same approval screen.
- **Route and fund** on CLPRouter: shortfall detection, quotes with fee, p90 time, emissions and the weakest
  verification on the route.
- **Unlock and backup:** password (Argon2id), passkey unlock (WebAuthn PRF), Face ID / fingerprint on mobile,
  optional passkey backup that the server can't open, Ledger (USB/Bluetooth) and Keystone (QR).
- **Clip Plugins** (Advanced mode, off by default): SES-sandboxed transaction insights, name resolution and
  notifications, installed from npm with integrity checks.
- **12 languages**, right-to-left Arabic included, with translation QA tests (ICU, glossary, bidi isolation).
- **Your data, in the app:** Settings → Your data says exactly what stays on the device and what goes where.
- **Rebrandable:** one `clip.config.ts` (name, icon, accent, networks, routing defaults); `create-clip-wallet`
  scaffolds a branded copy.

## Architecture

```mermaid
flowchart LR
    subgraph Page["Web page (dapp)"]
        D["dapp code"] -- "EIP-1193 / Wallet Standard / …" --> IP["1Mask inpage providers"]
    end
    subgraph Ext["Extension"]
        CS["content script<br/>(adds the origin, checks schema and size)"]
        subgraph BG["background (service worker)"]
            R["1Mask router"] --> E["engine"]
            E --> CM["chain modules<br/>packages/chains-*"]
            E --> S["security checks<br/>scam lists · Blockaid (opt.)"]
            E --> V[("vault<br/>packages/vault<br/>only place keys exist")]
        end
        UI["popup / approval window<br/>packages/ui"]
    end
    IP -- "window.postMessage" --> CS -- "runtime port" --> R
    E -- "DecodedRequest" --> UI -- "approve / reject" --> E
    CM -- "RPC, indexers" --> N[("networks")]
```

Every request takes the same path, whichever connector it came from:

```mermaid
sequenceDiagram
    autonumber
    participant App as dapp
    participant M as 1Mask
    participant C as ChainModule
    participant S as Security
    participant U as You (approval screen)
    participant V as Vault
    App->>M: request (e.g. eth_sendTransaction)
    M->>C: decode(request)
    C-->>M: DecodedRequest (title, balance changes, fee, warnings)
    M->>S: check site, addresses, approvals
    S-->>M: warnings
    M->>U: show it in plain words
    alt undecodable (blind)
        U-->>M: blocked by default
    else approved
        U->>M: approve
        M->>C: prepare → SignablePayload
        C->>V: sign (bound to this approval)
        V-->>C: signature
        C-->>App: finalize → tx hash / signature
    end
```

```mermaid
flowchart TB
    subgraph Device["Your device"]
        Vault["Vault: phrase + keys<br/>Argon2id → XChaCha20-Poly1305"]
        Data["contacts, settings, activity<br/>(encrypted app data)"]
    end
    subgraph Public["Public services (third parties)"]
        RPC["nodes and indexers<br/>(public addresses, signed txs)"]
        Prices["CoinGecko · DEX Screener"]
        Lists["scam lists (downloaded)"]
        Partners["swap / stake / buy providers<br/>(only when you use them)"]
    end
    subgraph ColdAI["ColdAI services (optional, Cloudflare)"]
        Backup["passkey backup<br/>ciphertext + HMAC(email) only"]
        Media["media proxy<br/>NFT images, no logs"]
    end
    Device --> Public
    Device -. "if you turn it on" .-> Backup
    Device --> Media
```

| Path | What |
|---|---|
| [`packages/core`](packages/core) | The contract: `ChainModule`, `DecodedRequest`, `AssetRef`, `ClipError` |
| [`packages/vault`](packages/vault) | Phrase, derivation, encryption, approval-bound signing, passkeys. The only package that touches keys |
| [`packages/1mask`](packages/1mask) | Dapp connectors for every family, the router, WalletConnect |
| [`packages/chains-*`](packages) | One `ChainModule` per family (14) |
| [`packages/engine`](packages/engine) | Wallet engine shared by the extension and the mobile app |
| [`packages/route`](packages/route) | Route and fund on CLPRouter |
| [`packages/security`](packages/security), [`features`](packages/features), [`social`](packages/social), [`plugins`](packages/plugins), [`hardware`](packages/hardware), [`names`](packages/names) | Scam checks, swap/stake/buy/trade, contacts and handles, Clip Plugins, Ledger/Keystone, name services |
| [`packages/ui`](packages/ui), [`packages/i18n`](packages/i18n) | React screens and theme tokens; translations |
| [`apps/extension`](apps/extension) | MV3 extension (WXT): Chrome, Edge, Firefox. Store kit in [`apps/extension/store`](apps/extension/store) |
| [`apps/mobile`](apps/mobile) | Expo app for iOS and Android |
| [`services/backup`](services/backup), [`services/media-proxy`](services/media-proxy) | Cloudflare Workers: passkey backup, sandboxed NFT media |
| [`brand/`](brand) | The Clip Wallet mark, wordmark and colour guidance |
| [`tools/harness`](tools/harness) | The rules coding agents and humans must pass (`pnpm harness`) |

## Quick start

Needs Node 24 and pnpm 12 (`corepack enable` or `npm i -g pnpm@12.6.0`).

```sh
git clone https://github.com/ColdAI-org/clip-wallet && cd clip-wallet
pnpm install
pnpm typecheck && pnpm test && pnpm harness      # what CI and AGENTS.md require

pnpm --filter @clip-wallet/extension dev          # Chrome with the extension loaded (WXT)
pnpm --filter @clip-wallet/extension e2e          # Playwright: real build + fixture build
pnpm --filter @clip-wallet/extension package      # store zips, SHA256SUMS (apps/extension/release/)
cd apps/mobile && pnpm ios                        # or pnpm android (dev build; see apps/mobile/README.md)
```

### Your own wallet from the kit

Everything a wallet maker changes is one file ([`AGENTS.md`](AGENTS.md) → "Rebrand"):

```ts
// apps/extension/clip.config.ts
export default defineConfig({
  name: "My Wallet",
  rdns: "com.example.wallet",          // a reverse domain you own
  icon: "./icon.svg",
  theme: { accent: "#4F46E5" },        // text on accent must reach 3:1; small accent text is derived to 4.5:1
  networks: ["evm:*", "hedera", "solana"],
  mainnet: false,
});
```

Or scaffold a separate copy: `npx create-clip-wallet my-wallet` (experimental,
[`packages/create-clip-wallet`](packages/create-clip-wallet)).

### With a Scaffold-HBAR dapp

[Scaffold-HBAR](https://github.com/hedera-dev/scaffold-hbar) apps connect through RainbowKit/wagmi, which find
Clip Wallet through EIP-6963. Nothing to install in the dapp:

```sh
npm create scaffold-hbar@latest my-dapp && cd my-dapp
yarn install
yarn next:dev                                     # http://localhost:3000; point the app at Hedera testnet (EVM chain 296)
```

With Clip Wallet loaded in the same browser, choose **Clip Wallet** in the connect dialog. Requests to Hedera's
EVM (chain 296, through the Hashio relay) are decoded and approved like any other; the HBAR balance shows once,
merged with the native Hedera account. Get test HBAR from the [Hedera portal faucet](https://portal.hedera.com).

## Security model

- **Non-custodial, one key holder.** Only `packages/vault` derives keys and signs; chain modules build and decode
  but never see keys; screens never import the vault. `pnpm harness` enforces all three.
- **At rest:** Argon2id (64 MiB, t=3) → XChaCha20-Poly1305 for the vault and app data. Passkey unlock wraps the
  vault key with HKDF over the WebAuthn PRF output. The password always keeps working.
- **Approval-bound signing:** the vault signs only the payload of the request the user approved.
- **No blind signing by default.** Undecodable requests are blocked; only in Advanced mode can you sign one, per request, after a warning.
- **Origins come from the browser, never the page:** the content script adds the origin; the page can't claim one.
- **Extension CSP:** `script-src 'self' 'wasm-unsafe-eval'` (WebAssembly for Argon2id only). Plugins run in the
  manifest sandbox page under SES with `connect-src 'none'`.
- **Supply chain:** every GitHub Action pinned by SHA, Dependabot, CodeQL, a reproducible extension build checked
  in CI, SLSA build provenance and SHA256SUMS on every release, signed tags.
- **Optional services see ciphertext and hashes only:** threat model in
  [`services/backup/README.md`](services/backup/README.md).

Report vulnerabilities privately: [SECURITY.md](SECURITY.md).

## Status

| Area | State |
|---|---|
| Extension (Chrome, Edge) | Feature-complete for testnets; unit, harness and Playwright e2e (real + fixture builds) green |
| Extension (Firefox) | Builds as MV3 and passes `addons-linter` with 0 errors; no Firefox e2e run yet; Clip Plugins left out (no offscreen/sandbox pages in Firefox) |
| Mobile (iOS, Android) | Screens and engine tested (vitest + jest-expo); no store builds yet (no EAS/signing set up), associated domain and site URL are placeholders |
| Networks | 14 families on testnets. **Mainnet is off** and gated behind a build flag and checklist |
| Passkey backup service | Deployed for testnet builds with email sign-in **off** (no provider key) and Google/Apple sign-in unconfigured |
| Store listings | Packages, listing copy, screenshots and permission justifications ready ([`apps/extension/store`](apps/extension/store)); **nothing submitted**. The passkey bridge origin in the manifest is a placeholder |
| Route and fund | Pay-on-Hedera planning on the CLPRouter testnet deployment; settle-on-Hedera orders are a planning helper only |
| Reproducible build | Extension zips byte-identical across two clean container builds on the same CPU architecture; `TREE-DIGESTS` compares across architectures |
| Security review | Internal review only. **No external audit** |
| Legal | Privacy policy and terms are **drafts awaiting legal review** ([`docs/legal`](docs/legal)) |

## Contributing

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) (DCO sign-off required) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Coding agents: start with [AGENTS.md](AGENTS.md) and [llms.txt](llms.txt).
Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © 2026 ColdAI. "Clip Wallet" and the Clip Wallet mark are ColdAI's; see [brand/README.md](brand/README.md)
before using them in a fork. Inter (the wordmark's typeface) is © The Inter Project Authors, SIL Open Font License 1.1.

<p align="center">
  <br>
  <a href="https://coldai.org">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/coldai-logo-white.png">
      <img alt="ColdAI" src=".github/assets/coldai-logo-dark.png" width="40">
    </picture>
  </a>
  <br>
  <sub>Built by <a href="https://coldai.org">ColdAI</a></sub>
</p>
