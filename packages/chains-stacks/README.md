# @clip-wallet/chains-stacks

Stacks `ChainModule` for Clip Wallet. It builds and decodes Stacks transactions in plain words and never touches
keys. `prepare()` returns the 32-byte digest the account's key signs; `finalize()` checks the vault's signature with
`secp256k1.verify`, works out the recovery id from the account's key, puts the signature into the transaction and
broadcasts when the method asks for it.

Everything is hand-written from SIP-005 with `@noble/hashes` (SHA-512/256, SHA-256, RIPEMD-160) and `@noble/curves`
(verification only): c32check addresses, Clarity values, post-conditions, payloads, the transaction wire format and
the signing hashes. `@stacks/transactions` and `@stacks/encryption` 7.6 are dev dependencies only: the tests check
our bytes, txids and digests against them, and check our signed transactions with stacks.js `verifyOrigin()`.

## Networks

| NetworkId (CAIP-2) | chain id | tx version | API (`rpcUrls[0]`) | explorer |
|---|---|---|---|---|
| `stacks:2147483648` | `0x80000000` | `0x80` | https://api.testnet.hiro.so | https://explorer.hiro.so/?chain=testnet |
| `stacks:1` | `0x00000001` | `0x00` | https://api.hiro.so | https://explorer.hiro.so |

- The ids come from the ChainAgnostic `stacks` namespace (`stacks/caip2.md`, test cases `stacks:1` and
  `stacks:2147483648`), which is the `network_id` of `GET /v2/info`. Both were checked against Hiro (2026-10).
- Hiro's API is used without a key: `/v2/accounts`, `/extended/v1/address/{a}/nonces` (falls back to the node's
  account nonce), `/extended/v1/address/{a}/balances`, `/metadata/v1/ft/{contract}`, `POST /v2/fees/transaction`
  (falls back to `/v2/fees/transfer` × length), `POST /v2/transactions` and `/extended/v1/tx/{id}`.
- Testnet faucet: `POST https://api.testnet.hiro.so/extended/v1/faucets/stx?address=ST…` (no key, no captcha;
  rate-limited per address/IP). It sends 500 testnet STX.

Assets:

- STX is `stx` (6 decimals).
- Curated SIP-010 tokens (`STACKS_NETS[n].tokens`): sBTC (`sbtc`, mainnet `SM3VDXK3…JFQ4.sbtc-token::sbtc-token`,
  docs.stacks.co "Deployed Mainnet Contracts"; no official testnet deployment, only mocks), Circle's USDCx through
  xReserve (`usdcx`, mainnet `SP120SBR…2CNE.usdcx::usdcx-token`, testnet `ST1PQHQK…PGZGM.usdcx::usdcx-token`,
  docs.stacks.co/learn/bridging/usdcx/contracts) and Allbridge's aeUSDC (`aeusdc`, mainnet). All three are
  `bridged: true` with their own key: none is the issuer's native token.
- Other tokens are `sip10:<contract>::<asset>` with metadata from Hiro. One named like a curated token, STX or a
  dollar (`USDC`, `sBTC`, `STX`, …) is `spam`.
- `stxBalance(ctx)` gives total, locked (stacking) and spendable µSTX. `getNfts` returns `[]`.

## Accounts and addresses

- `derivationPath(i)` = `m/44'/5757'/0'/0/i` (Leather, Xverse, `@stacks/wallet-sdk` account i), secp256k1.
- The address is P2PKH (`hash160` of the compressed key) spelled per network: `SP…` on mainnet, `ST…` on testnet.
  `Account.address` is the mainnet form; `addressFromPublicKey(key, network)` and `receiveAddress(ctx)` give the
  network's spelling. Fixtures: "abandon … about" → `SPC5KHM4…SH54J` / `STC5KHM4…330BQ`, as stacks.js derives them.
- `isAddress` accepts standard (`SP/ST/SM/SN`) and contract (`SP….name`) principals, checksum verified.
  `networksForAddress` maps SP/SM to mainnet and ST/SN to testnet.

## Methods (`STACKS_METHODS`)

