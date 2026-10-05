# AGENTS.md — Clip Wallet

Clip Wallet is a non-custodial wallet for every CLPR network. Pre-release: testnets only.

## Rules that never break
1. Only `packages/vault` touches seed phrases or private keys. `tools/harness/check.mjs` fails otherwise.
2. Chain modules (`packages/chains-*`) implement `ChainModule` from `@clip-wallet/core` and never import the vault.
3. Every dapp request becomes a `DecodedRequest` before approval. Undecodable = blind signing, off by default.
4. Networks are invisible in the default UI: speak in assets and apps; show the network only where a mistake loses money (see the plan's "Networks are invisible").
5. Never log, print or commit key material, phrases, API keys or `.env` values. Tests use the public BIP-39 test vectors only.
6. Testnet by default. Mainnet needs an explicit build flag.

## Commands that must pass
pnpm install && pnpm typecheck && pnpm test && pnpm harness

Release work (Docker for the last one): `pnpm --filter @clip-wallet/extension package`, `actionlint`, `scripts/repro-check.sh`.

## Layout
packages/core        shared types (the contract)
packages/vault       phrase, derivation, encryption, signing
packages/1mask       dapp connectors: EIP-1193/6963, Solana Wallet Standard, Bitcoin, Hedera, WalletConnect
packages/chains-*    evm, hedera, solana, bitcoin modules
packages/route       CLPRouter quotes and funding
packages/ui          React screens and theme
apps/extension       MV3 browser extension
tools/harness        validators coding agents must pass

## Recipes
Each ends with `pnpm typecheck && pnpm test && pnpm harness`. Product context: `.harness/spec.md`, `.harness/prd.md`; map: `llms.txt`.

### Rebrand
1. Edit `apps/extension/clip.config.ts` (schema and defaults in `packages/config/src/index.ts`): `name`, `icon`, `rdns` (a reverse domain you own), `theme.accent` (`accentText` defaults to white; contrast must be at least 3:1).
2. Put the icon next to the config (`./icon.svg` or `.png`); never a remote URL you don't control. Clip Wallet's own icons come from `brand/` via `node tools/brand/render.mjs` (see `brand/README.md`).
3. Screens read tokens only (`packages/ui/src/theme/tokens.ts`); never hard-code a colour or the product name in `packages/ui/src/screens/*`.
4. Leave `mainnet: false`. New wallets: `npx create-clip-wallet my-wallet` (experimental, `packages/create-clip-wallet`).

### Add or remove a network
1. Turn families/chains on or off with `networks` in `clip.config.ts`: `"evm:*"`, `"evm:<chain id>"`, `"hedera"`, `"solana"`, `"bitcoin"`.
2. New EVM chain: add an `EvmNetworkSpec` to `packages/chains-evm/src/networks.ts` (testnet flag, RPC fallbacks, explorer, indexer) and a test in `packages/chains-evm/test/registry.test.ts`.
3. New Hedera/Solana/Bitcoin network: the family's `src/networks.ts` in `packages/chains-<family>`.
4. If it should be routable, add its Router to `packages/route/src/deployments.ts` and its ledger and Channels to `packages/route/src/graph.ts`, with a fixture test in `packages/route/test`.
5. A new family needs a chain module (recipe below) and a `Family` member in `packages/core/src/index.ts` (additive).

### Add a token list
1. EVM: add entries to `CURATED_TOKENS` in `packages/chains-evm/src/tokens.ts` (chain id, address, symbol, decimals, the shared `key` only for the same issuer's native token).
2. Bridged copies get their own key and `bridged: true` (`AssetRef` in `packages/core/src/index.ts`); they never merge with the native asset.
3. Other families: the module's token/metadata file (e.g. `packages/chains-hedera/src/metadata.ts`).
4. Add a test that the token resolves and that a look-alike stays `spam`.

### Change routing defaults
1. Wallet-wide: `route.mode` (`balanced`, `cheapest`, `fastest`, `reliable`, `greenest`) and `route.filters` (`iso20022`, `mica`, `energy`, `trustFloor`, `maxHops`, `deadlineS`) in `clip.config.ts`.
2. They are passed to `RouteClient.quote` (`packages/route/src/client.ts`); filter types in `packages/route/src/types.ts`.
3. Never allow test/stub verifiers outside testnet (`packages/route/src/safety.ts`); don't loosen it to get a route.
4. Planner behaviour comes from the vendored CLPRouter SDK (`packages/route/src/vendor/clprouter-sdk`, see `packages/route/src/clprouter.ts`): change it upstream and re-vendor, never edit in place.

### Add a screen
1. Create `packages/ui/src/screens/<Name>.tsx`; read state and actions from the UI context (`packages/ui/src/context.tsx`), tokens from `packages/ui/src/theme`.
2. Register it in `packages/ui/src/App.tsx`.
3. Speak in assets and apps; show a network only through the network chip where a mistake loses money.
4. Screens never import `@clip-wallet/vault` (only `packages/ui/src/screens/Onboarding.tsx` may); ask the background through `packages/ui/src/client.ts`.
5. Add a render test in `packages/ui/test/screens.test.tsx`.

### Write a chain module
1. Create `packages/chains-<family>` with `package.json` depending on `@clip-wallet/core` only (never `@clip-wallet/vault`), copying `tsconfig.json` from an existing chain package.
2. Implement `ChainModule` from `packages/core/src/index.ts` in `src/module.ts`; export it from `src/index.ts`.
3. `decode` returns a plain-language `DecodedRequest`; anything you can't decode is `blind: true`.
4. `prepare` returns `SignablePayload`s; the vault signs. Use `@noble/curves` only for verification and public-key maths.
5. Tests: decode fixtures and signatures precomputed offline from the public "abandon … about" account (see `packages/chains-evm/test/signatures.ts`); never generate or embed keys in a chain package.
