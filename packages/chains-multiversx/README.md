# @clip-wallet/chains-multiversx

MultiversX `ChainModule` for Clip Wallet. It builds, decodes and dry-runs EGLD and ESDT transactions, and it never
touches keys. `prepare()` returns the exact bytes a MultiversX ed25519 signature covers. `finalize()` checks the vault's
signature with `ed25519.verify` before it sends anything.

There's no SDK at runtime. The package uses hand-written serialization with `@noble/curves` (verify only),
`@noble/hashes` (keccak) and `@scure/base` (bech32). `@multiversx/sdk-core` is a devDependency: the tests check the
bytes against it.

## Networks

| NetworkId | chain ID | gateway (`rpcUrls[0]`) | API (`indexerUrl`) | explorer |
|---|---|---|---|---|
| `mvx:D` (devnet, testnet flag) | `D` | https://devnet-gateway.multiversx.com | https://devnet-api.multiversx.com | https://devnet-explorer.multiversx.com |
| `mvx:T` (testnet, testnet flag) | `T` | https://testnet-gateway.multiversx.com | https://testnet-api.multiversx.com | https://testnet-explorer.multiversx.com |
| `mvx:1` (mainnet) | `1` | https://gateway.multiversx.com | https://api.multiversx.com | https://explorer.multiversx.com |

- **Ids.** These are the ChainAgnostic `mvx` namespace ids (Draft: `mvx/caip2.md`), resolved from `erd_chain_id`. They're also the
  chain ids of MultiversX's WalletConnect namespace `mvx`.
- **Checked live.** On 2026-10-06 every gateway answered `GET /network/config` without a key. Each reported min gas price
  1,000,000,000, min gas limit 50,000, 1,500 gas per data byte and gas price modifier 0.01. Every API answered `/about`.
- **Devnet first.** Devnet is listed first because MultiversX's faucet and dapps' test deployments are there.
- **Asset keys.**
  - EGLD is `egld` (18 decimals).
  - USDC is `usdc.mvx` and marked `bridged`. MultiversX USDC is Ethereum USDC moved over a bridge ("WrappedUSDC"),
    so it never merges with Circle's native USDC. It is `USDC-c76f1f` on mainnet and `USDC-350c4e` on devnet.
    `USDC-350c4e` is the devnet USDC with a registered assets entry and xExchange's EGLD/USDC pool. The other devnet
    `USDC-*` tokens are unbranded copies.
  - Testnet has no known USDC.
  - Other ESDTs are `esdt:<identifier>`.
- **Spam.** An ESDT is marked `spam` if it isn't registered in the MultiversX assets repository (no `assets` in the
  API), or if it calls itself USDC, USD or EGLD without being the real one.

## Accounts and addresses

- **Derivation.** `derivationPath(i)` = `m/44'/508'/0'/0'/i'`: SLIP-10 ed25519, all hardened. This is what xPortal, the
  DeFi Wallet extension and sdk-core `Mnemonic.deriveKey(i)` use.
- **Addresses.** `addressFromPublicKey` returns `erd1…`, which is bech32 of the 32-byte key.
- **Validation.** `isAddress` checks the bech32 checksum and the `erd` prefix. Contracts (`erd1qqqqqqqqqqqqqpgq…`)
  are valid addresses too.
- **Cross-check.** The fixtures are the public "abandon … about" account `erd1sqhjrt…ytny9g`. `packages/vault`
  cross-checks the derivation with sdk-core.

## Methods (`MULTIVERSX_METHODS`)

The names and params are those of MultiversX's WalletConnect provider (`mx-sdk-js-wallet-connect-provider`,
`src/operation.ts` and `src/walletConnectV2Provider.ts`).

