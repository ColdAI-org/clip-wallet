# @clip-wallet/chains-antelope

Antelope `ChainModule` for Clip Wallet: Vaulta (formerly EOS), Telos and XPR Network, with their testnets. One K1 key
signs for all three. It builds, decodes and checks transactions in plain words and never touches keys: `prepare()`
returns SHA-256(chain_id ‖ packed_trx ‖ 32 zero bytes) for the vault to sign (`ecdsa-secp256k1`, canonical K1), and
`finalize()` checks the signature (verify, canonical, recovery id) before anything is assembled or sent.

No SDK at runtime: names, assets, keys, `SIG_K1_` strings, transactions and the ABI (de)serialiser are hand-written on
`@noble/hashes`, `@noble/curves` (verification and recovery only) and `@scure/base`. Tests check bytes, transaction
ids, digests and signature strings against `@wharfkit/antelope` (devDependency) and verify with
`Signature.verifyDigest` / `recoverDigest`.

## Networks

| network | NetworkId | chain API (public, no key) | Hyperion | explorer |
|---|---|---|---|---|
| Jungle4 (Vaulta testnet) | `antelope:73e4385a2708e6d7048834fbc1079f2f` | jungle4.greymass.com, jungle4.cryptolions.io, jungle4.api.eosnation.io | jungle4.cryptolions.io | jungle4.unicove.com |
| Vaulta | `antelope:aca376f206b8fc25a6ed44dbdc66547c` | eos.greymass.com, eos.api.eosnation.io | eos.eosusa.io | bloks.io |
| Telos Testnet | `antelope:1eaa0824707c8c16bd25145493bf062a` | testnet.telos.net, telos-testnet.cryptolions.io | testnet.telos.net | explorer-test.telos.net |
| Telos | `antelope:4667b205c6838ef70ff7988f6e8257e8` | mainnet.telos.net, telos.greymass.com | mainnet.telos.net | explorer.telos.net |
| XPR Network Testnet | `antelope:71ee83bcf52142d61019d95f9cc5427b` | tn1.protonnz.com, testnet.protonchain.com, proton-testnet.cryptolions.io | — | testnet.explorer.xprnetwork.org |
| XPR Network | `antelope:384da888112027f0321850a169f737c3` | proton.greymass.com, api.protonnz.com, proton.eosusa.io | proton.eosusa.io | explorer.xprnetwork.org |

- Ids: ChainAgnostic namespaces `antelope/caip2.md` ("antelope:" + the first 32 hex of the chain id; its test cases
  include EOS Mainnet and Telos Mainnet). `netOf` also takes the full chain id.
- Every endpoint answered `get_info` with the chain id above (October 2026). `send_transaction2` exists on all of
  them (`push_transaction` is the fallback on a 404). `get_accounts_by_authorizers` is load-balanced on
  testnet.telos.net (some backends 404), so the module tries every server, then Hyperion.

## Keys, accounts, addresses

