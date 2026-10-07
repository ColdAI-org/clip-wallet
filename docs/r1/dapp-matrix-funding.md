# Dapp matrix: testnet funding

The dapp matrix (`apps/extension/e2e/matrix.spec.ts`, results in [dapp-matrix.md](dapp-matrix.md)) runs on its own
wallet: a dedicated 12-word phrase generated with the vault's own code (`ClipVault.create()` → `revealPhrase()`) and
stored **only** in the git-excluded `~/clip-wallet/.env.dapp-matrix` (`DAPP_MATRIX_MNEMONIC`; `.gitignore` covers
`.env.*`). It is never printed, logged, committed or screenshotted. Testnets only: nothing here has mainnet value.

The addresses below are account 0 of each family, derived from that phrase with `ClipVault` defaults, which is exactly what
the extension background does (`packages/extension-kit/src/background/wiring.ts`). The matrix re-derives each address
from the vault's public key with the family's own chain module (`addressFromPublicKey`) and checks that every dapp's
connect returns the same account. The public keys are in `apps/extension/e2e/matrix/addresses.json`.

## See when funds land

```bash
node scripts/dapp-matrix-balances.mjs            # balance per family, read with the wallet's own chain modules
node scripts/dapp-matrix-balances.mjs --watch    # re-check every 30 s until every account has its minimum
node scripts/dapp-matrix-balances.mjs --json
```

Once an account holds its minimum, the matrix's L3 (sign and broadcast) runs for that family instead of skipping:
`pnpm --filter @clip-wallet/extension matrix`.

## Status (2026-10-05)

Funded and confirmed by the matrix's L3: EVM, Hedera (both accounts), Solana, Sui, Cardano, Substrate, Starknet,
Stellar, Tezos, Algorand. **Still needed:** Bitcoin (holds 546 sats, needs 5,000), Aptos (0.01 APT), TON (0.2 GRAM),
NEAR (0.1 NEAR). Then run `pnpm --filter @clip-wallet/extension matrix -- -g "bitcoin|aptos|ton|near"`.

## Table

"API-only" means a plain public HTTP API with no captcha, no account, no sign-up and no terms to accept. I used only
those. Everything else is for you.

