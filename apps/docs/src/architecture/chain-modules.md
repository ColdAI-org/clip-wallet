# Chain modules

A chain module knows one family of networks: how its addresses look, how to read balances and NFTs, how to turn a
request into plain words, what exactly to sign and how to send the result. It never sees a key. Each one lives in its
own package, `packages/chains-<family>`, and implements `ChainModule` from `@clip-wallet/core`.

## The interface

| Member | What it does |
| --- | --- |
| `family`, `curve` | Which family, and which curve its keys use (`secp256k1`, `ed25519`, `bip32-ed25519`, `sr25519`, `stark`) |
| `derivationPath(index)` | The path the vault derives account `index` at, for display and hardware wallets |
| `addressFromPublicKey(publicKey, network)` | Address encoding |
| `isAddress(value)` | Does this string look like an address of the family? |
| `networksForAddress(value, candidates)` | Which networks an address could belong to; more than one means "network matters" |
| `getBalances(ctx)`, `getNfts(ctx)` | Reads, through the family's RPCs and indexers |
| `decode(request, ctx)` | The `DecodedRequest`: title, lines, balance changes, fee, warnings, `blind`. Simulates where the network allows. |
| `prepare(request, ctx, approvalId)` | The `SignablePayload`s the vault must sign |
| `finalize(request, signatures, ctx)` | Assemble, broadcast if the method asks for it, and return what the dapp expects |
| `buildTransfer({ asset, to, amount }, ctx)` | The wallet's own Send as a `DappRequest`, so it goes through the same approval |

`ChainContext` carries the `network`, the `account` (with its public key and address), a `fetch`, and for Bitcoin
the change-address helpers. A module that can't decode something throws a `ClipError` with plain words, or returns
`blind: true`; either way the approval is blocked unless the person overrides it.

How to write one, step by step with a complete example: [Write a chain module](../extend/chain-module.md).

## The modules

One package per family; the Cosmos SDK package serves four families (cosmos, provenance, thorchain, initia) and
the Antelope package three chains. Every network and its CLPR status: [Networks](../reference/networks.md).

| Family | Package | Factory | Test networks | Dapp standard |
| --- | --- | --- | --- | --- |
| EVM | `@clip-wallet/chains-evm` | `createEvmModule()` | Sepolia, Base Sepolia, Arbitrum Sepolia, OP Sepolia, Arc, Hedera EVM, others by chain id | EIP-1193 + EIP-6963 |
| Hedera | `@clip-wallet/chains-hedera` | `createHederaModule()` | Hedera testnet | WalletConnect (`hedera_*`) |
| Solana | `@clip-wallet/chains-solana` | `createSolanaModule()` | Devnet | Wallet Standard |
| Bitcoin | `@clip-wallet/chains-bitcoin` | `createBitcoinModule()` | Testnet4 | Wallet Standard, sats-connect (PSBT) |
| Sui | `@clip-wallet/chains-sui` | `createSuiModule()` | Testnet | Wallet Standard |
| Aptos | `@clip-wallet/chains-aptos` | `createAptosModule()` | Testnet | AIP-62 |
| Cardano | `@clip-wallet/chains-cardano` | `createCardanoModule()` | Preprod, Preview | CIP-30 |
| Polkadot SDK | `@clip-wallet/chains-substrate` | `createSubstrateModule()` | Westend, Paseo and their Asset Hubs | `injectedWeb3` |
| Starknet | `@clip-wallet/chains-starknet` | `createStarknetModule()` | Sepolia | get-starknet |
| TON | `@clip-wallet/chains-ton` | `createTonModule()` | Testnet | TON Connect |
| NEAR | `@clip-wallet/chains-near` | `createNearModule()` | Testnet | NEAR Connect, Wallet Selector |
| Stellar | `@clip-wallet/chains-stellar` | `createStellarModule()` | Testnet | SEP-43 |
| Tezos | `@clip-wallet/chains-tezos` | `createTezosModule()` | Shadownet | Beacon |
| Algorand | `@clip-wallet/chains-algorand` | `createAlgorandModule()` | TestNet | ARC-1, use-wallet |
| Cosmos SDK | `@clip-wallet/chains-cosmos` | `createCosmosModule()` | osmo-test-5, dydx-testnet-4, zig-test-2, pio-testnet-1, initiation-2 (THORChain: none) | Keplr-compatible API |
| TRON | `@clip-wallet/chains-tron` | `createTronModule()` | Nile, Shasta | TIP-1193 + TIP-6963 |
| XRP Ledger | `@clip-wallet/chains-xrpl` | `createXrplModule()` | Testnet, Devnet | XLS-72d (Wallet Standard) |
| Stacks | `@clip-wallet/chains-stacks` | `createStacksModule()` | Testnet | SIP-030 + WBIP-004 |
| Fuel | `@clip-wallet/chains-fuel` | `createFuelModule()` | Testnet | FuelConnector |
| Bitcoin Cash | `@clip-wallet/chains-bitcoincash` | `createBitcoinCashModule()` | Chipnet, Testnet4 | WalletConnect (wc2-bch-bcr) |
| MultiversX | `@clip-wallet/chains-multiversx` | `createMultiversXModule()` | Devnet, Testnet | best effort (sdk-dapp hook) |
| Internet Computer | `@clip-wallet/chains-icp` | `createIcpModule()` | `icp:test` (DFINITY test ledgers) | none: send and receive |
| Antelope | `@clip-wallet/chains-antelope` | `createAntelopeModule()` | Jungle4, Telos testnet, XPR testnet | none: send and receive |

Each package also exports its networks (most at `@clip-wallet/chains-<family>/networks`) and its token tables. The
catalogue in [`packages/engine/src/catalog.ts`](repo:packages/engine/src/catalog.ts) assembles them for a wallet,
filtered by `clip.config.ts` and limited to test networks unless mainnet is switched on with its checklist.

## What "decode" means in practice

Each module explains requests in words a person can check against what they meant to do:

- **Transfers** name the amount, the asset and the recipient ("Send 25 USDC to 0x12…ab"); a self-transfer says so.
- **Approvals and permits** say who could spend what, and **unlimited** ones say so loudly (`unlimited-approval`,
  `approval-for-all`, `permit`).
- **Messages** show the text; sign-in messages (SIWE, Sign In With Solana) check that the domain matches the site.
- **Account changes** that hand over control are `danger` warnings (`account-takeover`: Algorand rekey, NEAR
  full-access keys, Stellar signer changes; `account-closure`).
- **Simulation** shows the real balance changes where the network can dry-run (EVM `eth_simulateV1`, Solana, Sui,
  Aptos, Starknet, Stellar Soroban…). A failed preview is a `simulation-failed` warning, never silence.
- **Anything unreadable** is blind.

Every warning code and its message is listed in the [warning reference](../reference/warnings.md).

## Rules for modules

- Depend on `@clip-wallet/core`, never on the vault (`pnpm harness` checks the imports and `package.json`).
- `@noble/curves` only for verification and public-key maths.
- Tests use fixtures and signatures precomputed offline from the public "abandon … about" account; never generate
  or embed keys.
- Errors are `ClipError(userMessage, code)` with plain words and a next step, never a raw RPC error.
