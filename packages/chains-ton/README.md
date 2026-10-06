# @clip-wallet/chains-ton

TON `ChainModule` for Clip Wallet. It builds, decodes, emulates and broadcasts, but it never touches keys.
`prepare()` returns the 32-byte hash to sign as an `ed25519` payload:
- transfers: the wallet's signing-message cell hash
- `signData` and `ton_proof`: the TON Connect hash

`finalize()` verifies the signature, assembles the external message and sends it.

Built on `@ton/core` 0.63 and `@ton/ton` 16.3: the wallet contract classes, using their `signer` hook so no secret
key is ever needed. `@ton/crypto` is only a peer dependency of those packages; this module never imports it.
`@noble/curves` is used for verification only, and `@noble/hashes` for sha256. `src/buffer.ts` installs the
`buffer` package as `globalThis.Buffer` when it's missing, because @ton/* need it in browsers and MV3 workers.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/chains-ton @clip-wallet/core
```

## Example

```ts
import type { ChainModule } from "@clip-wallet/core";
import { createTonModule, TON_TESTNET } from "@clip-wallet/chains-ton";

// A wallet's background holds one module per family; it never gives the module a key.
const module: ChainModule = createTonModule();
console.log(module.family, module.derivationPath(0)); // "ton" "m/44'/607'/0'"

const network = TON_TESTNET;
console.log(network.id, network.testnet); // a CAIP-2 id, true

// The flow: decode() → the person approves → prepare() → the vault signs → finalize().
```

## Documentation

- [Chain modules](https://coldai.org/clip/docs/architecture/chain-modules.html)
- [Write a chain module](https://coldai.org/clip/docs/extend/chain-module.html)
- [The TON Connect guide for dapps](https://coldai.org/clip/docs/dapps/ton.html)
- [API reference](https://coldai.org/clip/docs/reference/api/chains-ton.html)

## Networks

| network | NetworkId | TON Connect `network` | endpoints (keyless, about 1 request/s) | explorer |
|---|---|---|---|---|
| testnet | `ton:-3` | `"-3"` | `testnet.toncenter.com/api`, `testnet.tonapi.io` | testnet.tonviewer.com |
| mainnet | `ton:-239` | `"-239"` | `toncenter.com/api`, `tonapi.io` | tonviewer.com |

- `ton:<global_id>` is the id WalletConnect/Reown's TON reference uses. TON Connect carries the bare global_id
  (`NETWORK` enum, ton-connect/docs `spec/connect.md`). ChainAgnostic uses `tvm:<global_id>`. `fromChainId`
  accepts all three.
- The client spaces calls to the same host 1.1 s apart and retries a 429 once.
- **The native coin is GRAM.** Toncoin was renamed Gram (ticker GRAM) on 2026-06-15 after the community vote. Only
  the name changed. Asset key `gram`, 9 decimals.
- Jettons: Tether's USD₮ (mainnet, `0:b113…1dfe`) is `usdt`. Others are `ton:<master raw>`. Spam if tonapi
  blacklists the jetton or its symbol copies a curated one.

## Wallet contract

- **v5r1 by default**, matching the vault (`tonWalletVersion` default) and Tonkeeper.
- `walletVersion: "v4r2"` is the module option for Trust Wallet-compatible accounts.
- v5r1's wallet id includes the network, so testnet and mainnet addresses differ. `addressFromPublicKey(pk, net)`
  and `walletAddress()` always compute for `ctx.network`. Addresses are non-bounceable (`0Q…` testnet, `UQ…`
  mainnet), the same as the vault's encoding. A test checks both versions on both networks against the vault.
- A real testnet v5r1 wallet (public key read with `get_public_key`) maps to its on-chain address.
- A first-use external message built by `finalize()` is byte-identical to `@ton/ton`'s own secret-key path.
- Send mode 3 (pay fees separately, ignore errors), as TON Connect requires.
- `timeout` is `valid_until`, capped at now + 10 minutes. Without `valid_until` it's 5 minutes.
- Uninitialized wallets send `seqno 0` with the StateInit, and `decode()` says so plainly.
- Derivation path recorded: `m/44'/607'/i'`. Tonkeeper/Telegram TON-native 24-word phrases aren't BIP-39; see the
  vault README.

## Requests

| method | params | result |
|---|---|---|
| `sendTransaction` (TON Connect), `ton_sendMessage` (WalletConnect) | payload object, JSON string, or `[jsonString]`: `{ valid_until?, network?, from?, messages \| items }` | base64 BoC of the external message |
| `signData`, `ton_signData` | `{ type: "text" \| "binary" \| "cell", … }` | `{ signature, address (raw), timestamp, domain, payload }` |
| `ton_proof` (from the connect flow) | `{ payload }` | `{ name: "ton_proof", proof: { timestamp, domain, signature, payload } }` |
| `signMessage` | — | refused (not advertised) |

Shapes and hashes follow ton-connect/docs `spec/rpc.md` and `spec/connect.md` (ton-connect/docs, cloned
2026-10-03):
- `ton_proof` uses little-endian domain length and timestamp, and signs
  `sha256(0xffff ‖ "ton-connect" ‖ sha256(msg))`.
