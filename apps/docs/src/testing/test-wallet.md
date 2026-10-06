# Fund a test wallet

Clip Wallet runs on test networks. Test tokens are free and have no value; you get them from each network's faucet.

::: danger Never use a real wallet for testing
Use a wallet made for testing only, and never import a recovery phrase that has ever held real funds. Never paste a
phrase into a chat, an issue, a commit or a screenshot. These docs never show one.
:::

## For trying the wallet

1. Load the extension (see [Run it locally](../guide/quickstart.md)) and choose **Create a new wallet**. Write the
   phrase down on paper; it is a test wallet, but treat it like a real one.
2. Open **Receive** for the asset you want. Copy the address it shows.
3. Ask the faucet for test tokens:

| Network | Faucet | Needs |
| --- | --- | --- |
| Ethereum Sepolia | [Google Cloud Web3 faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) (also Alchemy, Infura) | an account |
| Hedera testnet | [Hedera portal faucet](https://portal.hedera.com/faucet) | an account |
| Solana devnet | [faucet.solana.com](https://faucet.solana.com) | a GitHub login |
| Bitcoin testnet4 | [mempool.space testnet4 faucet](https://mempool.space/testnet4/faucet) | an account |
| Sui testnet | [faucet.sui.io](https://faucet.sui.io/?network=testnet) | the web page |
| Aptos testnet | [aptos.dev faucet](https://aptos.dev/network/faucet) | a login |
| Cardano preprod | [Cardano testnet faucet](https://docs.cardano.org/cardano-testnets/tools/faucet) | a captcha |
| Westend | [faucet.polkadot.io](https://faucet.polkadot.io) (choose Westend) | a captcha |
| Starknet Sepolia | [faucet.starknet.io](https://faucet.starknet.io) | a captcha |
| TON testnet | the testgiver bot on Telegram | Telegram |
| NEAR testnet | [near-faucet.io](https://near-faucet.io) | a wallet login |
| Stellar testnet | Friendbot: `https://friendbot.stellar.org/?addr=<address>` | nothing |
| Tezos shadownet | [faucet.shadownet.teztnets.com](https://faucet.shadownet.teztnets.com) | a proof-of-work challenge |
| Algorand TestNet | [Lora TestNet dispenser](https://lora.algokit.io/testnet/fund) | a login |

A few families need the account to exist before it can do anything: NEAR implicit accounts, Stellar and Aptos accounts
exist once funded; Starknet and TON deploy the account with its first transaction (so fund a little more); Hedera creates
the `0.0.x` account when the first HBAR reaches its address.

**Hedera has two addresses.** Clip's Hedera account and its EVM account are different keys. Dapps on chain 296
(EIP-1193) use the EVM account; the native Hedera account (WalletConnect, Home's balance) is the other. Fund the one
you'll use. See [Hedera](../dapps/hedera.md).

**Cardano:** fund the base address Receive shows (`addr_test1q…`).

## For the testnet matrices

The [dapp and picker matrices](./matrices.md) import their own dedicated wallet into the extension's onboarding.

1. Create a new wallet in a freshly built extension (or with the vault's own code) and keep its phrase **only** in a
   file named `.env.dapp-matrix` at the repository root:

   ```sh
   # .env.dapp-matrix: TESTNET-ONLY throwaway wallet. Never commit, print or screenshot.
   DAPP_MATRIX_MNEMONIC=<your test wallet's phrase>
   WALLETCONNECT_PROJECT_ID=<optional: your Reown project id>
   ```

   `.gitignore` already covers `.env.*`, and `pnpm harness` fails if one is ever tracked. Set `DAPP_MATRIX_ENV_FILE` to
   keep it elsewhere. Worktrees find the main checkout's file.
2. Put the wallet's public addresses and public keys (account 0 per family) in
   `apps/extension/e2e/matrix/addresses.json`: the matrix checks every dapp's connect returns exactly these, and the
   balance script reads them. They are public data; the phrase never goes there.
3. Fund each address from the faucets above, at least the matrix's minimum for that family, and watch it land:

   ```sh
   node scripts/dapp-matrix-balances.mjs --watch    # re-checks every 30 s until every account has its minimum
   ```

The matrix reads the phrase from the file, types it into onboarding and drops it; it never logs it, and the run keeps
traces, screenshots-on-failure and video off. The minimum per family and the faucets that worked last time are in
[`docs/r1/dapp-matrix-funding.md`](repo:docs/r1/dapp-matrix-funding.md).
