# AGENTS.md: Clip Wallet

Clip Wallet is a non-custodial wallet for every CLPR network: 14 network families, 1Mask for every dapp, decoded
approvals, a security floor, features (staking, swaps, on-ramps, Secure Trade), social (contacts, Clip handles,
notifications, Discover), sandboxed Clip Plugins, and route-and-fund / settle-on-Hedera on CLPRouter. It is also a
kit: the `@clip-wallet/*` packages, `@clip-wallet/extension-kit` and `create-clip-wallet` let anyone ship their own
wallet. Pre-release: test networks only.

## Rules that never break
1. Only `packages/vault` touches seed phrases or private keys. `tools/harness/check.mjs` fails otherwise.
2. Chain modules (`packages/chains-*`) implement `ChainModule` from `@clip-wallet/core` and never import the vault.
3. Every dapp request becomes a `DecodedRequest` before approval. Undecodable = blind signing, off by default.
4. Networks are invisible in the default UI: speak in assets and apps; show the network only where a mistake loses money.
5. Never log, print or commit key material, phrases, API keys, `.env` values or key files (`*.pem`, `.keys/`). Tests use the public BIP-39 test vectors only.
6. Testnet by default. Mainnet needs the checklist object in `clip.config.ts`, and a mainnet build needs everything `mainnetProblems()` asks for.
7. The security floor is not configurable: open phishing lists on, decode-before-approve, new-contract and look-alike checks. `@clip-wallet/security` refuses a mainnet config below it.
8. Kit-built wallets announce their own identity. Nothing in the kit may hard-code "Clip Wallet" or `org.coldai.clipwallet` where a wallet's name or rdns belongs: read `config.name` / identity.
9. Published packages build from `src/` to `dist/` and are only released by CI (changesets + npm provenance). Never `npm publish` or `pnpm publish` by hand.

## Commands that must pass
```bash
pnpm install && pnpm typecheck && pnpm test && pnpm harness
```
Touching the extension: also `pnpm --filter @clip-wallet/extension e2e`. Touching packaging, `create-clip-wallet` or
`templates/`: also `pnpm pack-all && pnpm kit:e2e` (and `pnpm kit:e2e:scaffold-hbar` for the template).

## Layout
```
packages/core            shared types (the contract); additive changes only
packages/config          clip.config.ts schema (zod): identity, theme, networks, route, services, mainnet
packages/vault           phrase, derivation for 14 families, encryption, approval-bound signing, passkey unlock
packages/chains-*        evm hedera solana bitcoin sui aptos cardano substrate starknet ton near stellar tezos algorand
packages/1mask           dapp connectors for all families + WalletConnect; announces the wallet's identity
packages/engine          environment-free orchestration (approvals, portfolio, catalog, wiring) shared by extension and mobile
packages/extension-kit   the browser extension as a library: background, pages, WXT config (clipWallet()), security floor
packages/ui              React screens and theme tokens
packages/i18n            translation layer (English + 11 languages)
packages/route           CLPRouter route-and-fund; settle-on-Hedera (Phase 3) client
packages/security        phishing lists, approvals review/revoke, spam cleanup, security floor
packages/features        staking, swaps, on-ramps, Secure Trade, prices, Explore
packages/social          contacts, Clip handles, notifications, Discover
packages/plugins         Clip Plugins: SES sandbox, npm install with integrity checks
packages/hardware        Ledger (WebHID) and Keystone (QR)
packages/names           ENS, SNS, HNS, Clip handles
packages/kit-modules     modules for ecosystem pickers (NEAR Wallet Selector, Stellar Wallets Kit, use-wallet, Beacon)
packages/backup-client, packages/media-client   clients for services/backup and services/media-proxy
packages/create-clip-wallet   npx create-clip-wallet: the template + identity + listing drafts + mainnet check
apps/extension           Clip Wallet's own extension: identity + one-line entrypoints on extension-kit (e2e lives here)
apps/mobile              Expo app on engine
services/backup, services/media-proxy   Cloudflare Workers (optional hosted services)
contracts/handles        ClipHandles on Hedera (Foundry)
templates/scaffold-hbar-clip-wallet     the Scaffold-HBAR template (ColdAI-org/scaffold-hbar-clip-wallet); not a workspace
tools/harness            validators coding agents must pass
tools/release            build-package, manifests, pack-all, template sync
tools/kit                end-to-end checks of the kit from packed tarballs
```