| method | params | result |
|---|---|---|
| `mvx_signTransaction` | `{ transaction }` (sdk-core plain object) | `{ signature, transaction }` (signed plain object) |
| `mvx_signTransactions` | `{ transactions: [...] }` (up to 20) | `{ signatures: [{ signature }], transactions }` |
| `mvx_signMessage` | `{ message, address }` | `{ signature, address }` (hex) |
| `mvx_signAndSendTransactions` | `{ transactions }` (Clip Wallet's own; wallet-built requests only) | `{ txHash, txHashes, status: "success" }` |

**Refusals:**
- A transaction whose `sender` isn't this account → `multiversx/wrong-account`.
- A `chainID` that isn't this network's → `multiversx/network-mismatch`.
- `mvx_signLoginToken`, `mvx_signNativeAuthToken` and `mvx_cancelAction` aren't supported yet →
  `multiversx/unsupported-method`.

### What gets signed (`prepare`)

- **Transactions.** The bytes are the UTF-8 JSON of sdk-core's `TransactionComputer.toPlainObject(tx)`, which is what
  `computeBytesForSigning` produces.
  - Fields come in this order: nonce, value (string), receiver, sender, senderUsername, receiverUsername, gasPrice,
    gasLimit, data (base64), chainID, version, options, guardian, relayer.
  - Empty fields are left out, and `options: 0` is left out.
  - If options bit 0 (hash signing) is set, the bytes are `keccak256` of that JSON instead, as `computeBytesForVerifying`
    does.
  - Guardian and relayer addresses are part of the signed bytes. Their own signatures are carried through untouched.
- **Messages.** The bytes are `keccak256("\x17Elrond Signed Message:\n" ‖ decimal byte length ‖ message)`, from sdk-core
  `MessageComputer`. The message is taken as UTF-8 text.
- **Tests.** They check every case against sdk-core: plain, ESDT, usernames + guardian + relayer + hash signing,
  version 1 with a note, and `MessageComputer`.
- **Live check.** The devnet gateway's `/transaction/simulate?checkSignature=true` accepted our signatures for both
  normal and hash signing, and refused a flipped bit as `ed25519: invalid signature`.

### Sending (`finalize`)

1. Each signature is verified against the account's key first. A bad or missing signature →
   `multiversx/bad-signature`, and nothing is sent.
2. The transactions go one at a time to `POST /transaction/send`.
3. After each one, `GET /transaction/{hash}/process-status` is polled (default 10 × 1.5 s). process-status is used
   instead of `/transaction/{hash}?withResults=true` because it follows asynchronous cross-shard calls: a call whose
   callback failed reports `fail` there, while `withResults` still says `success`.
   - `fail` or `invalid` → a plain `ClipError` (`multiversx/transaction-failed`).
   - Still pending after the last poll → the transaction was accepted, and the hash is returned.
4. Gateway rejections become plain words (`plainMultiversXError`): insufficient funds, a used nonce, a nonce too far
   ahead, the wrong chain ID, not enough gas, a low gas price, a missing guardian co-signature, a busy pool, or a
   rejected signature.

## decode()

Each request shows the full recipient, the token identifier, "Network fee: up to X EGLD" and "Sent by" (for
`mvx_sign*`, since the app gets the signed transaction).

**The fee.** `TransactionComputer.computeTransactionFee` defines it as: (50,000 + 1,500 × data bytes) gas at the full
gas price, plus the rest of the gas limit at gas price × 0.01. Refunds can make the real fee lower. A relayed
transaction (one with a `relayer`) has its fee shown as sponsored.

**Dry run.** Single transactions are dry-run with `POST /transaction/simulate?checkSignature=false`, using a zero
placeholder signature (the node accepts one when signature checks are off). A success marks the request
`simulated`. A failure adds a `simulation-failed` caution.

| data field | title | warnings |
|---|---|---|
| empty | "Send 1.5 EGLD to erd1sxm…kwzk" | |
| text, to a person | the same, plus a "Note" line (exchanges use the data field as a memo) | |
| `ESDTTransfer@token@amount` | "Send 2.5 USDC to …" | look-alike USDC/EGLD → danger `known-scam` |
| `ESDTNFTTransfer@token@nonce@amount@dest` (to self) | "Send NFT #5 from NICENFT to …", or fungible amounts | |
| `MultiESDTNFTTransfer@dest@n@(token@nonce@amount)×n` (to self) | "Send 1 EGLD + 1 WEGLD + 1 × NICENFT #5 to …" (`EGLD-000000` = EGLD) | |
| a token payment followed by a function | "Approve {fn} on contract …" with "Also sends" | caution `unknown-call` |
| staking provider: `delegate` | "Stake 1 EGLD with castlestake" (provider identity from the API) | |
| `unDelegate@amount` / `claimRewards` / `withdraw` / `reDelegateRewards` | "Unstake 1 EGLD from …" / "Claim your staking rewards from …" / "Withdraw your unstaked EGLD from …" / "Restake your rewards with …" | |
| `SetGuardian@guardian@service` (to self) | "Make erd1… your account's guardian" | **danger `account-takeover`** |
| `GuardAccount` (to self) | "Turn on your account's guardian" | **danger `account-takeover`**: Clip Wallet can't provide the co-signature afterwards |
| `UnGuardAccount` (to self) | "Turn off your account's guardian" | |
| `ChangeOwnerAddress@owner` (to a contract) | "Give contract … to …" | **danger `account-takeover`** |
| any other `fn@args` to a contract | "Approve {fn} on contract erd1qqq…3rax" | caution `unknown-call` |
| anything else (binary data to a contract, unknown built-ins to yourself, malformed arguments) | "Approve an unreadable request from {host}" | `blind: true` + danger `blind-signing` |

**How contracts are recognised.** A staking provider is a system smart contract (`00…01…`) that isn't one of the
fixed system contracts (staking, ESDT, governance, delegation manager, …). Only the five delegation functions get
plain words there. Contracts are any address that starts with 8 zero bytes.

## Builders

- **Transfers.** `buildTransfer({ asset, to, amount })` → `mvx_signAndSendTransactions` with one transaction:
  - EGLD: an empty data field and gas 50,000.
  - ESDT: `ESDTTransfer@<identifier hex>@<amount hex>` and gas 50,000 + 1,500 × data bytes + 300,000. This is sdk-core's
    `gasLimitESDTTransfer` (200,000) plus `ADDITIONAL_GAS_FOR_ESDT_TRANSFER` (100,000).
  - The fields: version 2, options 0, the nonce from the gateway, and the network's minimum gas price.
- **Refusals:**
  - A bad address (`multiversx/bad-address`), your own address (`multiversx/self-transfer`), or a zero amount.
  - Not enough EGLD for the amount and fee (`multiversx/insufficient-funds`), or not enough of the token
    (`multiversx/insufficient-token`).
  - A guarded account (`multiversx/guarded`): its transactions need a guardian co-signature that Clip Wallet can't get.

## Balances and NFTs

- **`getBalances`.** EGLD comes from the gateway's `/address/{a}`. Fungible ESDTs come from the API's
  `/accounts/{a}/tokens` (MetaESDTs, such as LP or farm positions, are skipped), with spam marked as above.
- **`getNfts`.** It returns `[]` for now. The API lists NFTs and SFTs at `/accounts/{a}/nfts`.

## Dapp connectivity: a best-effort sdk-dapp provider (undocumented hook)

There's no documented way for a third-party browser-extension wallet to be discovered by MultiversX dapps under its own
identity. Sources (checked 2026-10-06):

- **sdk-dapp v5 has a fixed provider list.** `ProviderTypeEnum` is extension, metamask, passkey, walletConnect, ledger,
  crossWindow, webview or none (`mx-sdk-dapp` `src/providers/types/providerFactory.types.ts`). Custom providers are
  `ICustomProvider` objects (`{ name, type, iconUrl?, constructor(options) => Promise<IProvider> }`) passed to
  `initApp({ customProviders })`.
- **The extension provider is the MultiversX DeFi Wallet's own channel.** `mx-sdk-js-extension-provider` looks for
  `window.elrondWallet` / `window.multiversxWallet` and talks over `postMessage` targets `erdw-inpage` /
  `erdw-contentScript`. Answering it would mean posing as the DeFi Wallet (AGENTS rule 8), so 1Mask doesn't.
- **The other providers don't apply.** The webview provider is for dapps embedded in xPortal / Hub (iframe or React
  Native webview). The cross-window and iframe providers open a wallet URL that the dapp configures.

