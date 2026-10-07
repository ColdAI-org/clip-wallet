# @clip-wallet/chains-xrpl

XRP Ledger `ChainModule` for Clip Wallet. It builds, decodes and checks transactions in plain words and never
touches keys: `prepare()` returns the 32-byte digest for the vault to sign (`ecdsa-secp256k1`), and `finalize()`
checks the signature against the account's key before anything is assembled or sent.

No SDK at runtime. The binary codec subset (`src/codec.ts`), addresses (`src/address.ts`) and JSON-RPC client
(`src/rpc.ts`) are hand-written on `@noble/hashes`, `@noble/curves` (verification only) and `@scure/base`. Tests
encode the same JSON with `ripple-binary-codec` (xrpl.js) and require identical bytes, verify the signatures with
`ripple-keypairs` and compute transaction ids with `xrpl`'s `hashes.hashSignedTx` (all devDependencies).

## Networks

| network | NetworkId (CAIP-2) | JSON-RPC (public, no key) | explorer |
|---|---|---|---|
| Testnet | `xrpl:1` | `https://s.altnet.rippletest.net:51234/`, `https://testnet.xrpl-labs.com/` | testnet.xrpl.org |
| Mainnet | `xrpl:0` | `https://xrplcluster.com/`, `https://s1.ripple.com:51234/`, `https://s2.ripple.com:51234/` | livenet.xrpl.org |
| Devnet | `xrpl:2` | `https://s.devnet.rippletest.net:51234/` | devnet.xrpl.org |

- Ids: ChainAgnostic namespaces `xrpl/caip2.md` (`xrpl:<network_id>`, from `server_info`). XLS-72d uses the same ids
  and the aliases `xrpl:mainnet` / `xrpl:testnet` / `xrpl:devnet` (`fromChainId` accepts both).
- Every endpoint was checked with `server_info` (network_id, validated ledger, reserves) in October 2026. The reserves
  then were 1 XRP base and 0.2 XRP per owned object; the module always reads them live.
- `NetworkID` is dropped from a transaction for networks ≤ 1024 and required above (rippled rules), so a request
  naming another network's id is refused.

## Accounts

`curve: "secp256k1"`, `derivationPath(i) = m/44'/144'/i'/0/0` (xrpl.js `Wallet.fromMnemonic` for i = 0, Ledger Live,
GemWallet). Address = base58 (Ripple alphabet) check of `0x00 ‖ RIPEMD-160(SHA-256(compressed key))`; the public
"abandon … about" account is `rHsMGQEkVNJmpGWs8XUBoTBiAAbwxZN5v3` (checked against `ripple-keypairs.deriveAddress`).
`isAddress` accepts classic addresses and X-addresses (checksums verified); `networksForAddress` keeps an X-address to
mainnet or the test networks. `buildTransfer` accepts an X-address and turns its tag into `DestinationTag`.

## Assets

- XRP: key `xrp`, 6 decimals (drops). `spendable(ctx)` returns balance, locked (base reserve + owner reserve ×
  owned objects, from `server_info` and `account_info`) and spendable XRP.
- Trust-line tokens from `account_lines`. Known: Ripple USD **RLUSD** (key `rlusd`, currency
  `524C555344…`; issuer `rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De` mainnet, `rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV`
  testnet) and Circle **USDC** (key `usdc`, currency `5553444300…`; issuer `rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE`
  mainnet, `rHuGNhqTG32mfmAvWA8hUyWRLV3tCSwKQt` testnet, developers.circle.com). Both issuers were checked with
  `gateway_balances`. Known stablecoins use 6 decimals, other tokens 15 (amounts are truncated, never rounded up).
- Any other issuer's token that calls itself USD/USDC/RLUSD/USDT/XRP is `spam: true`. Negative lines (tokens this
  account issued) are not holdings and are skipped.
- `getNfts` returns `[]`: XLS-20 NFTs need an `Nft.standard` value core doesn't have yet (`"xls20"`).
- `buildTrustLine({ asset })` adds a token (TrustSet, high limit, `tfSetNoRipple`; locks one owner reserve).

## Requests (XLS-72d)

| method | params | result |
|---|---|---|
| `xrpl:signTransaction` | `{ tx_json, account: "r…", network: "xrpl:1" \| "xrpl:testnet", options?: { autofill?, multisig? } }` | `{ signed_tx_blob }` (upper-case hex) |
| `xrpl:signAndSubmitTransaction` | same | `{ tx_hash, tx_json }`: `submit`, then `tx` until validated (`tx_json` is that answer) |

`buildTransfer` (XRP or a trust-line token) uses `xrpl:signAndSubmitTransaction` with `origin: WALLET_ORIGIN` and a
fully filled transaction.

