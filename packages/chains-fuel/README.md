# @clip-wallet/chains-fuel

Fuel `ChainModule` for Clip Wallet. It builds, decodes and dry-runs Fuel transactions, and never touches keys.
`prepare()` returns the 32-byte digest a Fuel signature covers (the transaction id, or fuels-ts' message hash).
`finalize()` checks the vault's signature with `secp256k1.verify`, makes sure its recovery id recovers the account's
key (Fuel verifies by recovery), writes it as fuels-ts does (r ‖ s with the recovery id in the top bit of s), puts it
in the account's witness slots and submits.

No SDK at runtime: transactions are serialized by hand from the specs (`src/tx.ts`), fuel-core's GraphQL API is
called with plain `ctx.fetch` (`src/gql.ts`), and only `@noble/curves` / `@noble/hashes` are dependencies. `fuels`
(fuels-ts 0.103) is a devDependency: every serialization, transaction id, fee formula, address and message hash is
compared against it in the tests.

## Networks

| NetworkId | chain id | name | GraphQL (`rpcUrls[0]`) | explorer |
|---|---|---|---|---|
| `fuel:0` | 0 | Fuel Sepolia Testnet | https://testnet.fuel.network/v1/graphql | https://app-testnet.fuel.network |
| `fuel:9889` | 9889 | Ignition (mainnet) | https://mainnet.fuel.network/v1/graphql | https://app.fuel.network |

- There's no ChainAgnostic CAIP-2 namespace for Fuel. The Fuel connector standard names networks by their numeric
  chain id (fuels-ts `CHAIN_IDS.fuel`: mainnet 9889, testnet 0, devnet 1119889111; @fuels/connectors uses the same
  table), so the ids are `fuel:<chain id>`.
- Chain ids, names and base asset verified with `{ chain { name consensusParameters { chainId baseAssetId } } }` on
  both endpoints (fuel-core 0.48.3, Oct 2026).
- `fuelNetOf()` accepts the id, the chain id (number or string) or a known GraphQL URL.

Assets (Fuel's verified-assets list, https://verified-assets.fuel.network/assets.json):

- The base asset is ETH (asset id `0xf8f8…ad07` on both networks, 9 decimals): key `eth` on mainnet, `eth-testnet` on
  the testnet (the same keys chains-evm and chains-starknet use).
- USDC (`usdc.e`), USDT (`usdt.e`) and FUEL (`fuel`) are minted by Fuel's canonical bridge (contract `0x4ea6…d0e8` on
  mainnet, `0xd021…5471` on testnet), so they're bridged copies (`bridged: true`, own keys). Testnet has USDC and FUEL.
- `getBalances` returns ETH (0 when empty) and the curated tokens only; anything else anyone can mint stays out.
  `getNfts` returns `[]`.

## Accounts and addresses

- `derivationPath(i)` = `m/44'/1179993420'/i'/0/0` (Fuel Wallet, fuels-ts `WalletManager`), secp256k1.
- The address is SHA-256 of the 64-byte uncompressed key (no 0x04), shown with the fuels-ts checksum
  (`Address.toChecksum`). The "abandon … about" accounts 0 and 1 are `0x806E…5b89` and `0x033d…5E17`, the same as
  fuels-ts `Wallet.fromMnemonic`.
- `isAddress` takes 0x + 64 hex: all lower case or all upper case, or exactly the checksum (a mistyped case is
  refused). The old bech32 `fuel1…` form was removed from fuels-ts and isn't accepted.
- One address for every Fuel network; no `receiveAddress` needed.

## Requests (`FUEL_METHODS`)

They mirror the signing calls of the Fuel connector standard, so 1Mask's Fuel connector passes them through.

| method | params | result |
|---|---|---|
| `fuel_sendTransaction` | `{ address, transaction, provider?: { url } }` | the transaction id (`0x…`) after `submitAndAwaitStatus` |
| `fuel_signTransaction` | same | the signed request as fuels-ts TransactionRequest JSON (what Fuel Wallet returns; `transactionRequestify` reads it) |
| `fuel_signMessage` | `{ address, message }` | `0x` + 64-byte signature (r ‖ s, recovery id in s's top bit) |

- `transaction` is `JSON.stringify(transactionRequest)` of a fuels-ts ScriptTransactionRequest (object or text), as
  the Fuel Wallet connector sends it: BN fields as 0x-hex, bytes as 0x-hex. The request's `flag` (the dapp's own
  dry-run summary) is ignored.
- `message` is `{ text }` (a plain string), `{ personalSign }` (text) or `{ personalSignHex }` (bytes). fuels-ts
  `hashMessage`: a plain string is SHA-256 of its UTF-8 with no prefix; `personalSign` is SHA-256 of
  `"\x19Fuel Signed Message:\n" + length + bytes`.
- `address`, when given, must be this account. A `provider.url` that is another Fuel network's endpoint is refused
  (`fuel/network-mismatch`), as is a request whose `networkId` isn't the connected network.
- `buildTransfer` returns `fuel_sendTransaction` with `origin: WALLET_ORIGIN`.

## Building a transfer

`buildTransfer({ asset, to, amount })` (ETH or a token by asset id):

1. `chain { consensusParameters }` (checked against the network's chain id) and `estimateGasPrice(blockHorizon: "10")`.
2. `coinsToSpend` for the amount (+ the fee budget in ETH). Coins and message coins become inputs with witness 0.
3. Outputs: a Coin output to the recipient, a Change output to you for the asset, and one for ETH when sending a token.
4. Script: fuels-ts' `returnZeroScript` (`0x24000000`, RET $zero). Its gas is measured with a dry run at gas price 0
   (64 gas today); that becomes the script gas limit.
5. `max_fee` from the spec formula (`src/fee.ts`, equal to fuels-ts `getMinGas`/`getMaxGas`) with a 64-byte witness
   placeholder: `ceil(max_gas · gas_price / gas_price_factor) + tip + 1`. If the coins don't cover amount + fee, it
   asks again with a bigger budget (four rounds at most).

The transaction id is SHA-256(chain id u64 ‖ the transaction with receipts root, tx pointers, predicate gas used,
contract input/output roots, change and variable output amounts zeroed and no witnesses). A transfer built this way
on the testnet was signed with the vault's `signEcdsa` and passed `dryRun(utxoValidation: true)`, and one went
through fuels-ts `Fuel` → 1Mask's connector → this module → `submitAndAwaitStatus` (testnet tx
`0x5717…9db6`).

## decode()

- Your coins are coin inputs you own (no predicate) and message coins addressed to you; you sign the witness slots
  they name. No such input → `fuel/not-a-signer`.
- Script `0x24000000` with no script data, no contract inputs and no data messages (a plain transfer): fully read
  from inputs and outputs, no network call. "Send 1.5 USDC to 0x033d…5e17", one "To" line per Coin output, "Network
  fee at most" (the `max_fee` policy), balance changes = what leaves you minus Coin outputs to you and your Change.
- Any other script, or contract inputs: the outcome isn't knowable from outputs alone, so it's dry-run
  (`dryRun(utxoValidation: false, gasPrice: 0)`). CALL / TRANSFER / TRANSFER_OUT receipts from the script itself
  are what it spends; TRANSFER_OUT to you is what contracts send you. Title "Approve a smart contract action for
  <host>", a "Contract" line per contract, `simulated: true`, caution `unknown-call`.
- Dry run fails, or `simulate: false` → `blind: true` with `simulation-failed` (the node's raw reason isn't shown).
- Predicate inputs, or a transaction that isn't a Script (Create, Upgrade, Upload, Blob) → `blind: true`.
- A Change output for your asset that goes to someone else → danger ("Everything left of your ETH after this goes
  to …"). Your asset with no Change output → danger with what would be lost.
- `max_fee` above 0.001 ETH → caution `high-fee` (danger above 0.01 ETH). `expiration` → "Valid until block N".
- `fuel_signTransaction` adds "Sent by <host> (it gets the signed transaction)".
- Messages: "Sign a message for <host>" with the text. A plain string that isn't readable text is blind: it is hashed
  with no prefix, and readable text can't be the preimage of a transaction id (that starts with the 8-byte chain id,
  whose first byte is 0x00). `personalSign` bytes are shown as hex with a warning (the prefix keeps them from being
  a transaction).

## Errors

Plain words with `fuel/…` codes, never the node's text: `fuel/insufficient-funds`, `fuel/bad-address`,
`fuel/self-transfer`, `fuel/bad-amount`, `fuel/network-mismatch`, `fuel/not-your-account`, `fuel/not-a-signer`,
`fuel/malformed`, `fuel/unsupported-method`, `fuel/bad-signature`, `fuel/coins-spent` (a UTXO was already spent),
`fuel/fee-too-low` (`InsufficientMaxFee`), `fuel/failed` (reverted on chain: only the fee was spent),
`fuel/rejected`, `fuel/offline`, `fuel/too-many-inputs`.

## Dapps

1Mask's Fuel connector (`packages/1mask/src/inpage/fuel.ts`) implements the Fuel connector standard (fuels-ts
`FuelConnector`) without bundling fuels-ts, announces itself with the `FuelConnector` window event under the wallet's
own name and icon, and is also at `window.clipwallet.fuel`. `test/connector.test.ts` runs it under the real fuels-ts
`Fuel` manager with this module behind it.

## Testnet faucet

https://faucet-testnet.fuel.network/ (behind a Cloudflare interactive challenge, so it needs a person in a browser).