**What 1Mask does instead (best effort).** `initApp` also merges `window.multiversx?.providers` with the dapp's
`customProviders`, deduplicated by `type` (sdk-dapp 5.7.3 `out/methods/initApp/initApp.mjs`), and
`ProviderFactory.create({ type })` calls the matching entry's `constructor({ address, anchor })`, then `init()`
(`out/providers/ProviderFactory.mjs`). This hook is **UNDOCUMENTED** as a wallet channel: sdk-dapp's README presents it
as something the dapp sets, and MultiversX's template dapp replaces `window.multiversx`. So it works only on sdk-dapp
dapps that don't override it, and only while sdk-dapp keeps reading it.

- `packages/1mask/src/inpage/multiversx.ts` pushes Clip's own entry (type = the global key, "clipwallet"; the wallet's
  name and icon) onto that array, keeping the array and other wallets' entries, and exposes the provider at
  `window.clipwallet.multiversx`.
- `login({ token })` signs `address + token` as a MultiversX message: what sdk-native-auth-server verifies
  (`signedMessage = address + body`, MessageComputer). decode() shows it as "Sign in to {site}" with the token's
  origin, and a danger `domain-mismatch` warning if the token names another site; the 1Mask background refuses such a
  token outright.
- Transactions and messages go through `mvx_signTransactions` / `mvx_signMessage` above.
- Checked against the real sdk-dapp 5.7.3 (scratch run, happy-dom): `initApp` listed the entry,
  `ProviderFactory.create({ type: "clipwallet" })` + `login()` produced a native-auth token that
  `@multiversx/sdk-native-auth-server` validated against the devnet API, and the transaction and message signatures
  verified with sdk-core 15.