The SIP-030 names (https://github.com/stacksgov/sips/blob/main/sips/sip-030/sip-030-wallet-interface.md), which
`@stacks/connect` v8 `request()` sends. Clarity values and post-conditions arrive as SIP-005 hex (what Connect's
`serializeParams` sends) or as the SIP-030 JSON form.

| method | params | result |
|---|---|---|
| `stx_transferStx` | `{ recipient, amount, memo?, fee?, nonce?, sponsored?, broadcast? = true, network?, address? }` | `{ txid, transaction }` |
| `stx_transferSip10Ft` | `{ recipient, asset: "SP….contract::asset", amount, … }` | `{ txid, transaction }` (adds "you send exactly `amount`" when the app gives no post-conditions) |
| `stx_transferSip9Nft` | `{ recipient, asset, assetId, … }` | `{ txid, transaction }` (adds "you send `assetId`") |
| `stx_callContract` | `{ contract: "SP….name", functionName, functionArgs?, postConditions?, postConditionMode?, … }` | `{ txid, transaction }` |
| `stx_deployContract` | `{ name, clarityCode, clarityVersion?, … }` | `{ txid, transaction }` |
| `stx_signTransaction` | `{ transaction: hex, broadcast? = false }` | `{ transaction, txid }` |
| `stx_signMessage` | `{ message: string }` | `{ signature: RSV hex, publicKey }` |
| `stx_signStructuredMessage` | `{ domain, message }` (SIP-018) | `{ signature: RSV hex, publicKey }` |

Transactions built from an app's params get their nonce (`possible_next_nonce`) and fee at decode time, and are kept
per request id so `prepare` and `finalize` sign exactly what the approval showed. A sponsored transaction is never
broadcast by the wallet (the sponsor signs and sends it). `buildTransfer` makes a complete unsigned transaction and
sends it as `stx_signTransaction` with `broadcast: true` (STX: a token transfer; SIP-010 tokens: `transfer` with an
exact post-condition).

Refusals: another network (`network` param, request network, transaction version/chain id or an address's version)
→ `stacks/network-mismatch`; an `address` that isn't this account, or a transaction whose origin isn't this
account's P2PKH key → `stacks/wrong-account`; multisig origins → `stacks/unsupported-multisig`; a transfer to
yourself (nodes refuse it) → `stacks/self-transfer`. A transaction that can't be parsed (bad hex, coinbase or
tenure-change payloads, unknown post-condition types) is `blind: true` and can't be prepared.

### What gets signed (`prepare`)

- **Transactions (origin, single-sig P2PKH):** the initial sighash is the txid (SHA-512/256) of the transaction with
  the origin's nonce, fee and signature cleared and, when sponsored, the sponsor condition replaced by an empty
  P2PKH one. The digest is `SHA-512/256(sighash ‖ 0x04 ‖ fee(8) ‖ nonce(8))`. The origin always uses the standard
  flag 0x04, sponsored or not (stacks.js `signNextOrigin` / `sigHashPreSign`). The signature goes into the
  spending condition as **recovery id ‖ r ‖ s** (65 bytes, "VRS") with key encoding 0x00 (compressed).
- **Messages:** `SHA-256("\x17Stacks Signed Message:\n" ‖ CompactSize(len) ‖ utf8(message))` (@stacks/encryption
  `hashMessage`). **SIP-018:** `SHA-256("SIP018" ‖ SHA-256(domain) ‖ SHA-256(message))`; the domain must be a tuple
  of `name`, `version` (string-ascii) and `chain-id` (uint), and a `chain-id` that isn't this network's is a danger
  warning. Results are **r ‖ s ‖ recovery id** ("RSV") hex, what `verifyMessageSignatureRsv` checks.

### Decoding

- STX transfers: "Send 1.5 STX to ST1…ABCD", amount, memo, fee, nonce, the balance change.
- Contract calls: "Use swap on contract amm", every argument as readable Clarity (`u100`, `'SP…`, `(some …)`,
  `{ a: u1 }`), and every post-condition as a line ("You send exactly 2.5 USDCx", "pool sends at least 1 USDCx",
  "You keep nft u7"). Your exact / at-most post-conditions become the balance changes.
- SIP-010 `transfer` from you is recognised and titled "Send 2.5 USDCx to …".
- `postConditionMode: "allow"` → danger: the contract may move any of your assets. "originator" (SIP-040) → info.
  Deny mode without a post-condition on you → "None of your assets can leave your account … apart from the network fee."
- Contract deploys: the name, Clarity version and code, with a caution.
- Sponsored: the fee line says who pays.

## 1Mask (`@clip-wallet/1mask`)

`inpage/stacks.ts` puts a SIP-030 provider on `window.clipwallet.stacks` (`request(method, params)` resolving a
JSON-RPC 2.0 response, `listen("stx_accountChange", …)`) and registers it with WBIP-004: it pushes
`{ id: "clipwallet.stacks", name, icon, methods }` (the wallet's own identity) onto `window.wbip_providers`, which
`@stacks/connect` v8 lists in its picker and resolves by path (`getProviderFromId`). It never sets
`window.StacksProvider`, `LeatherProvider` or `XverseProviders`. `background/stacks.ts` (`createStacksDispatcher`)
allowlists the methods, checks permissions and the signer, re-spells the account for the site's network (SP → ST)
and hands signing methods to the module unchanged.

## Not supported (yet)

Multisig origins, sponsoring someone else's transaction, `stx_getAccounts` (it hands out a Gaia app key, which is a
private key), `stx_updateProfile`, NFTs in `getNfts`, stacking.
