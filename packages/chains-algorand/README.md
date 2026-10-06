# @clip-wallet/chains-algorand

Algorand `ChainModule` for Clip Wallet. It builds, decodes and simulates transactions. It never touches keys:
`prepare()` returns the bytes for the vault to sign (ed25519 over `"TX" || msgpack(txn)`), and `finalize()` checks
each signature, builds the `SignedTxn` and sends it when the method asks for that.

`algosdk` 3.8 is used only to encode and decode msgpack (transactions, signed transactions, group ids, ABI selectors,
addresses). It isn't used for keys or signing. algod and the indexer are called with plain `ctx.fetch` (REST, JSON),
so tests mock HTTP. Big integers in algod JSON (asset totals up to 2^64-1) are parsed with algosdk's
`parseJSON(…, { intDecoding: MIXED })` so they stay exact.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/chains-algorand @clip-wallet/core
```

## Example

```ts
import type { ChainModule } from "@clip-wallet/core";
import { createAlgorandModule, ALGORAND_TESTNET } from "@clip-wallet/chains-algorand";

// A wallet's background holds one module per family; it never gives the module a key.
const module: ChainModule = createAlgorandModule();
console.log(module.family, module.derivationPath(0)); // "algorand" "m/44'/283'/0'/0/0"

const network = ALGORAND_TESTNET;
console.log(network.id, network.testnet); // a CAIP-2 id, true

// The flow: decode() → the person approves → prepare() → the vault signs → finalize().
```

## Documentation

- [Chain modules](https://coldai.org/clip/docs/architecture/chain-modules.html)
- [Write a chain module](https://coldai.org/clip/docs/extend/chain-module.html)
- [The Algorand guide for dapps](https://coldai.org/clip/docs/dapps/algorand.html)
- [API reference](https://coldai.org/clip/docs/reference/api/chains-algorand.html)

## Networks

| network | NetworkId (CAIP-2) | genesis id | genesis hash | ARC-25 WC v1 id |
|---|---|---|---|---|
| TestNet | `algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe` | `testnet-v1.0` | `SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=` | 416002 |
| MainNet | `algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k` | `mainnet-v1.0` | `wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=` | 416001 |

- CAIP-2 reference = the first 32 characters of the genesis hash in URL-safe base64 (ChainAgnostic `algorand`
  namespace). WalletConnect v2 uses the same ids. `fromChainId` / `netOf` accept the CAIP-2 id, the genesis hash
  (base64 or base64url), the genesis id or the ARC-25 number (the legacy catch-all 4160 is ambiguous, so it returns null).
- algod: `https://{testnet,mainnet}-api.4160.nodely.dev`, indexer: `https://{testnet,mainnet}-idx.4160.nodely.dev`
  (Nodely free tier, formerly AlgoNode). Genesis values were checked with `GET /v2/transactions/params` on both.
- Explorer: Lora (`https://lora.algokit.io/{testnet,mainnet}`, `explorerTxUrl` → `/transaction/<id>`).
- Assets: ALGO = key `algo` (6 decimals). Circle USDC = key `usdc`: ASA `10458941` (TestNet) and `31566704`
  (MainNet), listed by Circle and checked on-chain (6 decimals). Any other ASA = `asa:<id>`.

## Accounts and derivation

Default (`scheme: "arc52"`): `curve: "bip32-ed25519"`, `derivationPath(i) = m/44'/283'/i'/0/0`. This is ARC-52
BIP32-Ed25519 with Peikert's amendment (g = 9), the same scheme Pera's Universal Wallet (24-word BIP-39) uses.
The vault does the derivation (vault README, "Algorand"). Option `createAlgorandModule({ scheme: "slip10" })` →
`curve: "ed25519"`, `m/44'/283'/i'/0'/0'` (SLIP-10, as Trust Wallet). It must match the vault's
`algorandScheme`. The signature is plain Ed25519 either way, so `prepare()` always asks for scheme `"ed25519"`, and
`finalize()` verifies against the account's 32-byte public key.

Address = base32(pubkey ‖ last 4 bytes of SHA-512/256(pubkey)), no padding (`algosdk.encodeAddress`). `isAddress`
checks the checksum. The public "abandon … about" test account is `ACJDJWM7…LAZ53E` under ARC-52 and
`EP2D7TV7…XIMT2Q` under SLIP-10.

