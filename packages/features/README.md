# @clip-wallet/features

HashPack-parity features for Clip Wallet, as background services. The package is pure logic and holds no keys.
Every action ends in a `DappRequest` on the normal approval path: decode, then approve, then the vault signs.
Screens live in `packages/ui/src/features/`. Wiring is described in `docs/phase2/integration/features.md`.

Networks are invisible here. Everything is addressed by asset key ("Stake SOL", "Swap 100 USDC for ETH",
"Buy SOL"). The services pick the network themselves: where you hold the most of the asset, the cheapest
place to receive, or the only place a provider works. `networkId` is carried for Advanced mode only.

| Area | Module | What it does |
|---|---|---|
| Staking | `staking/` | `StakingProvider` interface. Hedera (native, AccountUpdate `stakedNodeId`), Solana (native delegation via seeded stake accounts), Cardano (pool delegation, reward withdrawal with the vote-delegation requirement), Polkadot (nomination pools on Asset Hub), NEAR (staking-pool contracts), Tezos (delegation + staking), Sui (native), Aptos (delegation pools), TON (Tonstakers liquid staking). |
| Swaps | `swap/` | `SwapProvider` interface. Jupiter (Solana), SaucerSwap V2 (Hedera), 0x v2 (EVM), Minswap (Cardano; DexHunter wired off), Asset Hub AssetConversion (Polkadot), Ref Finance (NEAR), Sirius (Tezos), Aftermath (Sui), Hyperion (Aptos), AVNU (Starknet), STON.fi (TON), Stellar DEX path payments, Tinyman v2 (Algorand). Cross-network swaps get a CLPRouter quote only. |
| On-ramp | `onramp/` | `OnRampProvider` interface. MoonPay, Banxa and C14 hosted-widget URLs. |
| Secure Trade | `trade/` | Hedera P2P atomic swap (direct and scheduled), share links, review against the real transaction, status from the mirror node. |
| Explore | `dapps/featured.json`, `lp/` | Curated apps per family, and read-only LP positions for SaucerSwap V2 and Uniswap v3. |
| Prices | `prices/` | CoinGecko `PriceFeed` with caching, rate limiting and last-known fallback. |
| Bus | `messages.ts`, `background.ts` | zod-validated `feat*` messages and `FeaturesService.handle()`. |

## Safety model

- **No keys.** Nothing here imports the vault or key libraries. Solana stake accounts are created with
  `CreateAccountWithSeed` from the user's own address (seed `clip-stake-N`), so no new keypair is ever made.
  The user is the only signer.
- **Approvals are exact.** Swaps request an allowance for exactly the amount being sold, never an unlimited
  one. On EVM that's an ERC-20 `approve` to 0x AllowanceHolder. On Hedera it's an HTS
  `AccountAllowanceApprove` to the SaucerSwap router, skipped when the existing allowance already covers the
  amount.
- **0x quotes are checked.** A quote whose `transaction.to` or allowance spender isn't the AllowanceHolder
  for that chain is refused.
- **Wallet-built requests are re-checked, not trusted.** `queueSteps` registers each request object together
  with its plain title. `refineDecoded()` runs after the chain module's `decode()`. It only replaces a blind
  decode when two things are both true:
  1. `verify()` passes on the actual bytes. For Solana that means only allowed program ids; for EVM it means
     the target is AllowanceHolder.
  2. The module simulated the request without failure.

  Dapp requests are never touched. Requests are keyed by object identity, so a dapp can't claim to be one.
- **Secure Trade links are untrusted.** Before Accept is enabled, the review decodes the actual transaction
  or schedule with the Hedera module. It refuses when you would not receive exactly `give`, pay exactly
  `get`, and lose nothing else.
- **Plain errors.** Every failure is a `ClipError(userMessage, code)`. Partner keys are sent only in headers,
  never in URLs or error messages.

## Verified sources (2026-10-03)

