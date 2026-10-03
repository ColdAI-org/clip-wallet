# @clip-wallet/chains-stellar

Stellar `ChainModule` for Clip Wallet. It builds, decodes and simulates transactions, and never touches keys.
`prepare()` returns the 32-byte hash that a Stellar ed25519 signature covers. `finalize()` checks the vault's
signature with `ed25519.verify`, adds it to the envelope as a `DecoratedSignature` (hint = last 4 bytes of the
public key) and submits when the method asks for it.

`@stellar/stellar-base` 15 handles XDR, StrKey, `TransactionBuilder`, `Operation`, `Asset` and `scValToNative`.
Its `Keypair` signing isn't used anywhere. Horizon and Soroban RPC are called with plain `ctx.fetch`; there's no
`stellar-sdk`.

## Networks

| NetworkId (CAIP-2) | passphrase | Horizon (`rpcUrls[0]`) | Soroban RPC | explorer |
|---|---|---|---|---|
| `stellar:testnet` | `Test SDF Network ; September 2015` | https://horizon-testnet.stellar.org | https://soroban-testnet.stellar.org | https://stellar.expert/explorer/testnet |
| `stellar:pubnet` | `Public Global Stellar Network ; September 2015` | https://horizon.stellar.org | none by default: SDF doesn't run a public mainnet RPC. Set `createStellarModule({ sorobanRpcUrl })` to a provider | https://stellar.expert/explorer/public |

- The CAIP-2 ids come from the ChainAgnostic `stellar` namespace. They're also the WalletConnect chain ids used by
  stellar-wallets-kit.
- The passphrases were checked against `GET /` on both Horizons and against Soroban RPC `getNetwork`.
- `networkPassphrase(networkId)` and `fromPassphrase(passphrase)` convert between the two forms.
- Base reserve: 0.5 XLM (`base_reserve_in_stroops: 5000000` on the latest ledgers of both networks). Base fee:
  100 stroops.

Asset keys:

- XLM is `xlm` (7 decimals).
- Circle USDC is `usdc`: issuer `GA5Z…KZVN` on pubnet and `GBBD…LFA5` on testnet.
- Other classic assets are `stellar:<CODE>-<ISSUER>`, with `address` set to `CODE:ISSUER` (SEP-11 form).
- Soroban (SEP-41 / SAC) tokens are `sep41:<C…>`.
- An asset named like USDC from any other issuer is marked `spam`. This includes Circle's pubnet issuer when it
  appears on testnet. The same applies to a credit asset coded `XLM`.

## Accounts and addresses

- `derivationPath(i)` = `m/44'/148'/i'` (SEP-0005, SLIP-10 ed25519, all hardened). The fixtures reproduce
  SEP-0005 test 5 ("abandon … about" → `GB3J…QBYX`).
- `addressFromPublicKey` returns the `G…` StrKey.
- `isAddress` accepts `G…` and `M…` (muxed, CAP-27) as payment destinations.
- `C…` contract addresses aren't accounts. Check them with `isContractAddress`. `buildTransfer` refuses them.
- A muxed `M…` destination works for payments. It can't open an unfunded account, because createAccount needs a
  `G…` destination.
- Unfunded accounts don't exist on the ledger. `getBalances` returns `0 XLM` for them, and `buildTransfer` from
  one fails with "Your Stellar account isn't open yet. Receive at least 1 XLM to open it."

## Methods (`STELLAR_METHODS`)

Names come from the WalletConnect Stellar RPC reference (`stellar_signXDR`, `stellar_signAndSubmitXDR`) and
stellar-wallets-kit's WalletConnect module (all four, with `entryXdr` and `signature`). The injected (SEP-43)
provider maps `signTransaction`, `signAuthEntry` and `signMessage` onto the same names, so results carry both
spellings.

| method | params | result |
|---|---|---|
| `stellar_signXDR` | `{ xdr: string (base64 TransactionEnvelope), networkPassphrase?, address?, submit?: boolean }` | `{ signedXDR, signedTxXdr, signerAddress }` (`signedXDR === signedTxXdr`). With `submit: true` it behaves like the next row |
| `stellar_signAndSubmitXDR` | `{ xdr, networkPassphrase?, address? }` | `{ status: "success" \| "pending", hash (hex), signedXDR, signedTxXdr }` |
| `stellar_signAuthEntry` | `{ authEntry \| entryXdr: string (base64 HashIdPreimage, ENVELOPE_TYPE_SOROBAN_AUTHORIZATION), networkPassphrase?, address? }` | `{ signedAuthEntry: base64 64-byte signature, signerAddress }` |
| `stellar_signMessage` | `{ message: string, networkPassphrase?, address? }` | `{ signedMessage, signature, signerAddress }` (same base64 64-byte signature in both fields) |

