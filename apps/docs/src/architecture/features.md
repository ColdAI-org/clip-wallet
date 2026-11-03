# Features

`@coldai/clip-wallet-features` holds staking, swaps, on-ramps, Secure Trade, prices and Explore, as background services with
no keys. Every action ends in a `DappRequest` on the normal approval path: decode, approve, the vault signs. Screens
live in `packages/ui/src/features/`.

Networks stay invisible here too: everything is addressed by asset ("Stake SOL", "Swap 100 USDC for ETH"), and the
service picks the network: where the person holds the most of the asset, the cheapest place to receive, or the only
place a provider works.

## The pieces

| Area | Interface | Providers |
| --- | --- | --- |
| Staking | `StakingProvider` | Hedera (native), Solana (native delegation), Cardano (pools), Polkadot (nomination pools), NEAR (staking pools), Tezos, Sui, Aptos (delegation pools), TON (Tonstakers) |
| Swaps | `SwapProvider` | 0x v2 (EVM), Jupiter (Solana), SaucerSwap V2 (Hedera), Minswap (Cardano), Asset Hub (Polkadot), Ref Finance (NEAR), Sirius (Tezos), Aftermath (Sui), Hyperion (Aptos), AVNU (Starknet), STON.fi (TON), Stellar DEX path payments, Tinyman v2 (Algorand); between networks, SODAX (ten EVM mainnets, with the 0.875 % Clip fee; mainnet builds that set it up) |
| On-ramps | `OnRampProvider` | MoonPay, Banxa, C14 hosted widgets |
| Secure Trade | | Hedera peer-to-peer atomic swaps, direct or scheduled, shared as links |
| Prices | `PriceFeed` | CoinGecko, cached and rate-limited, last-known fallback |
| Explore | | curated apps per family, read-only LP positions (SaucerSwap V2, Uniswap v3) |

A swap or stake returns `Step`s: the permission it needs (always for the exact amount), an association where Hedera
needs one, then the action. Each step is an ordinary approval.

## Partner keys

Providers that need a partner key read it from the **build environment**, never from `clip.config.ts` or source:

| Variable | Used by |
| --- | --- |
| `CLIP_0X_API_KEY` | 0x swaps (EVM) |
| `CLIP_JUPITER_API_KEY` | Jupiter swaps (optional; keyless runs at a lower rate) |
| `CLIP_MOONPAY_API_KEY`, `CLIP_MOONPAY_SIGNER_URL` | MoonPay (the URL signature comes from your own signing endpoint) |
| `CLIP_BANXA_PARTNER` | Banxa |
| `CLIP_C14_CLIENT_ID`, `CLIP_C14_ASSET_IDS` | C14 |
| `CLIP_COINGECKO_DEMO_KEY` | CoinGecko prices (optional) |
| `CLIP_BLOCKAID_API_KEY` | Blockaid scanning (see [Security services](./security.md)) |
| `CLIP_SODAX_SERVER_URL`, `CLIP_SODAX_FEE_RECEIVER` | SODAX swaps between networks, mainnet builds only: the ExClip server (https) that holds SODAX's key and charges no fee of its own, and ColdAI LLC's address for the Clip fee, which must be on the reviewed list. Both or neither. |

Without its key, a feature says in plain words that it isn't switched on in this build. `clipWallet()` reads these
from the environment or from `CLIP_*` lines in the project's `.env`, and never logs them.

## SODAX swaps and the Clip fee

Swaps between networks go through SODAX and carry the **Clip fee: 0.875 % of the amount sold, paid to ColdAI LLC**,
in SODAX's exact-amount fee form. The quote shows it apart from the network fee, and the review shows the fee, who
receives it and where the swap arrives. They are off unless a mainnet build sets both settings above, and the build
is refused when only one is set or the receiver isn't on the reviewed list
(`packages/features/src/swap/sodax-fee-receivers.json`, which holds ColdAI LLC's address and no other). The ExClip
server must charge no fee of its own: the wallet quotes through it only while its `/api/exclip/config` reports
`partnerFeeBps` 0, `feeReceiver` null and no `feeSplit`, since a server's fee would be pinned on the quote and lower
the minimum on the review. The whole story, with the SDK sources:
[SODAX swaps and the Clip fee](repo:docs/features/sodax-swaps.md). Kit wallets: the
[split-contract design](repo:docs/features/sodax-kit-split.md).

## Safety model

- **No keys.** Nothing here imports the vault. Solana stake accounts are created with `CreateAccountWithSeed` from the
  person's own address, so no keypair is ever made.
- **Exact approvals.** Swaps ask for an allowance of exactly the amount sold, never unlimited.
- **Quotes are checked.** A 0x quote whose target or spender isn't the expected contract is refused.
- **The Clip fee is checked.** A SODAX swap is refused before signing unless its one fee entry pays a reviewed
  receiver at most 0.875 % of the amount sold and every other byte is what the wallet planned (`checkSodaxSwap`).
- **Wallet-built requests are re-checked, not trusted.** `refineDecoded()` replaces a blind decode of a wallet-built
  request only when its verifier passes on the actual bytes and the module simulated it without failure. Dapp requests
  are never touched, and requests are matched by object identity, so a dapp can't pose as one.
- **Secure Trade links are untrusted.** The review decodes the actual transaction with the Hedera module and refuses
  unless the person would receive exactly what was offered, pay exactly what was asked, and lose nothing else.

The sources each provider was checked against are listed in the [features README](repo:packages/features/README.md).