## Recipes
Each ends with `pnpm typecheck && pnpm test && pnpm harness`. Product context: `.harness/spec.md`, `.harness/prd.md`; map: `llms.txt`.

### Rebrand Clip Wallet itself
1. `apps/extension/clip.config.ts` (schema and defaults in `packages/config/src/index.ts`): `name`, `description`, `rdns`,
   `homepage`, `icon`, `theme` (`accentText` contrast ≥ 3:1), `extension.key` (public key only).
2. The icon next to the config and in `apps/extension/public/icon/`; never a remote URL.
3. Screens read tokens only (`packages/ui/src/theme/tokens.ts`) and the name from config; never hard-code a colour or
   the product name in `packages/ui/src/screens/*`.

### Add or remove a network
1. `networks` in `clip.config.ts`: `"evm:*"`, `"evm:<chain id>"`, or a family name (see `NETWORK_FAMILIES` in `packages/config`).
2. New EVM chain: an `EvmNetworkSpec` in `packages/chains-evm/src/networks.ts` (testnet flag, RPC fallbacks, explorer,
   indexer) and a test in `packages/chains-evm/test/registry.test.ts`.
3. Other families: the family's `src/networks.ts` in `packages/chains-<family>`; the catalogue is `packages/engine/src/catalog.ts`.
4. Routable? Its Router in `packages/route/src/deployments.ts`, ledger and Channels in `packages/route/src/graph.ts`, with a fixture test.
5. A new family needs a chain module (below), a `Family` member in `packages/core/src/index.ts` (additive), a
   `NETWORK_FAMILIES` entry in `packages/config`, vault derivation in `packages/vault`, and a 1Mask provider.

### Add a token list
1. EVM: `CURATED_TOKENS` in `packages/chains-evm/src/tokens.ts` (chain id, address, symbol, decimals, shared `key` only for the same issuer).
2. Bridged copies get their own key and `bridged: true`; they never merge with the native asset.
3. Other families: the module's token/metadata file (e.g. `packages/chains-hedera/src/metadata.ts`).
4. Test that the token resolves and that a look-alike stays `spam`.

### Change routing defaults or settle-on-Hedera
1. Wallet-wide: `route.mode`, `route.filters` (`iso20022`, `mica`, `energy`, `trustFloor`, `maxHops`, `deadlineS`,
   `excludedJurisdictions`) and `route.settleOnHedera` in `clip.config.ts`; types in `packages/route/src/types.ts`.
2. Never allow test/stub verifiers outside testnet (`packages/route/src/safety.ts`).
3. Planner behaviour is the vendored CLPRouter SDK (`packages/route/src/vendor/clprouter-sdk`): change upstream and re-vendor.
4. Settle-on-Hedera deployments go in `SETTLE_DEPLOYMENTS` (`packages/route/src/settle.ts`); until then calls reject with `phase3`.

### Add a screen
1. `packages/ui/src/screens/<Name>.tsx`; state and actions from `packages/ui/src/context.tsx`, tokens from `packages/ui/src/theme`.
2. Register it in `packages/ui/src/App.tsx`; every string through the i18n layer (`packages/ui/src/i18n`, all 11 languages).
3. Screens never import `@clip-wallet/vault` (only `packages/ui/src/screens/Onboarding.tsx` may); ask the background through `packages/ui/src/client.ts`.
4. A render test in `packages/ui/test/screens.test.tsx`.