Refusals:

- An `address` that isn't this account (its base `G…`, if muxed) → `stellar/wrong-account`.
- A `networkPassphrase` that isn't this network's → `stellar/network-mismatch`.
- A transaction that this account doesn't sign as tx source, op source or fee-bump fee source →
  `stellar/not-a-signer`.

### What gets signed (`prepare`)

- **Transactions:** `sha256(sha256(passphrase) ‖ ENVELOPE_TYPE_TX (2) ‖ Transaction XDR)`. Fee-bumps use
  `ENVELOPE_TYPE_TX_FEE_BUMP (5) ‖ FeeBumpTransaction`. The tests check this equals stellar-base `tx.hash()`.
  - In a fee-bump, the account signs as fee source.
  - If only the inner transaction needs this account, the request is refused (`stellar/fee-bump-inner`). Adding
    an inner signature would change the outer hash.
- **Auth entries (SEP-43 / Freighter):** `sha256(preimage XDR bytes)`. The result is the bare signature, which
  dapps put into the `SorobanAddressCredentials` themselves, as stellar-base's `authorizeEntry` does. If the
  preimage's `networkId` isn't `sha256(this passphrase)`, the request is refused in decode, prepare and finalize.
- **Messages (SEP-53, Final):** `sha256("Stellar Signed Message:\n" ‖ utf8(message))`. The tests check this
  against all three published SEP-53 vectors, using only the public key and signatures.

### Submitting

- Classic transactions go to Horizon `POST /transactions` (form `tx=`). 200 → `success`; 504 → `pending`.
- Soroban transactions (invokeHostFunction / extendFootprintTtl / restoreFootprint) go to Soroban RPC
  `sendTransaction`, then `getTransaction` is polled (default 10 × 1 s; set `pollAttempts`, `pollIntervalMs`,
  `sleep`).
  - `SUCCESS` → `success`. Still `NOT_FOUND` after the last poll → `pending`.
  - `FAILED` / `ERROR` → plain `ClipError`.
  - Without an RPC URL, Soroban transactions go through Horizon.
- Result codes from Horizon `extras.result_codes`, or from the XDR `TransactionResult` for RPC, become plain
  words (`plainStellarError`). Covered: tx_bad_seq, tx_insufficient_balance, tx_insufficient_fee, tx_too_late,
  tx_bad_auth, tx_no_account, op_underfunded, op_no_trust, op_no_destination, op_low_reserve, op_line_full,
  op_invalid_limit, op_under_dest_min, op_over_source_max and more. The rest map to "Stellar rejected this
  transaction. Nothing was sent."

## decode()

Titles use assets and short addresses, for example "Send 10 USDC to GAAZ…CWN7". The fee is `{ asset: xlm, amount:
tx fee in stroops }`. Every request also shows the memo, "Valid until" (max time bound) and, for fee-bumps, who pays.

| operation | title / effect | warnings |
|---|---|---|
| payment | "Send X A to …" (or "Receive …" when only the destination is you); balance change | caution if the destination isn't open, or has no trustline for the asset; `known-scam` caution for look-alike assets |
| createAccount | "Send X XLM to … and open their account", plus "This also opens their Stellar account; it needs at least 1 XLM." | |
| pathPaymentStrictSend / StrictReceive | "Swap X A for at least Y B[, sent to …]" / "Swap up to X A for Y B…"; route line; bounds used as balance changes | |
| changeTrust | "Add USDC to your account" (line: sets aside 0.5 XLM) / "Remove USDC…" (limit 0); pool shares | `known-scam` caution on look-alikes |
| manageSellOffer / manageBuyOffer / createPassiveSellOffer | "Offer to sell/buy…", "Change an offer…", "Cancel an offer" (amount 0) | |
| setOptions on your account | "Change your account's settings": signer add/remove, master weight, thresholds, home domain, flags | **danger `account-takeover`** for an added signer (weight > 0), master weight 0, or any threshold change |
| accountMerge of your account | "Close your account and send all your XLM to …" | **danger `account-closure`** |
| allowTrust / setTrustLineFlags / clawback / clawbackClaimableBalance | issuer actions, explained | |
| createClaimableBalance / claimClaimableBalance | "Send X A to … to claim" / "Claim a balance sent to you" | |
| begin/endSponsoringFutureReserves, revokeSponsorship (all kinds) | explained in terms of who pays the 0.5 XLM reserve | |
| manageData, bumpSequence, inflation, liquidityPoolDeposit/Withdraw, extendFootprintTtl, restoreFootprint | explained | |
| invokeHostFunction | contract, function, arguments (`scValToNative`, best effort); `transfer(from=you, to, amount)` → "Send X T to …"; create/upload contract; auth entries your signature covers | `simulation-failed` caution when simulation fails or there's no RPC |
| anything else | "Unknown Stellar action" | `blind: true` + danger `blind-signing` |