| Family | Testnet | Receive address | Faucet | What the faucet needs | Matrix minimum | How arrival is confirmed |
| --- | --- | --- | --- | --- | --- | --- |
| Hedera (WalletConnect path, the Hedera key) | Hedera testnet | `0xa3a57dB2a5237bD72D5d05cBdD797fEe21A0Fc92` → **0.0.10872693** (funded, 10 HBAR) | **You fund this.** [portal.hedera.com/faucet](https://portal.hedera.com/faucet) | Portal: login / captcha | **10 HBAR** (account auto-creation + fees + 1 tinybar transfer) | `balances.mjs` (mirror node via chains-hedera); account id at `https://testnet.mirrornode.hedera.com/api/v1/accounts/0xa3a57dB2a5237bD72D5d05cBdD797fEe21A0Fc92` |
| Hedera (injected EIP-1193 path, the EVM key) | Hedera testnet, chain 296 | `0x05ACD02A8E18c130D902FB732bb6AD22DA4f2717` → **0.0.10872695** (funded, 10 HBAR) | **You fund this.** Same faucet | Portal: login / captcha | **10 HBAR** (auto-creation + relay gas) | `balances.mjs` row `hedera-evm` (Hashio `eth_getBalance`) |
| EVM | Sepolia (11155111) | `0x05ACD02A8E18c130D902FB732bb6AD22DA4f2717` | [cloud.google.com/application/web3/faucet/ethereum/sepolia](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) (also Alchemy, Infura) | Google login (Alchemy/Infura: account) | 0.001 ETH | `balances.mjs`; [sepolia.etherscan.io](https://sepolia.etherscan.io/address/0x05ACD02A8E18c130D902FB732bb6AD22DA4f2717) |
| Solana | Devnet | `G1zRMYPBYE6CvsvZY1gAwfNnr5ZjW6eZJeGARQZvdxzk` | [faucet.solana.com](https://faucet.solana.com) (or the devnet RPC `requestAirdrop`) | Web: GitHub login. RPC airdrop is API-only but was rate-limited (HTTP 429 "airdrop limit… or run dry") when tried | 0.01 SOL | `balances.mjs`; [explorer](https://explorer.solana.com/address/G1zRMYPBYE6CvsvZY1gAwfNnr5ZjW6eZJeGARQZvdxzk?cluster=devnet) |
| Bitcoin | Testnet4 | `tb1q4j5qk5zu6ervj79ewph4zw3lukn9dhpdl6ydnr` (P2WPKH) | [mempool.space/testnet4/faucet](https://mempool.space/testnet4/faucet) | Login (per-account cap) | 5,000 sats (546-sat output + fee) | `balances.mjs` (Esplora); [mempool.space](https://mempool.space/testnet4/address/tb1q4j5qk5zu6ervj79ewph4zw3lukn9dhpdl6ydnr) |
| Sui | Testnet | `0x610339995017916d583f600d0796603136f24fcb271cde2ddecb50db9a6fc5f9` | [faucet.sui.io](https://faucet.sui.io/?network=testnet) | Web page. The v2 API refused: `"CI compatibility is disabled"` | 0.05 SUI | `balances.mjs` (GraphQL); [suiscan](https://suiscan.xyz/testnet/account/0x610339995017916d583f600d0796603136f24fcb271cde2ddecb50db9a6fc5f9) |
| Aptos | Testnet | `0xf250c99c6586caefd617a38b184dff03ca467ce35268563c907b0d71489d2de9` | [aptos.dev/network/faucet](https://aptos.dev/network/faucet) | Login. The mint API answered `x-is-jwt header must be present` | 0.01 APT | `balances.mjs`; [explorer](https://explorer.aptoslabs.com/account/0xf250c99c6586caefd617a38b184dff03ca467ce35268563c907b0d71489d2de9?network=testnet) |
| Cardano | Preprod | `addr_test1qrmlfjtxatttuphcnyz4f0jvw9mkaajxjrj76h0v884z7lvpvnak9dtlh4cmcxx65rtl3dz9cfkcfmz8kz06qzdxch8qv5dr79` (CIP-1852 base address: payment key + stake key `2/0`; the address the wallet shows, CIP-30 returns and change goes to) | [docs.cardano.org/cardano-testnets/tools/faucet](https://docs.cardano.org/cardano-testnets/tools/faucet) | reCAPTCHA (API needs a key) | 3 tADA (1 ADA output + change + fee) | `balances.mjs` (Koios); [preprod.cardanoscan.io](https://preprod.cardanoscan.io/address/addr_test1qrmlfjtxatttuphcnyz4f0jvw9mkaajxjrj76h0v884z7lvpvnak9dtlh4cmcxx65rtl3dz9cfkcfmz8kz06qzdxch8qv5dr79) |
| Substrate | Westend (relay) | `5Gj64MPAV7C2ezdS5tpq4fVgDYteHCptB62RFxvaVyECHCQb` | [faucet.polkadot.io](https://faucet.polkadot.io) (choose Westend, relay chain) | reCAPTCHA | 2 WND | `balances.mjs`; [westend.subscan.io](https://westend.subscan.io/account/5Gj64MPAV7C2ezdS5tpq4fVgDYteHCptB62RFxvaVyECHCQb) |
| Starknet | Sepolia | `0x014ff78c22689465708f38822fe1cc843d857e3b29647ba01908074e65d8e6b8` (OpenZeppelin account, deployed by its first transaction) | [faucet.starknet.io](https://faucet.starknet.io) | Bot protection / captcha (GitHub for more) | 0.1 STRK (pays the account deploy too) | `balances.mjs`; [voyager](https://sepolia.voyager.online/contract/0x014ff78c22689465708f38822fe1cc843d857e3b29647ba01908074e65d8e6b8) |
| TON | Testnet | `0QBQBJfGnfXxWzVRhBaupSxxbZH81iSAlSPw7YdZNopaaXFi` (wallet v5r1, deployed by its first transfer) | [@testgiver_ton_bot](https://t.me/testgiver_ton_bot) | Telegram account + captcha | 0.2 GRAM (the coin was renamed from TON; deploys the wallet too) | `balances.mjs` (toncenter); [testnet.tonviewer.com](https://testnet.tonviewer.com/0QBQBJfGnfXxWzVRhBaupSxxbZH81iSAlSPw7YdZNopaaXFi) |
| NEAR | Testnet | `1641bf02168b03b9bd0cae9c1892095688a55b624b93cce04223aac388e3f272` (implicit account: exists once funded) | [near-faucet.io](https://near-faucet.io) | Wallet login | 0.1 NEAR | `balances.mjs`; [testnet.nearblocks.io](https://testnet.nearblocks.io/address/1641bf02168b03b9bd0cae9c1892095688a55b624b93cce04223aac388e3f272) |
| Stellar | Testnet | `GB4NG3E6SHS5PKVVIRSYJZFG5GKLBLHLR7B46F2HJF5L2FZIKGYBVYVJ` | Friendbot `https://friendbot.stellar.org/?addr=<address>` | **API-only** (no captcha, account or terms) | 1.5 XLM (1 XLM base reserve + fees) | **Funded by me:** 10,000 XLM, tx `dba9d0ba3d6f0394bd172b4b51cab4e1be9d47c845b590382a70ce869bb172d2` |
| Tezos | Shadownet (ghostnet is retired) | `tz1YwrrznvbVETNaxxfqZrtbStX5tBFfVJud` | [faucet.shadownet.teztnets.com](https://faucet.shadownet.teztnets.com) | Proof-of-work challenge in the page (bot protection: not done by me) | 1 XTZ (first operation also reveals the key) | `balances.mjs`; [shadownet.tzkt.io](https://shadownet.tzkt.io/tz1YwrrznvbVETNaxxfqZrtbStX5tBFfVJud) |
| Algorand | TestNet | `4BSAZBB73QMGRVOUSB7YIFKHKKZ5CDBH2PWDTZGWSLCXU7ID67DLM2C7V4` | [lora.algokit.io/testnet/fund](https://lora.algokit.io/testnet/fund) (AlgoKit TestNet Dispenser) | Login (the dispenser API needs an access token) | 0.2 ALGO (0.1 minimum balance + fees) | `balances.mjs`; [lora](https://lora.algokit.io/testnet/account/4BSAZBB73QMGRVOUSB7YIFKHKKZ5CDBH2PWDTZGWSLCXU7ID67DLM2C7V4) |

### Cardano: which address

Fund the **base address** above (`addr_test1qrmlf…`). It is what the wallet shows on Receive, what CIP-30
`getUsedAddresses` / `getChangeAddress` return, and where change goes. An earlier version of `dapp-matrix-balances.mjs`
printed a "MISMATCH" with the enterprise address `addr_test1vrmlf…`: that was the tool deriving from the payment key
alone, not the wallet. Coins sent to the enterprise address are still found and spent (same payment key), but don't use
it.

### What I requested myself

| Faucet | Result |
| --- | --- |
| Stellar Friendbot (API-only) | Funded, 10,000 XLM |
| Solana devnet `requestAirdrop` (API-only) | Refused: HTTP 429, airdrop limit reached or faucet dry. Use faucet.solana.com |
| Sui faucet v2 API | Refused: `CI compatibility is disabled` (web only now) |
| Aptos testnet mint API | Refused: needs a login JWT |

Nothing else was attempted: every other official faucet needs a login, a captcha, a proof-of-work challenge or a
Telegram account.

### Hedera: what to send where

Both Hedera rows are this matrix's wallet, on Hedera testnet:

- `0xa3a5…Fc92` is the wallet's **Hedera** account (key `m/44'/3030'/0'/0/0`). Sending HBAR to the alias creates a
  `0.0.x` account. Used by the WalletConnect / HashConnect path (the L3 transfer pays 1 tinybar from it to the other
  account: Hedera refuses transfers to yourself).
- `0x05AC…2717` is the wallet's **EVM** account (key `m/44'/60'/0'/0/0`). Injected EIP-1193 dapps on chain 296 see this
  account, as they would with MetaMask. Send to it as an EVM address (the portal faucet accepts both).

10 HBAR each is plenty; 2 HBAR each is the floor the matrix checks for.

## networks87 accounts (2026-10-06)

Account 0 of the new families, derived from the same matrix phrase (public keys in `addresses.json`; `node
scripts/dapp-matrix-balances.mjs` re-derives every address with the family's own chain module: all "ok"). Addresses
are spelled for the testnet. I used only plain public APIs with no captcha, account or terms (Hiro's STX faucet API,
the XRPL testnet faucet API); everything else, and every account creation, is for you.

| Target | Testnet | Receive address | Faucet | What the faucet needs | Matrix minimum | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Stacks | testnet | `ST1EC4TTQPQX24TT3VY2H6YYW99N0HRQ5VMRB2M1T` | `POST https://api.testnet.hiro.so/extended/v1/faucets/stx?address=…` | **API-only** | 0.01 STX | **Funded by me:** 500 STX, tx `0x5fa11ca9fd59c0900a9d6bf45589ca310993d20c1999f9d596d04fa6ab151cd3`; L3 passed |
| XRP Ledger | testnet | `rDvWLtQL3Furv3sVzERai1MXvKFTQjZgrM` | `POST https://faucet.altnet.rippletest.net/accounts {"destination":"r…"}` | **API-only** | 1.1 XRP (1 XRP reserve + fees) | **Funded by me:** 100 XRP, tx `7207EF46614D51E4134F93EFAC19E4FF8E1CCAF2789102933D82307631D976EB`; L3 passed |
| Cosmos (Osmosis) | osmo-test-5 | `osmo1re86ed5ck45dnyex8ajvytrae4c5ct7xjm6edd` | [faucet.testnet.osmosis.zone](https://faucet.testnet.osmosis.zone) | Cloudflare Turnstile captcha | 0.1 OSMO | **You fund this** |
| TRON | Nile | `TGZxYSGcQHaZMcSB2c7ZB1n97yMk2UPz41` | [nileex.io/join/getJoinPage](https://nileex.io/join/getJoinPage) | Turnstile captcha | 2 TRX | **You fund this** |
| Fuel | testnet | `0x1Cc3e8E1B340846d9Eb275D51435189deDe13f20801bbc3693B2D04c1B322A75` | [faucet-testnet.fuel.network](https://faucet-testnet.fuel.network) | Cloudflare challenge | any ETH (0.0000002) | **You fund this** |
| Chainflip | Perseverance | `cFNXs2hYYRhGp1A4AfXaTbK3vQSgnSLvtvJrvJrCbNvhtTKc1` | tFLIP (ERC-20 on Sepolia `0xdC27c60956cB065D19F08bb69a707E37b36d8086`) from the Chainflip Discord, then fund the State Chain account at [auctions.perseverance.chainflip.io](https://auctions.perseverance.chainflip.io) from the matrix EVM account (it has Sepolia ETH) | Discord account | 0.1 FLIP | **You fund this** |
| MultiversX | devnet | `erd1qhkcc53w80nppnsprtzs7k2wh7xwvt54c8u88d0cd6pn3n6ldudshmqgfg` | [devnet-wallet.multiversx.com](https://devnet-wallet.multiversx.com) faucet (r3d4.fr/faucet untested) | Logged-in wallet + reCAPTCHA | 0.01 EGLD | **You fund this** |
| Initia | initiation-2 | `init1qkkdq25wrrqnpkgzldejhd4dytdy7fch0qn2v7` | [app.testnet.initia.xyz/faucet](https://app.testnet.initia.xyz/faucet) | Turnstile captcha | 0.1 INIT | balance only (no matrix page) |
| Provenance | pio-testnet-1 | `tp16f3hw77j3vwa3chtnplx3qs4sn2z4ww0cdzgzd` | none: the explorer faucet reached end of life | n/a | 1 HASH | no public faucet found |
| ICP | `icp:test` (DFINITY test ledgers on mainnet) | principal `gm6de-vncl6-w4cya-5z35g-cincb-f2zqe-6jhln-cnvjw-gvqf6-3shog-6ae` | [faucet.internetcomputer.org](https://faucet.internetcomputer.org) (10 TESTICP) | Web form (no login or captcha seen) | 0.001 TESTICP | **You fund this** (balance only) |
| Bitcoin Cash | chipnet | `bchtest:qq5jt8xqr6gckvpnn4dr4ajfd023mf7fzcj5tplmu2` | [tbch.googol.cash](https://tbch.googol.cash) | Image captcha | 5,000 sats | **You fund this** (balance only) |
| Antelope | Jungle4 | key `PUB_K1_7VxUN24cMwi94AHSbLkSnbKNfwoN8wjV4Fv1FA8W7bXQdTVzro` (no account yet) | account: `POST https://jungle4.greymass.com/account/create` (no captcha) or [monitor.jungletestnet.io](https://monitor.jungletestnet.io); tokens: Jungle4 faucet (reCAPTCHA). Telos testnet: `POST https://api-dev.telos.net/v1/testnet/account` then `/faucet/<account>`; XPR testnet needs an e-mail code | Creating an account is yours to do | an account + 1 EOS + CPU | **You create the account** (balance only) |
| dYdX, ZIGChain | dydx-testnet-4, zig-test-2 | `dydx1re86ed5ck45dnyex8ajvytrae4c5ct7xne8dmg`, `zig1re86ed5ck45dnyex8ajvytrae4c5ct7xm2vmeh` | dYdX `POST faucet.v4testnet.dydx.exchange/faucet/native-token` (unverified); faucet.zigchain.com (Cloudflare challenge) | | | not matrix targets (same provider as Osmosis) |
| THORChain | none | `thor13pajudku86vd59c8wkr4ctwcxdy8qpnap6afpx` (mainnet) | no public testnet (stagenet uses real funds) | | | not testable without mainnet funds |

Then: `pnpm --filter @clip-wallet/extension matrix -- -g "matrix: (cosmos|tron|fuel|chainflip|multiversx)"`.