Not covered: Pera/Defly **legacy 25-word** accounts (Algorand's own mnemonic, not BIP-39), which would need a
separate import flow in the vault. **Ledger** is also not covered: it uses BIP32-Ed25519 at the same path but with
its own root and g = 32, so the keys differ.

## Requests

| method | params | result |
|---|---|---|
| `algo_signTxn` (ARC-25 / WalletConnect, ARC-1 semantics) | `[WalletTransaction[], SignTxnOpts?]` (WalletConnect shape) or `WalletTransaction[]` or `{ txns, opts }` | `(string \| null)[]`: base64 msgpack `SignedTxn` per input; `null` for `signers: []` (or the dapp's `stxn` when it was supplied and matches) |
| `algo_signAndPostTxn` (Clip Wallet's own; used by `buildTransfer` / `buildOptIn` / `buildOptOut`, and dapps may use it) | same | `{ txId: string, txIds: string[] }` after `POST /v2/transactions` (one post per atomic group, `application/x-binary`) and a short `/v2/transactions/pending/{txid}` poll |

`WalletTransaction` = `{ txn, authAddr?, msig?, signers?, stxn?, message?, groupMessage? }` (ARC-1). Fields that start
with `_` (wallet extensions) are allowed. Any other field is refused.

**ARC-60 (`algo_signData`, arbitrary data signing) is still a Draft, so it isn't implemented.**

### ARC-1 checks (`normalizeTxns`)

- Every `txn` must decode and re-encode to exactly the same bytes. This refuses unknown or non-canonical fields
  (ARC-1: "any extra field MUST systematically make the wallet reject"). Supported types: pay, axfer, acfg, afrz,
  appl, keyreg. Other types (state proofs, heartbeats) are refused.
- Genesis hash (and genesis id, when present) must be this network's → `algorand/network-mismatch`. The request's
  `networkId` must also be the connected network.
- Groups: a zero group id = a lone transaction. Otherwise the transactions sharing an id must be consecutive, and
  `computeGroupID` over exactly them (group field cleared) must equal the id. That proves every member is there, in
  order (`algorand/bad-group`). At most 16 per group and 64 per request. Several groups in one request are allowed.
- `signers: []` → not signed (`null`, or the `stxn` if its inner txn matches byte for byte). `msig` →
  `algorand/multisig-unsupported`. Otherwise the signer (`authAddr` or the sender) must be this account, else
  `algorand/not-your-account`. If `authAddr` is this account and the sender isn't (an account rekeyed *to* us), it's
  signed with `sgnr` set. `groupMessage` only on a group's first transaction.
- In `decode()`: if this account is rekeyed on-chain (`auth-addr` from algod) → `algorand/rekeyed` ("This account is
  controlled by another key, so Clip Wallet can't sign for it.").
- No transaction to sign → `algorand/not-a-signer`.

### decode()

- **pay**: "Send 1.5 ALGO to HTMZ…MDGU". `close-remainder-to` → title "Close your account and send everything to …"
  plus a **danger `account-closure`** warning. The ALGO that leaves comes from simulation (`closing-amount`), or is
  estimated from the balance.
- **axfer**: "Send 2.5 USDC to …". A 0-amount transfer to yourself → "Add USDC to your account", with the line
  "Algorand accounts must add a token before they can receive it. This locks 0.1 ALGO while it's added." With
  `close-to`: "Remove USDC from your account" (closes to the issuer with 0 amount: **caution** `account-closure`) or
  "Remove USDC and send all of it to X" (**danger** `account-closure`). Clawback (`asnd`) is shown as "Move … from A to B".
- **acfg**: create ("Create token …", supply / decimals / link / roles), reconfigure ("Change the settings of …"),
  destroy ("Delete token …"). **afrz**: "Freeze/Unfreeze X for …".
- **appl**: "Call app 123 (method 0x1a2b3c4d)", "Join app", "Leave app", "Leave app … and erase your data in it",
  "Create an app". Update / Delete → **danger**. The app id, method, argument count, accounts, foreign apps and
  assets, boxes and access-list size are listed. Built-in selectors (each checked with
  `ABIMethod.fromSignature(sig).getSelector()` in the tests): ARC-200 `arc200_transfer` (`da7025b9`),
  `arc200_transferFrom` (`4a968f8f`) and `arc200_approve` (`b5422125`; uint256 max → danger `unlimited-approval`).
  ARC-200 amounts are shown in base units, because the token's decimals need an app read.
- **keyreg**: `blind: true` with "Registers this account for consensus participation — Clip Wallet doesn't support
  this yet." Consensus participation and staking are out of scope.
- Any transaction with **rekey-to** → **danger `account-takeover`**: "Gives control of your account to <addr>. You'd
  lose the ability to use this wallet for it." (rekeying back to the account's own key is just a line).
- Note (as text when it's UTF-8, otherwise hex), lease, the dapp's `message` / `groupMessage` (labelled unverified),
  network fee (sum of the fees this account pays, in ALGO), the locked minimum balance when ALGO leaves, and "Sent by
  <host>" for `algo_signTxn`.
- `first-valid` more than 500 rounds after the current round → danger (ARC-1 "signed in the future"). This uses the
  `durable-nonce` code, because core has no Algorand-specific code. Fee above 0.1 ALGO → `high-fee` (danger at 1 ALGO).
- Several transactions → "Approve N transactions", with one line per transaction and a line saying grouped
  transactions all go through or none do.
- **Simulation**: `POST /v2/transactions/simulate?format=json` with a msgpack body
  `{ "txn-groups": [{ txns: [SignedTxn…] }], "allow-empty-signatures": true, "fix-signers": true }`. A failure becomes
  a plain `simulation-failed` caution. Inner transactions that pay you or take from you (app calls) are added to
  `balanceChanges`. `simulated` is true only when the run succeeded.

Error mapping (`plainAlgorandError`): "overspend" → not enough ALGO; "below min" → minimum balance; "asset N
missing from X" → "They haven't added USDC to their account yet. Ask them to add it first." (or "You haven't…");
"logic eval error" → the app rejected it; "txn dead" → expired; fee too small; already in ledger; frozen; rekey
authorization. Anything else becomes a generic sentence, never the node's raw text.

### Builders

- `buildTransfer({ asset, to, amount })` → `algo_signAndPostTxn`. ALGO pay or ASA axfer with params from
  `/v2/transactions/params` (fee = min fee, validity 1000 rounds). Checks: address and checksum, not yourself,
  amount > 0, spendable ALGO (balance − min balance) covers amount + fee, a new or empty recipient gets at least its
  0.1 ALGO minimum (`algorand/below-min-balance`). For an ASA: you've added it and hold enough, it isn't frozen, and
  the recipient has added it (`GET /v2/accounts/{to}/assets/{id}` 404 → "They haven't added USDC to their Algorand
  account yet. Ask them to add it first.").
- `buildOptIn({ asset })` (AssetRef or id) → 0-amount axfer to yourself, titled "Add USDC to your account". Refused if
  it's already added or less than 0.1 ALGO + fee is spendable.
- `buildOptOut({ asset })` → 0-amount axfer with `close-to` = the token's issuer. A close-to sends **everything left**
  to that account, so this is refused while you still hold any (`algorand/opt-out-nonzero`) and for tokens you
  created. It decodes as "Remove USDC from your account" with a caution.
- `buildGroup(specs, ctx)` (`src/build.ts`, used by the features package's Tinyman swap) → one atomic group as
  `algo_signAndPostTxn`. Specs are `pay`, `axfer` or NoOp `appl` (args, accounts, foreign assets/apps, fee = N × min
  fee for inner transactions). The sender is always this account; rekey-to and close-to can't be expressed. Fresh
  params, 1000-round validity and `assignGroupID`. Also `readLocalState(ctx, address, appId)` (algod
  `/v2/accounts/{a}/applications/{id}`, keys decoded), `readAccount(ctx, assetIds)` (balance, min-balance, rekeyed,
  holdings), `logicSigAddress(program)`, `encodeUint64` and `decodeTxn(b64)` (algosdk, so features needs no algosdk).
- `spendable(ctx)` → `{ balance, locked, spendable }` (µALGO strings). `locked` is algod's `min-balance`: 0.1 ALGO base
  + 0.1 per token added or created + app opt-ins / boxes.

## Balances and NFTs

`getBalances`: algod `/v2/accounts/{addr}` (ALGO `amount`, `assets[]`) plus `/v2/assets/{id}` (unit name, name,
decimals, url; cached per algod URL). NFTs go to `getNfts`. A token counts as an NFT when total = 1 and decimals = 0,
or when it's a fractional ARC-3 NFT (total = 10^decimals, with an ARC-3 / ARC-19 marker).

`getNfts` (held amount > 0):

- **arc19**: URL `template-ipfs://{ipfscid:<v>:<codec>:reserve:<hash>}[/path]` → CID rebuilt from the reserve
  address's 32 bytes (CIDv0 base58btc for dag-pb / sha2-256, CIDv1 base32 for raw, dag-pb and other codecs). If it's
  also ARC-3 (or ends in `.json`), the metadata JSON is read. Otherwise the URL is the media. Spec vector:
  reserve `EEQY…CTI` → `QmQZyq4b89RfaUw8GESPd2re4hJqB8bnm4kVHNtyQrHnnK`.
- **arc3**: asset name `arc3` / `…@arc3` or URL ending `#arc3`. `{id}` is substituted, the metadata JSON is fetched
  (https or `ipfs://` via the gateway, default `https://ipfs.io/ipfs/`), and relative `image` URIs are resolved
  against the metadata URL.
- **arc69** (everything else): the latest `acfg` note with `"standard": "arc69"` from the indexer
  (`/v2/assets/{id}/transactions?tx-type=acfg`, ascending rounds, up to 5 pages). Media = `media_url`, or the asset
  URL without its `#i/#v/#a/#p/#h` fragment.
- Attributes from `attributes[]` (trait_type/value) and flat `properties`. `mediaUrl` is untrusted: render it only
  through the sandboxed media proxy.

## Known gaps

- No multisig (`msig`), logicsig, or ARC-60 data signing. No `keyreg` / consensus participation (no `staking` field).
- Only one account per request: `authAddr` must be this account.
- ARC-200 amounts aren't scaled by the token's decimals. Other ARC-4 methods show only their selector (ARC-56 app
  specs aren't fetched).
- The on-chain rekey check runs in `decode()` only. `prepare()` / `finalize()` stay offline.
- Update/Delete app calls use the `blind-signing` code, and the future-first-valid check uses `durable-nonce`, because
  core has no closer codes.

## Sources

- ChainAgnostic Algorand CAIP-2: https://github.com/ChainAgnostic/namespaces/blob/main/algorand/caip2.md
- ARC-1 Wallet Transaction Signing API (Final): https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0001.md (https://dev.algorand.co/arc-standards/arc-0001/)
- ARC-25 Algorand WalletConnect v1 API (Final; `algo_signTxn`, chain ids): https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0025.md
- TxnLab Algorand WalletConnect v2 example (`params: [[WalletTransaction…]]`, chain `algorand:SGO1…`): https://github.com/TxnLab/algorand-wc2
- ARC-3 (Final): https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0003.md
- ARC-19 (Final): https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0019.md
- ARC-69 (Final): https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0069.md
- ARC-4 ABI (Final): https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0004.md
- ARC-200 (Living): https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0200.md
- ARC-60 (Draft): https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0060.md
- ARC-52 / xHD (BIP32-Ed25519, Peikert): https://github.com/algorandfoundation/ARCs/pull/239, https://github.com/algorandfoundation/xHD-Wallet-API-ts (spec vectors reproduced for the fixtures), Pera Universal Wallet: https://github.com/perawallet/pera-react-native
- Accounts overview (Algo25 legacy vs xHD): https://dev.algorand.co/concepts/accounts/overview/
- Protocol parameters (min balance 0.1 ALGO base / per asset / per app opt-in, min fee 0.001 ALGO, group size 16, max txn life 1000): https://dev.algorand.co/concepts/protocol/protocol-parameters/
- algod REST API (simulate, raw transactions, pending): https://github.com/algorand/go-algorand/blob/master/daemon/algod/api/algod.oas2.json
- Indexer REST API: https://github.com/algorand/indexer/blob/main/api/indexer.oas2.json
- Nodely free endpoints: https://nodely.io/docs/free/endpoints
- Circle USDC asset ids: https://developers.circle.com/stablecoins/usdc-contract-addresses
- Ledger Algorand app (path prefix 44'/283'): https://github.com/LedgerHQ/app-algorand
- Lora explorer: https://lora.algokit.io
- SLIP-10: https://github.com/satoshilabs/slips/blob/master/slip-0010.md

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

See [LICENSE](./LICENSE).
