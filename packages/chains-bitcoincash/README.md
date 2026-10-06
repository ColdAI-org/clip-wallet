# @clip-wallet/chains-bitcoincash

Bitcoin Cash `ChainModule` for Clip Wallet. It builds and decodes BCH transactions in plain words and never touches
keys. `prepare()` returns one 32-byte BCH sighash per input the account signs; `finalize()` checks each signature
with `secp256k1.verify`, DER-encodes it with the sighash byte `0x41`, builds the P2PKH unlocking bytecode and
broadcasts through Fulcrum when the request asks for it.

Everything is hand-written with `@noble/hashes` and `@noble/curves` (verification only): CashAddr, the transaction
format with CashTokens prefixes, the BCH signing serialization, DER, the Electrum Cash client. `@bitauth/libauth` 3 is
a dev dependency: the tests compare our addresses, transaction bytes and sighashes with it and run every signed
transaction through its BCH 2023 virtual machine (`createVirtualMachineBCH().verify`).

## Networks

| NetworkId (CAIP-2) | network | prefix | WalletConnect (wc2-bch-bcr) | Fulcrum (wss, in order) | explorer |
|---|---|---|---|---|---|
| `bip122:00000000040ba9641ba98a37b2e5ceea` | chipnet (default test network) | `bchtest` | `bch:bchtest` | chipnet.imaginary.cash:50004, chipnet.bch.ninja:50004, chipnet.c3-soft.com:64004, cbch.loping.net:62104 | https://cbch.loping.net |
| `bip122:000000001dd410c49a788668ce267517` | testnet4 | `bchtest` | `bch:bchtest` | testnet4.imaginary.cash:50004, tbch4.loping.net:62004 | https://tbch4.loping.net |
| `bip122:000000000000000000651ef99cb9fcbe` | mainnet | `bitcoincash` | `bch:bitcoincash` | bch.imaginary.cash:50004, electrum.imaginary.cash:50004, bch.loping.net:50004, bch.soul-dev.com:50004 | https://bch.loping.net |

- Ids: BIP-122 / ChainAgnostic `bip122` (first 32 hex of a block hash). BCH shares Bitcoin's genesis, so the
  namespace's own test case names BCH mainnet by its first block after the split (478559). Chipnet is named the same
  way by its first block after it left testnet4 (115252, found by comparing both chains' headers on Fulcrum);
  testnet4 by its genesis. None collides with chains-bitcoin.
- The BCH wallet community's WalletConnect spec uses `bch:bitcoincash` and `bch:bchtest` (any testnet) instead:
  `BCH_NETS[n].wcChain`, and 1Mask's `BCH_WC_CHAINS` maps them (bchtest → chipnet).
- Every Fulcrum server above answered `server.version` (Fulcrum 2.1.x, protocol 1.4),
  `blockchain.scripthash.get_balance`, `blockchain.headers.get_tip` and `blockchain.relayfee` (2026-10). They're
  tried in order; the next one is used when one can't be reached. Calls: `blockchain.scripthash.get_balance`,
  `listunspent` (with `token_data`), `blockchain.relayfee`, `blockchain.transaction.broadcast`.
- Faucet: https://tbch.googol.cash (testnet3, testnet4 and chipnet): no account, but a simple image captcha (type
  the sum of the numbers shown).

Assets: BCH is `bch` (8 decimals). Fungible CashTokens are `cashtoken:<category>` (no metadata registry is
trusted, so they show as `CT-<first 6 hex>` with 0 decimals). `getNfts` returns `[]`.

## Accounts and addresses

- `derivationPath(i)` = `m/44'/145'/0'/0/i` (Electron Cash, Paytaca, Cashonize), secp256k1, the same key on every
  network.
- P2PKH CashAddr, spelled per network: `bitcoincash:q…` on mainnet, `bchtest:q…` on chipnet / testnet4.
  `Account.address` is the mainnet form; `receiveAddress(ctx)` / `addressFromPublicKey(key, network)` give the
  network's. Fixtures: "abandon … about" → `bitcoincash:qqyx49mu…tahq3q6`, as libauth encodes it.
