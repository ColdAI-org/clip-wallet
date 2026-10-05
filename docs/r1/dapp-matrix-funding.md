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
