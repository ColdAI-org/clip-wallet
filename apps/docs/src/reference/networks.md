# Networks

Clip Wallet supports **85 of the 87 CLPR networks** on mainnet, and **93 mainnets** in total, across 26 network
families. The two CLPR networks it doesn't support, Canton and Mixin, have no model in which a self-custodial key
wallet can hold and move funds on its own: see [Not supported](#not-supported).

::: warning Test networks first
Clip Wallet is pre-release and runs on test networks unless a build opts in to mainnet behind a checklist. "Supported
on mainnet" means the wallet's catalogue has the network and a build can be switched to it; see
[Mainnet](../kit/build-and-ship.md#mainnet).
:::

The coverage isn't written by hand. [`packages/engine/test/networks87.test.ts`](repo:packages/engine/test/networks87.test.ts)
maps each CLPR network to the mainnet(s) in the wallet's own catalogue (`walletNetworks()` with every family on), fails
if anything but Canton and Mixin is missing, and prints the table:

```sh
pnpm --filter @clip-wallet/engine exec vitest run test/networks87.test.ts
```

The working notes behind this page are in [`docs/r1/networks87.md`](repo:docs/r1/networks87.md).

## How the count works

- **85 of 87 CLPR networks** have at least one mainnet in the catalogue.
- **93 mainnets** counts every mainnet the wallet ships, CLPR or not: 60 EVM networks (without "Hedera (EVM)"), one
  each for Hedera, Solana, Bitcoin, Sui, Aptos, Cardano, Starknet, TON, NEAR, Stellar, Tezos and Algorand, five
  Polkadot SDK networks (Polkadot, Kusama, both Asset Hubs, Chainflip), six Cosmos SDK networks (Osmosis, dYdX,
  ZIGChain, Provenance, THORChain, Initia), TRON, XRP Ledger, MultiversX, Internet Computer, Stacks, Fuel, Bitcoin Cash,
  and Vaulta, Telos (native) and XPR Network. Polkadot, Kusama and the Asset Hubs aren't CLPR networks; Telos counts
  once as an EVM network and once natively.

## Supported CLPR networks

Network ids are CAIP-2 where a namespace exists (each chain package's README cites its sources). Dapp connectivity is
per family; every family also sends and receives in the wallet itself. "(new)" marks the networks added with the
twelve newer families and the Chainflip, STRATO and Arc additions.

| Network | Module and mainnet network id | Dapp connectivity | Notes |
| --- | --- | --- | --- |
| Abstract | `chains-evm` `eip155:2741` | EIP-6963 / EIP-1193 |  |
| Algorand | `chains-algorand` `algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k` | existing provider |  |
| Anubis | `chains-evm` `eip155:6714` | EIP-6963 / EIP-1193 |  |
| Arbitrum Nova | `chains-evm` `eip155:42170` | EIP-6963 / EIP-1193 |  |
| Arbitrum One | `chains-evm` `eip155:42161` | EIP-6963 / EIP-1193 |  |
| Arc (new) | `chains-evm` `eip155:5042` | EIP-6963 / EIP-1193 | Arc mainnet (5042) went live 2026-09-16; before, only the testnet was in the list |
| Aurora | `chains-evm` `eip155:1313161554` | EIP-6963 / EIP-1193 |  |
| Avalanche C-Chain | `chains-evm` `eip155:43114` | EIP-6963 / EIP-1193 |  |
| Base | `chains-evm` `eip155:8453` | EIP-6963 / EIP-1193 |  |
| Bifrost Network | `chains-evm` `eip155:3068` | EIP-6963 / EIP-1193 | EVM layer |
| Bitcoin | `chains-bitcoin` `bip122:000000000019d6689c085ae165831e93` | existing provider |  |
| Bitcoin Cash (new) | `chains-bitcoincash` `bip122:000000000000000000651ef99cb9fcbe` | WalletConnect wc2-bch-bcr (no injected standard) |  |
| Bittensor | `chains-evm` `eip155:964` | EIP-6963 / EIP-1193 | EVM layer |
| Blast | `chains-evm` `eip155:81457` | EIP-6963 / EIP-1193 |  |
| BNB Smart Chain | `chains-evm` `eip155:56` | EIP-6963 / EIP-1193 |  |
| BOB | `chains-evm` `eip155:60808` | EIP-6963 / EIP-1193 |  |
| BOT Chain | `chains-evm` `eip155:677` | EIP-6963 / EIP-1193 |  |
| Cardano | `chains-cardano` `cip34:1-764824073` | existing provider |  |
| Celo | `chains-evm` `eip155:42220` | EIP-6963 / EIP-1193 |  |
| Chainflip (new) | `chains-substrate` `polkadot:8b8c140b0af9db70686583e3f6bf2a59` | window.injectedWeb3 (polkadot extension-dapp) | State Chain FLIP from Flip.Account; no FLIP transfer exists (redeem to Ethereum); LP-portal calls decoded |
| Conflux | `chains-evm` `eip155:1030` | EIP-6963 / EIP-1193 | Conflux eSpace (EVM); Core Space not supported |
| Core | `chains-evm` `eip155:1116` | EIP-6963 / EIP-1193 |  |
| Cronos | `chains-evm` `eip155:25` | EIP-6963 / EIP-1193 | EVM layer |
| dYdX (new) | `chains-cosmos` `cosmos:dydx-mainnet-1` | Keplr-compatible API at window.clipwallet.cosmos | coin type 118 |
| Ethereum | `chains-evm` `eip155:1` | EIP-6963 / EIP-1193 |  |
| Etherlink | `chains-evm` `eip155:42793` | EIP-6963 / EIP-1193 | EVM layer of Tezos smart rollups |
| Flare | `chains-evm` `eip155:14` | EIP-6963 / EIP-1193 |  |
| Fraxtal | `chains-evm` `eip155:252` | EIP-6963 / EIP-1193 |  |
| Fuel (new) | `chains-fuel` `fuel:9889` | FuelConnector event |  |
| Gnosis Chain | `chains-evm` `eip155:100` | EIP-6963 / EIP-1193 |  |
| GRX Chain | `chains-evm` `eip155:1110` | EIP-6963 / EIP-1193 |  |
| Hydration | `chains-evm` `eip155:222222` | EIP-6963 / EIP-1193 | EVM layer |
| Hyperliquid | `chains-evm` `eip155:999` | EIP-6963 / EIP-1193 | HyperEVM |
| ICP (new) | `chains-icp` `icp:737ba355e855bd4b61279056603e0550` | none: send/receive only (ICRC-94 discovery still a draft) | no public transfer testnet: icp:test = mainnet limited to DFINITY test ledgers; replies not certificate-verified |
| Immutable zkEVM | `chains-evm` `eip155:13371` | EIP-6963 / EIP-1193 |  |
| Initia (new) | `chains-cosmos` `cosmos:interwoven-1` | Keplr-compatible API at window.clipwallet.cosmos | coin type 60, ethsecp256k1: the EVM key |
| Injective | `chains-evm` `eip155:1776` | EIP-6963 / EIP-1193 | EVM layer |
| Ink | `chains-evm` `eip155:57073` | EIP-6963 / EIP-1193 |  |
| Kaia | `chains-evm` `eip155:8217` | EIP-6963 / EIP-1193 | Kaia is EVM (8217) |
| Katana | `chains-evm` `eip155:747474` | EIP-6963 / EIP-1193 |  |
| Kava | `chains-evm` `eip155:2222` | EIP-6963 / EIP-1193 | EVM layer |
| KUB Chain | `chains-evm` `eip155:96` | EIP-6963 / EIP-1193 |  |
| Linea | `chains-evm` `eip155:59144` | EIP-6963 / EIP-1193 |  |
| Mantle | `chains-evm` `eip155:5000` | EIP-6963 / EIP-1193 |  |
| MANTRA | `chains-evm` `eip155:5888` | EIP-6963 / EIP-1193 | EVM layer |
| MegaETH | `chains-evm` `eip155:4326` | EIP-6963 / EIP-1193 |  |
| Mezo | `chains-evm` `eip155:31612` | EIP-6963 / EIP-1193 | EVM layer |
| Monad | `chains-evm` `eip155:143` | EIP-6963 / EIP-1193 |  |
| Morph | `chains-evm` `eip155:2818` | EIP-6963 / EIP-1193 |  |
| MultiversX (new) | `chains-multiversx` `mvx:1` | best effort: sdk-dapp's undocumented window.multiversx.providers hook |  |
| NEAR | `chains-near` `near:mainnet` | existing provider |  |
| OP Mainnet | `chains-evm` `eip155:10` | EIP-6963 / EIP-1193 |  |
| Osmosis (new) | `chains-cosmos` `cosmos:osmosis-1` | Keplr-compatible API at window.clipwallet.cosmos | coin type 118 |
| Plasma | `chains-evm` `eip155:9745` | EIP-6963 / EIP-1193 |  |
| Plume | `chains-evm` `eip155:98866` | EIP-6963 / EIP-1193 |  |
| Polygon PoS | `chains-evm` `eip155:137` | EIP-6963 / EIP-1193 |  |
| Provenance (new) | `chains-cosmos` `cosmos:pio-mainnet-1` | Keplr-compatible API at window.clipwallet.cosmos | coin type 505 (Keplr's testnet uses 1: different key there) |
| PulseChain | `chains-evm` `eip155:369` | EIP-6963 / EIP-1193 |  |
| Reya | `chains-evm` `eip155:1729` | EIP-6963 / EIP-1193 |  |
| RISE | `chains-evm` `eip155:4153` | EIP-6963 / EIP-1193 |  |
| Robinhood Chain | `chains-evm` `eip155:4663` | EIP-6963 / EIP-1193 |  |
| Ronin | `chains-evm` `eip155:2020` | EIP-6963 / EIP-1193 |  |
| Rootstock | `chains-evm` `eip155:30` | EIP-6963 / EIP-1193 |  |
| Scroll | `chains-evm` `eip155:534352` | EIP-6963 / EIP-1193 |  |
| Sei | `chains-evm` `eip155:1329` | EIP-6963 / EIP-1193 | EVM layer |
| Solana | `chains-solana` `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | existing provider |  |
| Soneium | `chains-evm` `eip155:1868` | EIP-6963 / EIP-1193 |  |
| Stable | `chains-evm` `eip155:988` | EIP-6963 / EIP-1193 | EVM layer |
| Stacks (new) | `chains-stacks` `stacks:1` | SIP-030 + WBIP-004 |  |
| Starknet | `chains-starknet` `starknet:SN_MAIN` | existing provider |  |
| Stellar | `chains-stellar` `stellar:pubnet` | existing provider |  |
| STRATO (new) | `chains-evm` `eip155:123354377739506` | EIP-6963 / EIP-1193 | SolidVM, but nodes take signed legacy Ethereum transactions; flat 0.01 USDST fee per transaction |
| Telos | `chains-evm` `eip155:40` | EIP-6963 / EIP-1193 | Telos EVM (and Telos native in chains-antelope) |
| Tezos | `chains-tezos` `tezos:NetXdQprcVkpaWU` | existing provider |  |
| THORChain (new) | `chains-cosmos` `cosmos:thorchain-1` | Keplr-compatible API at window.clipwallet.cosmos | mainnet only: stagenet runs on real funds |
| TON | `chains-ton` `ton:-239` | existing provider |  |
| TRON (new) | `chains-tron` `tron:0x2b6653dc` | TIP-1193 + TIP-6963 |  |
| Unichain | `chains-evm` `eip155:130` | EIP-6963 / EIP-1193 |  |
| Vaulta (new) | `chains-antelope` `antelope:aca376f206b8fc25a6ed44dbdc66547c` | none: send/receive only | accounts are names created on chain; receive needs one for this key |
| World Chain | `chains-evm` `eip155:480` | EIP-6963 / EIP-1193 |  |
| X Layer | `chains-evm` `eip155:196` | EIP-6963 / EIP-1193 |  |
| XPR Network (new) | `chains-antelope` `antelope:384da888112027f0321850a169f737c3` | none: send/receive only | accounts are names created on chain |
| XRP Ledger (new) | `chains-xrpl` `xrpl:0` | XLS-72d Wallet Standard (no message signing) |  |
| ZIGChain (new) | `chains-cosmos` `cosmos:zigchain-1` | Keplr-compatible API at window.clipwallet.cosmos | coin type 118 |
| ZKsync Era | `chains-evm` `eip155:324` | EIP-6963 / EIP-1193 |  |

## Families and derivation paths

Every derivation is in `@clip-wallet/vault`, the only package that touches keys, and is cross-checked for the public
"abandon … about" test phrase against each ecosystem's own SDK
([`packages/vault/test/families87.test.ts`](repo:packages/vault/test/families87.test.ts)). Each chain module serializes
transactions itself and is checked byte for byte against the official SDK, which is a development dependency only; a
module's runtime dependencies are `@clip-wallet/core`, `@noble/*` and `@scure/base`.

| Family (vault) | Path (account `i`) | Package | Mainnets / testnets | Dapp standard in 1Mask |
| --- | --- | --- | --- | --- |
| `cosmos` | `m/44'/118'/0'/0/i` | `chains-cosmos` | Osmosis, dYdX, ZIGChain / osmo-test-5, dydx-testnet-4, zig-test-2 | Keplr-compatible API (`enable`, `getKey`, `signDirect`, `signAmino`, `signArbitrary`, `verifyArbitrary`, `sendTx`, offline signers) at `window.clipwallet.cosmos`; never `window.keplr` |
| `provenance` | `m/44'/505'/0'/0/i` | `chains-cosmos` | Provenance / pio-testnet-1 | same |
| `thorchain` | `m/44'/931'/0'/0/i` | `chains-cosmos` | THORChain / none (stagenet uses real funds) | same |
| `initia` | `m/44'/60'/0'/0/i` (ethsecp256k1) | `chains-cosmos` | Initia / initiation-2 | same |
| `tron` | `m/44'/195'/0'/0/i` | `chains-tron` | TRON / Nile, Shasta | TIP-1193 provider announced with TIP-6963; TronWeb-shaped signing subset (`trx.sign`, `signMessageV2`) |
| `xrpl` | `m/44'/144'/i'/0/0` | `chains-xrpl` | XRP Ledger / testnet, devnet | XLS-72d (Wallet Standard `xrpl:signTransaction`, `xrpl:signAndSubmitTransaction`); no message signing in the standard |
| `antelope` | `m/44'/194'/0'/0/i` (K1, canonical signatures) | `chains-antelope` | Vaulta, Telos, XPR Network / Jungle4, Telos testnet, XPR testnet | none: send/receive only (WharfKit wallet plugins live in the dapp; Anchor Link/ESR and Scatter injection would mean posing as Anchor or Scatter) |
| `multiversx` | `m/44'/508'/0'/0'/i'` | `chains-multiversx` | MultiversX / devnet, testnet | best effort: an entry on sdk-dapp's `window.multiversx.providers` custom-provider hook under Clip's own name. **Undocumented and subject to change**; it only works on dapps that don't reset `window.multiversx` (MultiversX's own template dapp does). WalletConnect `mvx_*` methods are handled by the module |
| `icp` | `m/44'/223'/0'/0/i` | `chains-icp` | Internet Computer / `icp:test` (mainnet limited to DFINITY test ledgers) | none: ICRC-94 (extension discovery) is still a draft; Plug's `window.ic.plug` is proprietary |
| `stacks` | `m/44'/5757'/0'/0/i` | `chains-stacks` | Stacks / testnet | SIP-030 `request` on `window.clipwallet.stacks`, registered on `window.wbip_providers` (WBIP-004) |
| `fuel` | `m/44'/1179993420'/i'/0/0` | `chains-fuel` | Fuel Ignition / testnet | FuelConnector announced with the `FuelConnector` event, dependency-free |
| `bitcoincash` | `m/44'/145'/0'/0/i` | `chains-bitcoincash` | Bitcoin Cash / chipnet, testnet4 | WalletConnect `bch` namespace (wc2-bch-bcr, as Cashonize/Paytaca); no injected standard |
| `substrate` (existing) | existing | `chains-substrate` | + Chainflip / Perseverance | existing `window.injectedWeb3` (what lp.chainflip.io uses) |
| `evm` (existing) | existing | `chains-evm` | + STRATO, Arc / STRATO Helium | existing EIP-6963 |

The dapp side of each family: [Clip works with your dapp](../dapps/).

## Not supported

### Canton

Canton is a network of participant (validator) nodes that host parties. Canton 3.x has "external parties" whose key is
held outside the node, and CIP-0103 defines a dapp API for wallets, but every read of a party's contracts and every
submission (prepare, sign the hash, execute) goes through the Ledger API of a participant that hosts the party, behind
that operator's authentication, with no public endpoint. A wallet can hold the key but can't see or move anything
without an operator relationship.

**Closest honest support:** none in Clip Wallet as shipped. A kit-built wallet whose operator runs (or contracts) a
validator could add a family that talks to its own participant through a CIP-0103 wallet gateway: an operator product,
not a wallet derived from a recovery phrase.

### Mixin

Mixin's kernel is a UTXO DAG with CryptoNote-style one-time output keys. Its public RPC has no address or key index,
so a wallet can't find its own outputs without scanning every snapshot with the view key, and there is no BIP-39
derivation standard for kernel keys. User funds live in Mixin's account system (Mixin Messenger and Safe, with
registered accounts and keys behind Mixin's API).

**Closest honest support:** none. XIN as an ERC-20 on Ethereum is an asset, not the network.

## Limits worth knowing

- **STRATO** works through its Ethereum JSON-RPC: legacy (EIP-155) transactions only, gas unpriced, and a flat
  0.01 USDST (or voucher) per transaction that the approval shows as its own line. Contract calls are matched to
  SolidVM functions by selector; STRATO's EIP-712 "function call" transactions are out of scope.
- **Arc** mainnet launched on 2026-09-16; its native gas is USDC (18 decimals on the EVM side).
- **Antelope** accounts (Vaulta, Telos, XPR Network) must be created on chain by someone, because they cost RAM. Clip
  finds the accounts that use its key and says plainly when there is none yet. No dapp connector: send and receive only.
- **Internet Computer** replies aren't certificate-verified (no BLS check); nothing security-relevant relies on them.
  An ICP transfer must be approved within 4 minutes (ingress expiry). There is no public transfer testnet: `icp:test`
  is mainnet limited to DFINITY's test ledgers. No dapp connector: send and receive only.
- **THORChain** has no public testnet (stagenet runs on real funds). Swaps (deposit memos) decode as blind.
- **Provenance and Initia testnets:** Keplr derives pio-testnet-1 at coin type 1 and initiation-2 at 118; Clip uses the
  mainnet coin types (505, 60) everywhere, so those testnet accounts differ from Keplr's.
- **Chainflip** has no FLIP transfer between State Chain accounts; liquidity-provider order calls are shown as the raw
  call with a caution.
- **MultiversX** dapp connectivity is best effort, through an undocumented sdk-dapp hook: see
  [MultiversX](../dapps/multiversx.md).