`curve: "secp256k1"`, `derivationPath(i) = m/44'/194'/0'/0/i` (SLIP-44 194, TokenPocket). `Account.address` and
`addressFromPublicKey` give the key as `PUB_K1_…` (the vault's `antelopePublicKey`; legacy `EOS…` keys are parsed too).
Antelope accounts are 12-character names created on chain that point at keys, so:

- `accounts(ctx)` / `receiveAddress(ctx)`: the names whose permission this key satisfies alone (weight ≥ threshold), from
  `/v1/chain/get_accounts_by_authorizers`, else Hyperion `/v2/state/get_key_accounts`. `receiveAddress` returns the
  first (an `active` one first). None → ClipError `antelope/no-account` in plain words ("No Jungle4 account uses this
  key yet … create a free test account for your public key …" / on mainnets: an exchange, a friend or an
  account-creation service creates it).
- `isAddress` = a valid account name (what you send to); keys are not addresses. `networksForAddress` = every Antelope
  network (a name can exist on each, owned by different people).
- The public "abandon … about" key `PUB_K1_6zpSNY1Y…NK2aD4t` already has accounts made by strangers (kasekitest11 on
  Jungle4, binancegold4 on Vaulta). Never use that phrase for anything real.

## Assets

- Vaulta: **EOS** (eosio.token, key `eos`) is still the system token: RAM, PowerUp and staking are priced in it.
  **A** (Vaulta, core.vaulta, key `vaulta`; EOS and A swap 1:1 through core.vaulta) and **USDT** (Tether's own issue on
  tethertether, key `usdt`) are shown beside it. Jungle4 has EOS and A.
- Telos: **TLOS**; XPR Network: **XPR** (eosio.token, 4 decimals).
- Balances: `get_currency_balance` for those; other tokens from Hyperion `state/get_tokens` (non-zero only). A token
  that borrows a known symbol (EOS, A, USDT, TLOS, XPR, USD…) from another contract is `spam: true` (XPR mainnet has
  an "XPR" on `ternary`).
- `getNfts` returns `[]` (AtomicAssets has no `Nft.standard` value in core).

## Requests

There is no dapp standard to implement on the wallet side (below), so the methods are Clip Wallet's own:

| method | params | result |
|---|---|---|
| `antelope_signTransaction` | `{ transaction, account?, chainId? }` | `{ signatures: ["SIG_K1_…"], packed_trx, transaction_id }` |
| `antelope_signAndPushTransaction` | same | `{ transaction_id, processed? }` (send_transaction2) |

`transaction` is the abieos JSON; the header (expiration, ref_block_num, ref_block_prefix) may be left out, and is then
filled once in `decode()` (TAPoS from the last irreversible block, expiry 5 minutes after head) and cached per
request, so the signature covers what was shown. Action `data` is packed hex, or JSON serialised with the contract's
ABI (`/v1/chain/get_abi`, cached). eosio.token-style transfers of the known token contracts use a built-in ABI, so
`buildTransfer` makes no ABI call.

- Refused: another network, context-free actions or transaction extensions, an action no authorization of this key can
  sign ("This transaction doesn't need your signature"), a permission of our account this key doesn't hold, and on
  sign-and-push any other signer (co-signing is fine with `antelope_signTransaction`: "Also needs bob@active").
- Signature: r ‖ s + recovery from the vault → `SIG_K1_` (recovery byte = recid + 31, checksum RIPEMD-160(sig ‖ "K1")).
- Chain refusals in plain words (`plainAntelopeError`): CPU/NET exhausted → per network (Vaulta: rent with PowerUp;
  Telos: stake TLOS or PowerUp; XPR: the network covers CPU/NET for users, try again), RAM, overdrawn balance,
  expired, authorization, missing recipient, duplicate.

### decode()

- Any action whose ABI struct is the eosio.token transfer shape (from, to, quantity: asset, memo): "Send 1.5000 EOS to
  bob" with the memo, the balance change, a check that the recipient exists; an unknown contract's token → caution, a
  look-alike → danger `known-scam`.
- `eosio::updateauth` / `deleteauth` / `linkauth` → **danger `account-takeover`**; `unlinkauth` → caution.
- Anything else readable through the contract's ABI: "Call {action} on {contract}" with every field, caution
  `unknown-call`. Several actions: "Approve N operations" with "Action N" lines.
- No ABI, a type the serialiser doesn't know (floats, 128-bit integers, WebAuthn keys) or data that doesn't parse →
  **blind**.
- `delay_sec` > 0 → caution. The fee line says there's no token fee (CPU/NET, or covered by the network on XPR).

## Dapp connectivity: send/receive only

Checked October 2026; none lets a wallet extension answer under its own name:

- **WharfKit** (the current Antelope dapp SDK): the wallet *plugin* lives in the dapp (`@wharfkit/wallet-plugin-*`);
  a wallet appears in a dapp only when the dapp ships that wallet's plugin. Nothing for an extension to implement.
- **Anchor Link / ESR** (EOSIO Signing Requests over a Buoy relay): the dapp's `wallet-plugin-anchor` shows "Anchor";
  a different wallet answering it would appear as Anchor.
- **Scatter-compatible injection** (`window.scatter`, ScatterJS; what TokenPocket and the WharfKit Scatter /
  TokenPocket plugins use): answering it means pretending to be Scatter/TokenPocket (AGENTS.md rule 8).
- **XPR WebAuth** (proton-web-sdk) talks to WebAuth's own wallet and relay.

So 1Mask has no Antelope provider; sends and receives work from the wallet itself.

## Getting a testnet account (needs a person)

| network | create an account for a public key | test tokens |
|---|---|---|
| Jungle4 | `POST https://jungle4.greymass.com/account/create` `{ accountName: "<9 chars>.gm", ownerKey, activeKey, network: "73e4…6c4d" }` → 201 (what `npx @wharfkit/cli account create` sends; no captcha). Or monitor.jungletestnet.io (Google reCAPTCHA). | monitor.jungletestnet.io faucet (reCAPTCHA). New accounts also need CPU: PowerUp paid by the account, or another account |
| Telos Testnet | `POST https://api-dev.telos.net/v1/testnet/account` `{ accountName, ownerKey, activeKey }` (the app.telos.net testnet developer page calls it; no captcha, one per IP per 24 h) | `GET https://api-dev.telos.net/v1/testnet/faucet/<account>` (one per IP/account per 24 h) |
| XPR Testnet | `proton account:create` → `identity.api.dev.metalx.com` with an e-mail address and a 6-digit code sent to it (or the WebAuth testnet app) | `token.faucet::claim` on chain (`proton faucet:claim XPR <account>@active`) |