**WalletConnect** (namespace `mvx`, chains `mvx:1` / `mvx:D` / `mvx:T`) works across dapps without any hook: this module
decodes and signs those requests. Stock sdk-dapp labels any WalletConnect wallet "xPortal App", and always asks for
`mvx_signLoginToken`, which isn't wired yet.

**Dapp matrix** (`apps/extension/e2e/matrix/dapps/multiversx.ts`, devnet): sdk-dapp driven headless: `initApp` +
`ProviderFactory.create({ type: "clipwallet" })` + native-auth `login()` (L1), `signMessage` checked with sdk-dapp's
`verifyMessage` (L2), and a 1-attoEGLD self-transfer signed through `DappProvider.signTransactions` and sent to the devnet
gateway (L0, needs devnet EGLD).

## Faucet

The devnet wallet's Faucet tab (https://devnet-wallet.multiversx.com) gives 5 EGLD per 24 hours to accounts below
1 EGLD. It needs a logged-in wallet and a reCAPTCHA: `POST devnet-extras-api.multiversx.com/faucet {captcha}` with a
native-auth token, and `/faucet/settings` reports `recaptchaBypass: false`. The MultiversX docs also list
https://r3d4.fr/faucet.

## Known gaps

- The injected provider relies on sdk-dapp's undocumented `window.multiversx.providers` hook (see above).
- WalletConnect `mvx_signLoginToken` / `mvx_signNativeAuthToken` aren't handled.
- NFTs aren't listed. MetaESDT balances (LP, farm and staking positions) aren't shown.
- Guarded accounts can't send from Clip Wallet: the guardian co-signature (2FA service) isn't requested.
- Staked EGLD isn't shown as a balance.

## Tests

`test/multiversx.test.ts` uses no network.
- Byte-for-byte checks against `@multiversx/sdk-core` 16 (`TransactionComputer`, `MessageComputer`, `UserPublicKey.verify`).
- Decode cases for every row above, plus wrong network, account and method.
- The build → decode → prepare → finalize path with fixture signatures and a mocked gateway: send, failure,
  rejection, and a bad signature refused before broadcast.
- Signatures were precomputed offline from the public "abandon … about" vector (`test/signatures.ts`).

## Sources

- sdk-core: https://github.com/multiversx/mx-sdk-js-core: `src/core/transactionComputer.ts`, `src/core/message.ts`,
  `src/core/constants.ts`, `src/transfers/transferTransactionsFactory.ts`, `src/core/transactionsFactoryConfig.ts`
- CAIP-2: https://github.com/ChainAgnostic/namespaces/blob/main/mvx/caip2.md
- WalletConnect provider: https://github.com/multiversx/mx-sdk-js-wallet-connect-provider (`src/operation.ts`, `src/constants.ts`)
- sdk-dapp: https://github.com/multiversx/mx-sdk-dapp (`src/providers/ProviderFactory.ts`, `src/methods/initApp/initApp.ts`, README "custom providers")
- Extension provider: https://github.com/multiversx/mx-sdk-js-extension-provider (`src/extensionProvider.ts`)
- Webview provider: https://github.com/multiversx/mx-sdk-js-webview-provider
- Token transfers: https://docs.multiversx.com/tokens/fungible-tokens#transfers, https://docs.multiversx.com/tokens/nft-tokens#transfers
- Guardians: https://docs.multiversx.com/developers/built-in-functions#setguardian
- Gateway (proxy) API: https://docs.multiversx.com/sdk-and-tools/proxy, https://github.com/multiversx/mx-chain-proxy-go
- Faucet: https://github.com/multiversx/mx-docs/blob/main/docs/developers/tutorials/your-first-dapp.md