More checks:

- **SEP-29.** For payment, path payment and accountMerge to a `G…` destination, the destination's Horizon data is
  read. If `config.memo_required` is `"1"` (base64 `MQ==`) and the transaction has no memo → **danger
  `memo-required`**.
- **Soroban simulation.** Uses `simulateTransaction` with `{ transaction }`.
  - `transfer`, `burn` and `mint` contract events (SEP-41 / SAC) from the diagnostic events become
    `balanceChanges` for this account. Both the `i128` and the CAP-67 `{ amount, to_muxed_id }` data forms are
    handled.
  - A SAC is matched to its classic asset only when `Asset.contractId(passphrase)` equals the emitting contract.
    A fake token can't claim to be USDC through its topic.
  - Other tokens get decimals, symbol and name by simulating `decimals()`, `symbol()` and `name()`. Results are
    cached per module instance.
  - `minResourceFee` is shown.
- **Auth entries.** decode shows the invocation tree (contract, function, arguments, sub-invocations), the nonce,
  and "Valid until ledger N (about M min from now)", using Soroban RPC `getLatestLedger` at about 5 s per ledger.

## Builders

- `buildTransfer({ asset, to, amount })` → `stellar_signAndSubmitXDR` with `{ xdr, networkPassphrase, address }`:
  - XLM to an open account → `payment`. To an unopened account → `createAccount`. Under 1 XLM →
    `stellar/below-minimum` ("This also opens their Stellar account; it needs at least 1 XLM.").
  - Classic token → `payment`. First it checks your balance (`stellar/insufficient-token`) and the recipient's
    trustline. With no trustline → `stellar/no-trustline` ("They need to add USDC to their Stellar account before
    they can receive it."). Sending to the issuer is always allowed.
  - SEP-41 token (`asset.address` = `C…`) → `transfer(from, to, amount)`. It's simulated, then assembled with the
    simulation's `transactionData`, `minResourceFee` and auth entries.
  - Sequence comes from Horizon.
  - Fee per operation = max(`last_ledger_base_fee`, `fee_charged.p50`) from `/fee_stats`, capped at 0.01 XLM.
    Stellar charges only what the ledger needs, never more than the bid.
  - Time bounds: now + 300 s (`txTimeoutSeconds`).
  - Also refused: self-transfer, a bad address, a `C…` recipient and a zero amount.
- `buildAddAsset({ asset })` / `buildRemoveAsset({ asset })` → changeTrust with the default (max) limit, or with
  `0`. `asset` is an `AssetRef` or `{ code, issuer }`.
  - Add needs 0.5 XLM free (`stellar/low-reserve`). Adding an asset that's already added → `stellar/already-added`.
  - Remove needs a zero balance (`stellar/trustline-not-empty`).
- `buildPathSwap({ sell, buy, sendAmount, destMin, path }, ctx)` (`src/swap.ts`, used by the features package's
  Stellar DEX swap) → `stellar_signAndSubmitXDR` with ONE transaction: `changeTrust(buy)` first when the account has
  no trustline for the bought asset, then `pathPaymentStrictSend(sendAsset, sendAmount, destination = you, destAsset,
  destMin, path)`. Both go through together or not at all, and `destMin` is enforced by the network
  (`op_under_dest_min`). `checkPathSwap` runs the same read-only checks at quote time: balance of the sold asset
  (minus selling liabilities), XLM spendable above the minimum balance for the amount, fees and the 0.5 XLM reserve a
  new trustline sets aside, and an issuer that hasn't authorized the account. SEP-41 tokens are refused
  (`stellar/swap-unsupported-asset`), and paths longer than 5 assets (`stellar/path-too-long`). decode describes it
  as "Add USDC to your account and swap 10 XLM for at least 9.4184622 USDC" (not blind).
  `parseStellarTransaction(xdr, networkId)` parses an envelope back. Source:
  https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations (path payments, path ≤ 5).
- `spendable(ctx)` → XLM you can spend, in stroops: balance − selling liabilities − (2 + subentries + sponsoring −
  sponsored) × base reserve. The base reserve is read from Horizon's latest ledger.

## Balances and NFTs

- `getBalances`: Horizon `/accounts/{id}`. Returns native XLM plus every classic trustline (`credit_alphanum4/12`).
  Trustlines with a 0 balance are included, since those are assets the user has added. Liquidity pool shares are
  skipped. Soroban token balances aren't listed: there's no index of which contracts an account holds without an
  indexer.
- `getNfts` returns `[]`. Stellar has no single NFT standard. SEP-50 (Soroban NFTs) is still a Draft (v0.1.0).

## Known gaps

- Multisig: if your signature alone doesn't meet the threshold, the transaction fails `tx_bad_auth`. Collecting
  co-signatures isn't handled. WalletConnect's `pending` status is returned only for submissions that time out.
- A fee-bump whose inner transaction needs this account isn't signed.
- Soroban token balances aren't listed in `getBalances`.
- `stellar_signAuthEntry` takes only a `HashIdPreimage`, not a full `SorobanAuthorizationEntry`.
- No mainnet Soroban RPC by default, so on pubnet contract calls show a `simulation-failed` caution until one is
  configured.
- The SEP-53 message is treated as a UTF-8 string. Binary messages from injected callers would need a base64
  parameter, which the wire format doesn't define yet.

## Tests

Tests are in `test/stellar.test.ts` and use no network.

- Horizon and Soroban RPC fixtures were captured from testnet with curl and trimmed (`test/fixtures.ts`).
- Signatures were precomputed offline from the public "abandon … about" vector at `m/44'/148'/0'`
  (`test/signatures.ts`). The `fixtureSigner` in `test/helpers.ts` only looks them up.

## Sources

- CAIP-2 / CAIP-10 Stellar namespace: https://github.com/ChainAgnostic/namespaces/blob/main/stellar/caip2.md, https://github.com/ChainAgnostic/namespaces/blob/main/stellar/caip10.md
- WalletConnect Stellar RPC: https://github.com/reown-com/reown-docs/blob/main/advanced/multichain/rpc-reference/stellar-rpc.mdx (https://docs.reown.com/advanced/multichain/rpc-reference/stellar-rpc)
- stellar-wallets-kit WalletConnect module: https://github.com/Creit-Tech/Stellar-Wallets-Kit/blob/main/src/sdk/modules/wallet-connect.module.ts
- SEP-0005 (key derivation, test vectors): https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0005.md
- SEP-0011 (asset strings): https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0011.md
- SEP-0029 (memo required): https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0029.md
- SEP-0041 (token interface): https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md
- SEP-0043 (wallet interface): https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md
- SEP-0050 (NFTs, Draft): https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0050.md
- SEP-0053 (sign messages, test vectors): https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md
- CAP-0027 (muxed accounts): https://github.com/stellar/stellar-protocol/blob/master/core/cap-0027.md
- CAP-0067 (unified events): https://github.com/stellar/stellar-protocol/blob/master/core/cap-0067.md
- Freighter signAuthEntry / SEP-53 implementation: https://github.com/stellar/freighter/blob/master/extension/src/background/messageListener/handlers/signAuthEntry.ts, https://github.com/stellar/freighter/blob/master/extension/src/helpers/stellar.ts
- Horizon API and result codes: https://developers.stellar.org/docs/data/apis/horizon/api-reference, https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes
- Soroban RPC methods (simulateTransaction, sendTransaction, getTransaction, getLatestLedger): https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods
- RPC providers (no SDF mainnet RPC): https://developers.stellar.org/docs/data/apis/rpc/providers
- Lumens, base reserve and minimum balance: https://developers.stellar.org/docs/learn/fundamentals/lumens
- Circle USDC issuers: https://developers.circle.com/stablecoins/usdc-contract-addresses
- `@stellar/stellar-base` 15: https://www.npmjs.com/package/@stellar/stellar-base