- `isAddress` accepts CashAddr P2PKH / P2SH (20 and 32-byte) and the token-aware `z…` / `r…` forms, with or without
  the prefix, checksum verified; mixed case and legacy base58 (`1…`, `3…`, which Bitcoin uses too) are refused.

## Sending (`buildTransfer`)

- Coins from `listunspent`, largest first. A coin that carries CashTokens is never spent by a plain BCH send (it
  would burn the tokens).
- Fee: the server's relay fee (1 sat/byte on every network today), at least `minFeeRate` (default 1). Size estimate
  148 bytes per P2PKH input, 34 per output, 10 overhead.
- Dust limit 546 sats: smaller sends are refused; change under it goes to the fee.
- **Change goes back to the same address** (the account's one P2PKH address; there is no change chain). Electron
  Cash and Paytaca will see it like any other coin of that address.
- The request is a `bch_signTransaction` with the unsigned transaction hex, the coins as libauth-stringified
  source outputs and `broadcast: true`, so wallet sends and app requests go through the same decoder.

## Methods (`BCH_METHODS`, wc2-bch-bcr)

| method | params | result |
|---|---|---|
| `bch_signTransaction` | `{ transaction: hex \| libauth Transaction \| stringify(Transaction), sourceOutputs: (stringified) libauth source outputs, broadcast? = true, userPrompt? }` | `{ signedTransaction: hex, signedTransactionHash: txid }` |
| `bch_signMessage` | `{ message, userPrompt? }` | base64 compact signature (Electron Cash format) |
| `bch_getAddresses` | (answered by 1Mask, not the module) | `["bchtest:q…"]` |

- Signs every input whose source output is this account's P2PKH and whose unlocking bytecode is empty. Other
  inputs (CashScript contracts, other people) are left as the app sent them.
- wc2-bch-bcr's zero-filled pubkey (33 bytes) / Schnorr signature (65 bytes) placeholders for CashScript contract
  arguments are **refused** in plain words (`bitcoincash/unsupported-contract`): the vault signs ECDSA only.
- Source outputs must match the inputs one to one (same outpoints, same order) or the request is unreadable (blind).
- Refusals: other network → `bitcoincash/network-mismatch`; no input of ours → `bitcoincash/not-a-signer`.

### What gets signed (`prepare`)

- **Inputs:** double SHA-256 of version ‖ hashPrevouts ‖ hashSequence ‖ outpoint ‖ the spent output's token prefix
  ‖ scriptCode (our P2PKH) ‖ value ‖ sequence ‖ hashOutputs ‖ locktime ‖ `41 00 00 00` (SIGHASH_ALL | FORKID, fork
  id 0). The token prefix and the value are committed, so an app can't lie about our coins.
- **Messages:** double SHA-256 of CompactSize(24) ‖ "Bitcoin Signed Message:\n" ‖ CompactSize(len) ‖ message;
  answered as base64(27 + recovery + 4 ‖ r ‖ s).

### Decoding

"Send 0.0003 BCH to qp8sfd…q4lg", one line per recipient (tokens included), "You get back" for change to this
address, the network fee, data outputs (OP_RETURN), the app's contract name and prompt (marked unverified), how
many inputs belong to others. Balance changes are this account's BCH in − out and token amounts. CashTokens leaving
the wallet get a caution. A fee above 20 sat/byte (and 10,000 sats) is a "high fee" caution.

## Dapp connectivity

There's no injected-provider standard for BCH (Paytaca's extension injects its own `window.paytaca`, which another
wallet mustn't imitate). Dapps reach wallets over WalletConnect v2 with wc2-bch-bcr, where the wallet shows up
under its own metadata. `@clip-wallet/1mask` has the pieces: `shared/bitcoincash.ts` (namespace, methods, chain
mapping, CashAddr re-spelling) and `background/bitcoincash.ts` (`createBitcoinCashDispatcher`); the WalletConnect
session layer still has to accept the `bch` namespace and map its chains (integration step). Until then the family
is send/receive in the wallet itself.

## Not supported (yet)

Sending CashTokens, CashScript placeholders (Schnorr), P2SH spending, NFTs in `getNfts`, BCMR token metadata.