### Change the extension background
1. It lives in `packages/extension-kit/src/background/` (shared with every kit-built wallet); `apps/extension` only
   holds Clip Wallet's identity and one-line entrypoints.
2. Build-time values come from `clipWallet()` in `packages/extension-kit/src/wxt.ts` as `__CLIP_*__` globals
   (`src/globals.ts`); the resolved config is the `virtual:clip-wallet/config` module (`src/config.ts`).
3. Tests in `packages/extension-kit/test` (vitest aliases the virtual module to `test/clip.config.ts`); then `pnpm --filter @clip-wallet/extension e2e`.

### Security checks
1. A new threat source implements `ThreatIntelProvider` (`packages/security/src/threat/types.ts`); say in its comment exactly what leaves the device.
2. Anything that sends user data to a third party is off unless a key is configured, and Settings → Security says so.
3. Never add a switch that lowers the floor; `securityFloorProblems()` in `packages/security/src/host.ts` lists what a mainnet config may not do.

### Features, social and plugins
1. Features (`packages/features`): a `StakingProvider`, `SwapProvider` or `OnRampProvider`; every action ends in a
   `DappRequest` on the normal approval path. Partner keys come from the build environment (`CLIP_*`), never from config.
2. Social (`packages/social`): contacts, handles (`services.clipHandles` in config), notifications (optional permission), Discover.
3. Plugins (`packages/plugins`): a capability is a manifest permission plus a host handler; plugins never sign or see keys.
   Update `describePermissions` and the plugin README together.

### Write a chain module
1. `packages/chains-<family>` with `package.json` depending on `@clip-wallet/core` (never the vault); copy `tsconfig.json`
   from a chain package; run `node tools/release/normalize-manifests.mjs` to give it the published manifest shape.
2. Implement `ChainModule` in `src/module.ts`; export from `src/index.ts`.
3. `decode` returns a plain-language `DecodedRequest`; anything undecodable is `blind: true`.
4. `prepare` returns `SignablePayload`s; the vault signs. `@noble/curves` only for verification and public-key maths.
5. Tests: fixtures and signatures precomputed offline from the public "abandon … about" account; never generate or embed keys.

### Change a published package's manifest or add a package
1. Exports point at `./src/...` under `"development"`; `node tools/release/normalize-manifests.mjs` writes the rest
   (dist targets, `publishConfig` with provenance, `files`, repository, engines). Descriptions and peers: `EXTRA` in that script.
2. Every runtime import must be a dependency or peer: `node tools/release/check-manifests.mjs` (part of `pnpm harness`).
3. `pnpm pack-all` builds and packs everything into `.packs/` and checks each tarball. It publishes nothing.

### Release (CI only)
1. Every change to `packages/*` comes with `pnpm changeset` (all published packages share one version).
2. CI's "Version packages" PR runs `pnpm version-packages` (`changeset version`, then `tools/release/sync-template.mjs`
   pins the template to the new version); merging it publishes with provenance (`.github/workflows/release.yml`).

### Change the Scaffold-HBAR template or create-clip-wallet
1. The template is `templates/scaffold-hbar-clip-wallet` (laid out as create-scaffold-hbar expects: `template.json`
   capabilities nextjs-app / no Solidity / pnpm, rename map, outro). create-clip-wallet bundles it at `prepack`.
2. Both paths must keep producing the same project: create-clip-wallet copies the template the way create-scaffold-hbar
   does (`packages/create-clip-wallet/src/template.mjs`), then runs the identity step that `pnpm wallet:identity` runs.
3. `tools/harness/check.mjs` is copied into the template: `node tools/release/sync-template.mjs` after changing it.
4. Verify: `pnpm --filter create-clip-wallet test`, `pnpm pack-all`, `pnpm kit:e2e`, `pnpm kit:e2e:scaffold-hbar`.