- `signData` text/binary is `sha256(0xffff ‖ "ton-connect/sign-data/" ‖ …)` with big-endian integers, as in the
  reference implementation github.com/mois-ilya/ton-sign-data-reference.
- `signData` cell uses `0x75569022`, CRC-32 of the schema, and the TEP-81 DNS-wire domain.
- The domain is always the requesting site's host, never the manifest's.

### decode()

Request checks (each refusal is in plain words):
- `network` must be this network.
- `from` must be this wallet.
- `valid_until` must not have passed.
- No more messages than the wallet allows (255 for v5r1, 4 for v4r2).
- Raw-form addresses are refused, because TON Connect says wallets MUST reject them.
- Bounce and test-only flags come from the friendly address. A test-only address on mainnet gets
  `network-matters`.

What each message shows:
- **Plain transfers and comments**: "Send 1.5 GRAM to 0QB…".
- **TEP-74 jetton transfer**:
  - The token wallet is read with `get_wallet_data`. If it isn't yours, the request is **blind** with a danger
    warning.
  - The token, amount, recipient, forward amount and comment are shown.
  - The attached GRAM is shown as "covers token fees (unused part comes back)".
- **Jetton burn**: caution.
- **TEP-62 NFT transfer**: the name comes from tonapi, with a caution if you don't own the NFT.
- **Unknown opcode**: blind, shown as "Operation 0x…".
- **StateInit attached**: shown as an extra line.

Structured `items` (`ton`, `jetton`, `nft`) are turned into real messages:
- Your jetton wallet comes from tonapi.
- When the app doesn't say, the attached amount is forward + 0.05 GRAM and the forward amount is 1 nanogram.

Emulation and fees:
- **Emulation** uses tonapi `POST /v2/accounts/{me}/events/emulate?ignore_signature_check=true`. The emulated
  message carries a zero signature, so no key is involved.
- Balance changes come from the `TonTransfer` and `JettonTransfer` actions. The fee is `-extra`.
- If emulation isn't available, `decode()` adds the "We couldn't preview this" caution and takes the fee from
  toncenter `v2/estimateFee` (`ignore_chksig`).
- If the GRAM balance can't cover the transfer plus its fee, you get a `high-fee` danger.

`signData` text is shown verbatim. Binary and cell data are **blind** with a warning, as the spec asks. Cell data
isn't parsed against its TL-B schema yet.

## Balances and NFTs

- GRAM comes from toncenter v3 `walletInformation`.
- Jettons come from tonapi `/v2/accounts/{id}/jettons`; zero balances are skipped.
- NFTs come from tonapi `/v2/accounts/{id}/nfts`, as core `Nft.standard: "tep62"`. That standard is an additive
  core change.
- Media URLs are untrusted.

## Exports for 1Mask

- `tonAddrItem(publicKey, network)`: the TON Connect `ton_addr` reply. It includes `walletStateInit`, whose hash is
  the address, as proof verifiers check.
- `features`: the `DeviceInfo.features` value.

## DeFi message bodies (`src/defi.ts`)

Builders and parsers for wallet-built DeFi messages, so `@clip-wallet/features` never imports @ton/core and its
tests parse the real BoCs back. Sources read 2026-10-03:

| helper | op | source |
|---|---|---|
| `stonfiSwapPayload` / `parseStonfiSwapPayload` | `0x6664de2a` | ston-fi/sdk `contracts/dex/v2_1/router/BaseRouterV2_1.ts` `createSwapBody` (v2.2 routers inherit it) |
| `ptonTransferBody` / `parsePtonTransfer` | `0x01f3835d` | ston-fi/sdk `contracts/pTON/v2_1/PtonV2_1.ts` |
| `tonstakersDepositBody` / `parseTonstakersDeposit` | `0x47d54391` | ton-blockchain/liquid-staking-contract `contracts/op-codes.func`, `pool.func` |
| `jettonBurnBody` / `parseJettonBurn` | `0x595f07bc` | TEP-74 burn; Tonstakers custom payload bits from tonstakers/tonstakers-sdk `src/tonstakers.ts` |
| `parseJettonTransferFull` | `0x0f8a7ea5` | TEP-74, with the forward payload as a cell |

Also: `sameTonAddress`, `rawTonAddress`, `friendlyTonAddress`, `addressCellHex` / `addressFromCellHex` (tonapi
get-method cells), `cellToB64` / `cellFromBase64`, `opOf`. A test checks the STON.fi payload hash against the SDK's
layout. The module itself is unchanged: pTON and Tonstakers deposits still decode as blind ("Operation 0x…"); the
features layer lifts that only through `Step.verify` plus a clean emulation.

## Gaps

- `signMessage` (gasless relays) isn't supported yet; it needs v5r1 `authType: "internal"`.
- Extra currencies are refused.
- Cell `signData` isn't decoded against its TL-B schema.
- toncenter's keyless tier is slow (about 1 request/s). Point `Network.rpcUrls` / `indexerUrl` at
  keyed endpoints in production.

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

Apache-2.0: see [LICENSE](./LICENSE) and [NOTICE](./NOTICE). "Clip Wallet" and "1Mask" are ColdAI trademarks (not licensed).
