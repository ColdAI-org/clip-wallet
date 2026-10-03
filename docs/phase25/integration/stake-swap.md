# Integration: stake-swap stream (Phase 2.5)

All of this is already applied on `p25/stake-swap`. It is listed here because some edits touch shared files.
Checked with `pnpm install && pnpm -r typecheck && pnpm -r test && pnpm harness` and the extension e2e
(`pnpm --filter @clip-wallet/extension e2e`, 7/7).

## 1. Provider registration (packages/features only)

`packages/features/src/background.ts` registers every provider. There is no engine or extension change for this,
because `createFeatures` (packages/engine/src/features.ts) already builds `FeaturesService`.

- Staking: `CardanoStaking`, `...polkadotStakingProviders(host.networks())` (one per native key on an Asset Hub:
  wnd/pas on testnet, dot/ksm on mainnet), `NearStaking`, `TezosStaking`, `SuiStaking`, `AptosStaking`, `TonStaking`.
  `PENDING_STAKING` is now empty, so nothing shows "coming soon".
- Swaps: `MinswapSwap`, `DexHunterSwap` (off without a key), `AssetHubSwap`, `RefFinanceSwap`, `SiriusSwap`,
  `AftermathSwap`, `HyperionSwap`, `AvnuSwap`, `StonfiSwap`, `StellarPathSwap`, `TinymanSwap`.
- New optional `FeaturesConfig` fields (`packages/features/src/host.ts`): `swap.minswapPartner`, `swap.dexhunterApiKey`,
  `swap.avnuSepolia`, `nearStakingPools`. None is required, so `clip.config` / build env need no change.

## 2. Additive contract changes

- `packages/core/src/index.ts`: `WALLET_ORIGIN = "clip-wallet"` and `isWalletOrigin(origin)`.
  - Chain modules already built sends with `"clip-wallet"` and checked it in decode. The shell used `"wallet"`,
    so module-built sends were treated as a site's: a "domain-mismatch" caution, `siteAccount` lookup, `via` not "wallet".
  - Every wallet-built request now uses the constant: features providers, chains-substrate/tezos/stellar/algorand
    builders, the engine feature host (`request.origin = WALLET_ORIGIN`).
  - `isWalletOrigin` also accepts the older `"wallet"` spelling.
- `StakingProvider.buildUnstake/buildWithdraw/buildClaim` take `StakeActionParams { positionId, amount?, choice? }`.
  - `StakingProvider.amountOptional` (Tezos: empty amount = delegate only).
  - `StakePositionView.claimChoices` / `partialUnstake` and `StakeAssetView.amountOptional`.
  - `featStakeAction` accepts optional `amount` (human units) and `choice`.

## 3. Shared-file edits (small, already applied)

- `apps/extension/src/background/service.ts` (6 lines) and `packages/engine/src/engine.ts` (6 lines):
  `"wallet"` literals → `WALLET_ORIGIN` / `isWalletOrigin(...)`. `ApprovalView.via` stays `"wallet"`.
- `packages/engine/src/features.ts`: the feature host stamps `WALLET_ORIGIN`.
- `apps/extension/src/background/mocks/mock-{chains,route}.ts`: same constant.
- `apps/extension/wxt.config.ts` host_permissions, added:
  ```ts
  "https://agg-api.minswap.org/*",
  "https://aftermath.finance/*",
  "https://api.hyperion.xyz/*",
  "https://api-testnet.hyperion.xyz/*",
  "https://starknet.api.avnu.fi/*",
  "https://sepolia.api.avnu.fi/*",
  "https://api.ston.fi/*",
  "https://smartrouter.ref.finance/*",
  ```
  Koios, TzKT, tonapi, Horizon, algod, Sui GraphQL, the Aptos indexer, FastNEAR and the substrate RPCs were already
  used by the chain modules.
- `packages/ui/src/features/Stake.tsx` and `client.ts`:
  - Claiming asks for the vote choice first when `claimChoices` is set.
  - A partial unstake takes an amount when `partialUnstake` is set.
  - The amount is optional when `amountOptional` is set.
- `packages/ui/src/features/client.ts`: `stakeAction` takes `amount?` / `choice?`. The extension's `features-bus.ts`
  already spreads params, so it needs no change.

## 4. Chain-package additions (additive)

| Package | Added |
|---|---|
| chains-cardano | `buildVoteDelegate`, `buildWithdrawRewards`, `buildDeregister`, withdrawals in `buildTx`, Koios `poolList`/`epochRewards`, `plutus.ts` (order datums) |
| chains-substrate | `buildCall`, `defi.ts`. `runtimeCall` now sends 0x hex: nodes rejected the old form, so pending rewards were silently wrong. AssetConversion describer, Paseo USDC/USDT (`usdc`/`usdt` keys), `eraHours` |
| chains-near | `ref.ts`, Ref swap describer, `unstake_all` / `withdraw(amount)` |
| chains-tezos | `dex.ts`, `tezosSendRequest`, stake/delegation ops, `parseForged` |
| chains-sui / chains-aptos | `defi.ts` builders and parsers. Aptos describe now reads typed args, so a wallet-built stake shows its amount |
| chains-ton | `defi.ts` (Tonstakers and STON.fi messages) |
| chains-starknet | `avnu.ts` (exchange addresses, calldata parser, exact approve) |
| chains-stellar | `swap.ts` (`buildPathSwap`, `checkPathSwap`) |
| chains-algorand | `build.ts` (groups, local state, logic-sig address) |

## 5. Follow-ups for the integration step

- The quote view lists two step labels for atomic trustline/opt-in/approve + swap (Stellar, Algorand, Tezos).
  Consider one label.
- Polkadot pool options took about 45 s on first use live, mostly metadata download. Consider warming the metadata cache.