- **Autofill**: a missing `Sequence` (from `account_info`; 0 with `TicketSequence`), `Fee` (`fee` command:
  max(base, open-ledger fee), capped at 0.1 XRP; `AccountDelete` pays the owner reserve) and
  `LastLedgerSequence` (current + 20) are filled once in `decode()` and cached per request id, so `prepare()` and
  `finalize()` sign exactly what was shown. `SigningPubKey` is always the account's key.
- **Refused**: another network (request, `network` param or `NetworkID`), another account (`Account`, `account`,
  `SigningPubKey`), multi-signing (`options.multisig` or an empty `SigningPubKey`), already signed (`TxnSignature`,
  `Signers`), a master key that is turned off (`lsfDisableMaster`).
- **Signing**: digest = SHA-512Half(`53545800` ‖ signing fields). The vault's low-S r ‖ s is verified with
  `secp256k1.verify(…, { prehash: false })`, then DER-encoded into `TxnSignature`. The id is
  SHA-512Half(`54584E00` ‖ blob). `tem`/`tef`/`tel`/`ter` (except `terQUEUED`) answers mean nothing was sent;
  a validated `tec` result throws `xrpl/failed` ("… The network fee was still charged."). Engine results are put in
  plain words by `plainXrplError`.

### decode()

- **Payment**: "Send 1.5 XRP to rPT1…pAYe" / "Send 2.5 RLUSD to …"; cross-currency: "Pay up to … so … gets …".
  `tfPartialPayment` → **danger** (the recipient may get far less; `DeliverMin` shown). Destination tag shown.
  Recipient checks against the ledger: not activated and less than the base reserve → danger (it fails); activated by
  this payment → info; `lsfRequireDestTag` without a tag → danger `memo-required`; `lsfDisallowXRP` → caution;
  `lsfDepositAuth` → caution; token without the recipient's trust line → danger. XRP to yourself → danger (rippled
  refuses it). Spending into the reserve → danger.
- **TrustSet**: "Add RLUSD to your account" (the reserve it locks) / "Remove … from your account"; look-alike tokens
  → `known-scam`.
- **OfferCreate** "Trade 10 XRP for 5 RLUSD" (kind: standing / immediate-or-cancel / fill-or-kill), **OfferCancel**.
- **AccountSet**: every `SetFlag`/`ClearFlag` (and the legacy tf flags) in words; Domain, transfer fee, NFT minter
  (caution), message key. `asfDisableMaster` → **danger `account-takeover`**. Unknown flags → blind.
- **SetRegularKey** "Give … control of your account" and **SignerListSet** → **danger `account-takeover`**.
- **AccountDelete** → **danger `account-closure`** (everything left goes to the destination; the fee is burned).
- **NFTokenMint / Burn / CreateOffer / AcceptOffer / CancelOffer**: the accepted offer is read with `ledger_entry`
  so the title says "Buy an NFT for 3 XRP" / "Sell your NFT for …"; a free sell offer to anyone → danger.
- **EscrowCreate / Finish / Cancel** (times in UTC from the Ripple epoch), **AMMDeposit / AMMWithdraw**.
- Anything else (checks, payment channels, MPTs, XChain, AMMCreate/Bid/Vote, Batch …), and any field the codec
  doesn't know (e.g. `Delegate`), is **blind**, and `prepare()` refuses it: Clip Wallet never signs bytes it can't
  serialise itself.

## Dapp connectivity (1Mask)

XLS-72d "Browser Wallet Standard" (https://github.com/XRPLF/XRPL-Standards/discussions/206; reference types
`@xrpl-wallet-standard/core`, https://github.com/tequdev/xrpl-wallet-standard) is Wallet Standard with two features,
`xrpl:signTransaction` and `xrpl:signAndSubmitTransaction`, and chains `xrpl:<network_id>`. A wallet registers itself
with `registerWallet`, under its own name and icon. 1Mask implements it (`packages/1mask/src/inpage/xrpl.ts`,
`background/xrpl.ts`). The XLS discussion was closed for inactivity in March 2026 and has no message-signing feature,
so there is no XRPL sign-in/sign-message in 1Mask.

Not implemented, on purpose: GemWallet's API (`@gemwallet/api`) and the Crossmark SDK talk to those specific
extensions by their own message names; answering them would mean pretending to be GemWallet or Crossmark.
xrpl-connect (XRPL Commons) ships one adapter per wallet (Xaman, Crossmark, GemWallet, WalletConnect) and doesn't
discover Wallet Standard wallets.

## Testnet funds

`POST https://faucet.altnet.rippletest.net/accounts` with `{ "destination": "r…" }` sends 100 test XRP to that
address (no captcha, no account; checked October 2026). Devnet: `https://faucet.devnet.rippletest.net/accounts`.