**Hedera staking**
- Mirror node OpenAPI: https://testnet.mirrornode.hedera.com/api/v1/docs/openapi.yml
- `/api/v1/network/nodes` gives `reward_rate_start`: "tinybars earned per whole hbar in the last staking
  period". A staking period is one day (`/network/stake`: `staking_period_duration: 1440`).
- APR ≈ `reward_rate_start × 365 / 1e8`. This formula is our own inference from those field definitions; the
  docs don't state it.
- Account fields: `staked_node_id`, `pending_reward`, `decline_reward`.
- Rewards are paid automatically the next time the account is in a transaction, so there is no claim step
  (HIP-406).

**Solana staking**
- Stake program `Stake11111111111111111111111111111111111111`, account size 200 bytes, withdrawer at offset 44
  (https://github.com/solana-program/stake).
- Builders from `@solana-program/stake` 0.10.0 (npm, peer `@solana/kit ^8.3`). They use the current short
  account lists (no sysvars).
- `getCreateAccountWithSeedInstruction` from `@solana-program/system` 0.15.
- RPC calls: `getVoteAccounts`, `getInflationRate`, `getSupply`, `getStakeMinimumDelegation` (1 SOL on
  devnet today) and `getMinimumBalanceForRentExemption(200)`, per https://solana.com/docs/rpc.
- Validator choice: a vetted list from config wins when any of its validators is healthy. Otherwise the
  wallet picks validators that are not delinquent, charge ≤ 10 % commission, had ≥ 90 % of the best credits
  last epoch, and are not in the top 10 % by stake.
- APY ≈ validator inflation × supply ÷ total active stake × (1 − commission).

**Jupiter**
- Swap API V2: `GET https://api.jup.ag/swap/v2/order` then `POST /swap/v2/execute`
  (https://developers.jup.ag/docs/swap/order-and-execute.md).
- Keyless access runs at 0.5 RPS; an optional portal key in `x-api-key` gives 1 RPS
  (https://developers.jup.ag/docs/portal/rate-limits.md).
- `/swap/v1` is superseded and `lite-api.jup.ag` is being retired.
- Mainnet only: the docs list no devnet swap programs.
- The wallet signs only (`solana:signTransaction`, so RFQ co-signing works). `/execute` then lands the
  transaction.
- Aggregator program `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` was checked on mainnet: executable,
  upgradeable loader.

**SaucerSwap V2** (https://docs.saucerswap.finance/developers/contracts.md)

| | Mainnet | Testnet |
|---|---|---|
| QuoterV2 | 0.0.3949424 | 0.0.1390002 |
| SwapRouter | 0.0.3949434 | 0.0.1414040 |
| Factory | 0.0.3946833 | 0.0.1197038 |
| NonfungiblePositionManager | 0.0.4053945 | 0.0.1308184 |
| LP NFT (SSV2-LP) | 0.0.4054027 | 0.0.1310436 |
| WHBAR token | 0.0.1456986 | 0.0.15058 |

- The REST API (`api.saucerswap.finance`) needs `x-api-key` and has no AMM quote endpoint.
- Quotes therefore come from `QuoterV2.quoteExactInput` via the mirror node's free `POST /api/v1/contracts/call`,
  as the swap-quote docs suggest (the JSON-RPC relay also works).
- Swap encoding follows the docs' swap-hbar-for-tokens and swap-tokens-for-hbar pages:
  - HBAR in: `multicall(exactInput, refundETH)`, paying HBAR.
  - HBAR out: `exactInput(recipient = router)` followed by `unwrapWHBAR(min, you)`.
  - Selling a token needs an allowance to the router first.

**0x Swap API v2**
- `GET https://api.0x.org/swap/allowance-holder/quote` with headers `0x-api-key` and `0x-version: v2`
  (https://docs.0x.org/api-reference/evm-ap-is/swap/allowanceholder-getquote.md).
- Native token placeholder: `0xEeee…EEeE`.
- AllowanceHolder: `0x0000000000001fF3684f28c67538d4D072C22734` on Cancun chains and
  `0x0000000000005E88410CcDFaDe4a5EfaE4b49562` on Mantle (https://docs.0x.org/docs/core-concepts/contracts.md).
- Supported chains are mainnets only (https://docs.0x.org/docs/introduction/supported-chains.md).
- No documented free plan, so 0x is off unless a key is configured.

**On-ramps**
- MoonPay (https://dev.moonpay.com/widget/on-ramp/customization/parameters.md and `url-signing.md`):
  - Hosts: `buy.moonpay.com` and `buy-sandbox.moonpay.com`.
  - A `walletAddress` requires an HMAC signature made with the secret key, so it has to be signed
    server-side. This plugin calls your signer endpoint for it.
  - Currency codes come from https://api.moonpay.com/v3/currencies: `sol`, `usdc_sol`, `eth`, `usdc`,
    `eth_base`, `usdc_base`, `hbar`. Of these, `hbar`, `eth_base` and `usdc_base` don't support test mode.
- Banxa referral URL (https://docs.banxa.com/products/hosted-checkout/docs/referral-integration/constructing-referral-urls.md):
  - Hosts: `https://{partner}.banxa.com/` and sandbox `{partner}.banxa-sandbox.com`.
  - Parameters (case-sensitive): `coinType`, `blockchain`, `fiatType`, `fiatAmount`, `walletAddress`.
  - Blockchain codes: `SOL`, `ETH`, `BASE`, `HBAR`.
- C14:
  - `docs.c14.money` didn't resolve. The parameters `clientId`, `targetAssetId(+Lock)`,
    `targetAddress(+Lock)`, `sourceAmount` and `sourceCurrencyCode` come from the live widget at
    `https://pay.c14.money/`.
  - Asset UUIDs aren't published, so they must come from config. Re-verify all of this with C14.

**LP positions**
- Uniswap v3 NonfungiblePositionManager addresses (https://developers.uniswap.org/docs/protocols/v3/deployments/):
  `0xC364…FE88` on Ethereum and Arbitrum, `0x03a5…34f1` on Base, `0x1238…DA52` on Sepolia, `0x6b29…4d65` on
  Arbitrum Sepolia, `0x27F9…faA2` on Base Sepolia.
- The `positions()` tuple order follows v3-periphery `INonfungiblePositionManager.sol`.
- These are read on-chain because The Graph's gateway now requires an API key.
- Tick maths ports v3-core `TickMath`. The tests check the MIN and MAX sqrt ratios.

**CoinGecko**
- Endpoint: `https://api.coingecko.com/api/v3/simple/price?ids=…&vs_currencies=…`
  (https://docs.coingecko.com/reference/simple-price).
- Keyless access is IP-rate-limited. An optional Demo key goes in the `x-cg-demo-api-key` header.
- Coin ids were checked against `/coins/list`. TON is `the-open-network`; POL is `polygon-ecosystem-token`.

**Featured apps:** every domain in `featured.json` was fetched over HTTPS on 2026-10-03. hashport was dropped
because it is winding down. SaucerSwap's `app.` subdomain returned a TLS error, so the list uses
`www.saucerswap.finance`.

## Phase 2.5: staking and swaps for the newer families (2026-10-03)

Every flow below ends in a request the family's chain module decodes in plain words; where a module can't
(TON deposit, Sui/Aptos router calls), the step's `verify` re-checks the bytes and a clean simulation is
required before the plain title replaces "unreadable". Third-party transactions are parsed back with the
real SDK/codec and refused unless every contract/script/package is on the provider's allow-list, the
amounts match the quote and the output goes to you. Wallet-built requests carry `WALLET_ORIGIN`
(`@clip-wallet/core`). Detailed sources live in each chain package's README; the essentials:

**Staking**

| Coin | How | Testnet | Notes and sources |
|---|---|---|---|
| ADA | Pool delegation (`buildDelegate`), unstake = certificate 8 + reward withdrawal, claim = withdrawal | yes | Pools from Koios `/pool_list` + `/pool_info` (retiring, ≥100 % saturation and pledge-not-met dropped). Since Plomin, withdrawals need a vote delegation: the position offers "Abstain" / "No confidence" (`claimChoices`); the ledger checks it against the state *before* the transaction's certificates (cardano-ledger `Conway/Rules/Ledger.hs` `validateWithdrawalsDelegated`), so it is a separate first approval and step 2 waits until Koios shows it. CDDL: `conway.cddl`. |
| DOT / KSM / WND / PAS | NominationPools join / bond_extra / unbond (partial) / withdraw_unbonded / claim_payout on Asset Hub | yes (Westend, Paseo) | One provider per native key (`polkadotStakingProviders`). Pools ranked by commission and members; unbonding read from the runtime (Polkadot ≈ 2 days, Paseo ≈ 7 days, Westend ≈ 12 h). polkadot-sdk `nomination-pools`, `staking-async`; live runtime metadata. |
| NEAR | staking-pool `deposit_and_stake` / `unstake(_all)` / `withdraw(_all)` | yes | near/core-contracts staking-pool; validators RPC (slashed, kicked, < 95 % online, top-10 % stake dropped); positions from FastNEAR `/v1/account/{id}/staking` with an RPC fallback. Unlock ≈ 4 epochs (1–2 days). |
| XTZ | Delegation (amount empty/0, `amountOptional`) and staking (`stake` / `unstake` / `finalize_unstake`) | yes (Shadownet) | octez docs "staking" (edge in billionths, limit in millionths); bakers from TzKT `/v1/delegates`; unstake delay 4 cycles. |
| SUI | `0x3::sui_system::request_add_stake` / `request_withdraw_stake` | yes | sui-system `sui_system.move`, `staking_pool.move` (min 1 SUI); reads over Sui GraphQL. |
| APT | `0x1::delegation_pool` add_stake / unlock / withdraw | yes | aptos-framework `delegation_pool.move` (min 10 APT, 14-day lockup); pools from the keyless Aptos indexer. |
| GRAM (TON) | Tonstakers liquid staking (deposit → tsTON, unstake = tsTON burn) | yes | tonstakers-sdk constants, ton-blockchain/liquid-staking-contract op codes; pool data from tonapi.io. Nominator pools skipped (10k+ minimums / own validator). |

**Swaps**

| Family | Provider | Key | Testnet | How it stays safe |
|---|---|---|---|---|
| Cardano | Minswap aggregator (`agg-api.minswap.org`, Minswap pools only) | none | mainnet only | Returned tx parsed: our inputs only, outputs to us or allow-listed Minswap order scripts (minswap/sdk constants), datum pays us with ≥ our minimum, no certs/withdrawals/mints, fee ≤ 2 ADA. DexHunter needs a partner key and is wired off. |
| Polkadot | Asset Hub `AssetConversion` (runtime API quotes, `swap_exact_tokens_for_tokens`) | none | yes (Paseo) | Built by the wallet; `amount_out_min` on-chain; no approvals. |
| NEAR | Ref Finance (`smartrouter.ref.finance` route, wallet-built `ft_transfer_call`) | none | NEAR↔USDC only | Exchange/wrap contracts fixed per network; route re-checked; `min_amount_out` on-chain. 1Click skipped (key-less fee, off-chain minimum). |
| Tezos | Sirius (protocol Liquidity Baking CPMM) | none | mainnet only | CPMM address from the node must equal the allow-listed contract; FA1.2 approve 0 → exact → swap → allowance ends at 0. 3Route is EVM-only/paid now; Plenty's API is down. |
| Sui | Aftermath router | none | mainnet only | Returned PTB parsed; only allow-listed router packages (or deployer-verified linked ones), exactly the sell amount, all transfers to you, fee 0. Cetus needs its SDK (skipped). |
| Aptos | Hyperion (`router_v3::swap_batch`) | none | yes (thin liquidity) | Wallet-built entry function; pools must be Hyperion `LiquidityPoolV3`. Panora needs an API key (skipped). |
| Starknet | AVNU v3 (`/swap/v3/quotes`, `/build`) | none | off unless `avnuSepolia` | Exactly one allow-listed exchange call, recipient you, no integrator fee, min out ≥ slippage floor; the wallet adds its own exact approve. |
| TON | STON.fi v2 (`api.ston.fi` simulate) | none | mainnet only | Messages built by the wallet per the SDK's v2 layout; routers/pTON from a 50-router snapshot; router jetton wallet checked on-chain. |
| Stellar | Native path payments (Horizon `/paths/strict-send`) | none | yes | `PathPaymentStrictSend` to yourself with `destMin`; trustline added in the same tx when needed. |
| Algorand | Tinyman v2 (pool state read via algod) | none | yes | Group built by the wallet (opt-in, exact transfer, `swap fixed-input` app call with min out); pool address derived from the official logic-sig template. Folks Router/Vestige/Deflex skipped (keys/404). |

## Tests

`pnpm test`: 238 tests. Every network call is a mocked fetch fixture (mirror node, Solana RPC, Jupiter, 0x,
contracts/call, eth_call, CoinGecko, MoonPay signer). Transactions are built and parsed back with the real SDKs.
Nothing is signed, nothing is sent, and there is no live trading.

## Gaps

- **Jupiter and 0x are mainnet only**, so in a testnet build they show "isn't available in this test version
  yet". SaucerSwap (testnet) is the only swap that runs end to end on testnets.
- **SaucerSwap.** Quotes cover direct pools in all four fee tiers plus two-hop routes through WHBAR. There is
  no split routing. Gas is the quoter's estimate × 1.5 + 100k, clamped to between 300k and 3M. Check this on
  testnet before enabling.
- **Solana stake transactions are blind in chains-solana.** The Stake program and Jupiter aren't described
  there, so the approval screen relies on `refine` (verify plus a clean simulation). A proper Stake-program
  describer in chains-solana would be better.
- **0x builds the swap at quote time.** If the separate permission step takes long, the swap may revert on
  slippage. In that case, get a new price.
- **Partner keys ship in the bundle.** 0x, Jupiter and MoonPay publishable keys are extractable from an
  extension. A proxy is preferable for 0x.
- **Cross-network swaps are quote only.** `@clip-wallet/route` quotes the delivery of the target asset. The
  amount comes from prices, so it is an estimate, and execution isn't wired yet.
- **Secure Trade.** A direct offer is valid for 180 s (the Hedera transaction validity), which makes it
  practical only when both people are online. Very long direct links (many node bodies) don't fit a QR
  code, so the UI falls back to sharing the link.
- **SaucerSwap V2 LP reads assume v3-periphery ABIs** for `positions()` and `slot0()`. `slot0` reads only the
  first two words, to tolerate fork differences.
- **Phase 2.5 gaps.**
  - Mainnet-only swaps on testnet builds: Minswap, Sirius, Aftermath, STON.fi (and AVNU unless `avnuSepolia`).
  - Allow-lists that are snapshots (STON.fi routers, Aftermath packages) refuse new contracts in plain words until refreshed.
  - Trustline/opt-in/approval and the swap are one atomic approval on Stellar, Algorand and Tezos, but the quote lists two step labels.
  - Cardano claim without a vote choice takes two approvals; step 2 polls Koios for up to 6 minutes.
  - Minswap orders are batcher orders with no in-wallet cancel yet. Tonstakers round-end payouts aren't listed as positions.
  - Starknet native staking isn't built (needs a keyless pool list).
  - Reward rates are estimates; Tezos delegation rewards depend on the baker.
