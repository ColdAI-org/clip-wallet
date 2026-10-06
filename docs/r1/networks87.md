# networks87: Clip Wallet on every CLPR network

The 87 networks are `NETWORKS` in coldai-clpr-landing `artifacts/coldai-web/src/data/clpr-data.ts` (the networks with
CLPR verifier code in ColdAI's pull requests to LFDT-CLPR). The coverage below is computed from the wallet's own
catalogue, not written by hand: `packages/engine/test/networks87.test.ts` maps each CLPR network to the mainnet(s) in
`walletNetworks()` with every family on, fails if anything but the two networks below is missing, and prints the table
(`pnpm --filter @clip-wallet/engine exec vitest run test/networks87.test.ts`).

## Result

- **85 of the 87 CLPR networks are supported on mainnet.** Before this work it was 67 (Arc was in the list only as a
  testnet, and 19 networks were missing).
- **Not supported: Canton and Mixin.** Neither has a model in which a self-custodial key wallet can hold and move funds
  on its own (details below).
- **Supported mainnets, by the landing page's counting rule** (EVM `testnet: false` entries without "Hedera (EVM)", plus
  every other family's mainnets, Polkadot SDK networks included): **93**, up from 74. 60 EVM + Hedera, Solana,
  Bitcoin, Sui, Aptos, Cardano, Starknet, TON, NEAR, Stellar, Tezos, Algorand (1 each) + 5 Polkadot SDK (Polkadot,
  Kusama, both Asset Hubs, Chainflip) + Osmosis, dYdX, ZIGChain + Provenance, THORChain, Initia + TRON, XRP Ledger,
  MultiversX, Internet Computer, Stacks, Fuel, Bitcoin Cash + Vaulta, Telos (native), XPR Network.
- 93 counts networks the wallet ships, CLPR or not (Polkadot, Kusama and the Asset Hubs aren't CLPR networks; Telos
  counts once as an EVM and once natively).

**Wording that is true:** "Clip Wallet supports 85 of the 87 CLPR networks (all except Canton and Mixin, which have no
self-custodial wallet model) and 93 mainnets in total." **"All 87 CLPR networks" is not true** and can't be made true by
wallet code: see Canton and Mixin.

## Gap table

"already" = covered before this branch; "**new**" = added here. Network ids are CAIP-2 where a namespace exists
(sources in each package README). Dapp connectivity is per family; every family also sends and receives in the wallet
itself.

| CLPR network | Status | Module and mainnet network id | Dapp connectivity | Notes |
| --- | --- | --- | --- | --- |
| Abstract | already | `chains-evm` `eip155:2741` | EIP-6963 / EIP-1193 |  |
| Algorand | already | `chains-algorand` `algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k` | existing provider |  |
| Anubis | already | `chains-evm` `eip155:6714` | EIP-6963 / EIP-1193 |  |
| Arbitrum Nova | already | `chains-evm` `eip155:42170` | EIP-6963 / EIP-1193 |  |
| Arbitrum One | already | `chains-evm` `eip155:42161` | EIP-6963 / EIP-1193 |  |
| Arc | **new** | `chains-evm` `eip155:5042` | EIP-6963 / EIP-1193 | Arc mainnet (5042) went live 2026-09-16; before, only the testnet was in the list |
| Aurora | already | `chains-evm` `eip155:1313161554` | EIP-6963 / EIP-1193 |  |
| Avalanche C-Chain | already | `chains-evm` `eip155:43114` | EIP-6963 / EIP-1193 |  |
| BNB Smart Chain | already | `chains-evm` `eip155:56` | EIP-6963 / EIP-1193 |  |
| BOB | already | `chains-evm` `eip155:60808` | EIP-6963 / EIP-1193 |  |
| BOT Chain | already | `chains-evm` `eip155:677` | EIP-6963 / EIP-1193 |  |
| Base | already | `chains-evm` `eip155:8453` | EIP-6963 / EIP-1193 |  |
| Bifrost Network | already | `chains-evm` `eip155:3068` | EIP-6963 / EIP-1193 | EVM layer |
| Bitcoin | already | `chains-bitcoin` `bip122:000000000019d6689c085ae165831e93` | existing provider |  |
| Bitcoin Cash | **new** | `chains-bitcoincash` `bip122:000000000000000000651ef99cb9fcbe` | WalletConnect wc2-bch-bcr (no injected standard) |  |
| Bittensor | already | `chains-evm` `eip155:964` | EIP-6963 / EIP-1193 | EVM layer |
| Blast | already | `chains-evm` `eip155:81457` | EIP-6963 / EIP-1193 |  |
| Canton | missing | **not supported** | n/a | see below |
| Cardano | already | `chains-cardano` `cip34:1-764824073` | existing provider |  |
| Celo | already | `chains-evm` `eip155:42220` | EIP-6963 / EIP-1193 |  |
| Chainflip | **new** | `chains-substrate` `polkadot:8b8c140b0af9db70686583e3f6bf2a59` | window.injectedWeb3 (polkadot extension-dapp) | State Chain FLIP from Flip.Account; no FLIP transfer exists (redeem to Ethereum); LP-portal calls decoded |
| Conflux | already | `chains-evm` `eip155:1030` | EIP-6963 / EIP-1193 | Conflux eSpace (EVM); Core Space not supported |
| Core | already | `chains-evm` `eip155:1116` | EIP-6963 / EIP-1193 |  |
| Cronos | already | `chains-evm` `eip155:25` | EIP-6963 / EIP-1193 | EVM layer |
| Ethereum | already | `chains-evm` `eip155:1` | EIP-6963 / EIP-1193 |  |
| Flare | already | `chains-evm` `eip155:14` | EIP-6963 / EIP-1193 |  |
| Fraxtal | already | `chains-evm` `eip155:252` | EIP-6963 / EIP-1193 |  |
| GRX Chain | already | `chains-evm` `eip155:1110` | EIP-6963 / EIP-1193 |  |
| Gnosis Chain | already | `chains-evm` `eip155:100` | EIP-6963 / EIP-1193 |  |
| Hydration | already | `chains-evm` `eip155:222222` | EIP-6963 / EIP-1193 | EVM layer |
| Hyperliquid | already | `chains-evm` `eip155:999` | EIP-6963 / EIP-1193 | HyperEVM |
| Immutable zkEVM | already | `chains-evm` `eip155:13371` | EIP-6963 / EIP-1193 |  |
| Injective | already | `chains-evm` `eip155:1776` | EIP-6963 / EIP-1193 | EVM layer |
| Ink | already | `chains-evm` `eip155:57073` | EIP-6963 / EIP-1193 |  |
| KUB Chain | already | `chains-evm` `eip155:96` | EIP-6963 / EIP-1193 |  |
| Kaia | already | `chains-evm` `eip155:8217` | EIP-6963 / EIP-1193 | Kaia is EVM (8217) |
| Katana | already | `chains-evm` `eip155:747474` | EIP-6963 / EIP-1193 |  |
| Kava | already | `chains-evm` `eip155:2222` | EIP-6963 / EIP-1193 | EVM layer |
| MANTRA | already | `chains-evm` `eip155:5888` | EIP-6963 / EIP-1193 | EVM layer |
| Mantle | already | `chains-evm` `eip155:5000` | EIP-6963 / EIP-1193 |  |
| MegaETH | already | `chains-evm` `eip155:4326` | EIP-6963 / EIP-1193 |  |
| Mezo | already | `chains-evm` `eip155:31612` | EIP-6963 / EIP-1193 | EVM layer |
| Mixin | missing | **not supported** | n/a | see below |
| Monad | already | `chains-evm` `eip155:143` | EIP-6963 / EIP-1193 |  |
| NEAR | already | `chains-near` `near:mainnet` | existing provider |  |
| OP Mainnet | already | `chains-evm` `eip155:10` | EIP-6963 / EIP-1193 |  |
| Osmosis | **new** | `chains-cosmos` `cosmos:osmosis-1` | Keplr-compatible API at window.clipwallet.cosmos | coin type 118 |
| Plasma | already | `chains-evm` `eip155:9745` | EIP-6963 / EIP-1193 |  |
| Plume | already | `chains-evm` `eip155:98866` | EIP-6963 / EIP-1193 |  |
| Polygon PoS | already | `chains-evm` `eip155:137` | EIP-6963 / EIP-1193 |  |
| Provenance | **new** | `chains-cosmos` `cosmos:pio-mainnet-1` | Keplr-compatible API at window.clipwallet.cosmos | coin type 505 (Keplr's testnet uses 1: different key there) |
| PulseChain | already | `chains-evm` `eip155:369` | EIP-6963 / EIP-1193 |  |
| RISE | already | `chains-evm` `eip155:4153` | EIP-6963 / EIP-1193 |  |
| Reya | already | `chains-evm` `eip155:1729` | EIP-6963 / EIP-1193 |  |
| Robinhood Chain | already | `chains-evm` `eip155:4663` | EIP-6963 / EIP-1193 |  |
| Ronin | already | `chains-evm` `eip155:2020` | EIP-6963 / EIP-1193 |  |
| Rootstock | already | `chains-evm` `eip155:30` | EIP-6963 / EIP-1193 |  |
| STRATO | **new** | `chains-evm` `eip155:123354377739506` | EIP-6963 / EIP-1193 | SolidVM, but nodes take signed legacy Ethereum transactions; flat 0.01 USDST fee per transaction |
| Sei | already | `chains-evm` `eip155:1329` | EIP-6963 / EIP-1193 | EVM layer |
| Solana | already | `chains-solana` `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | existing provider |  |
| Soneium | already | `chains-evm` `eip155:1868` | EIP-6963 / EIP-1193 |  |
| Stable | already | `chains-evm` `eip155:988` | EIP-6963 / EIP-1193 | EVM layer |
| Stacks | **new** | `chains-stacks` `stacks:1` | SIP-030 + WBIP-004 |  |
| Starknet | already | `chains-starknet` `starknet:SN_MAIN` | existing provider |  |
| Stellar | already | `chains-stellar` `stellar:pubnet` | existing provider |  |
| THORChain | **new** | `chains-cosmos` `cosmos:thorchain-1` | Keplr-compatible API at window.clipwallet.cosmos | mainnet only: stagenet runs on real funds |
| TON | already | `chains-ton` `ton:-239` | existing provider |  |
| TRON | **new** | `chains-tron` `tron:0x2b6653dc` | TIP-1193 + TIP-6963 |  |
| Telos | already | `chains-evm` `eip155:40` | EIP-6963 / EIP-1193 | Telos EVM (and Telos native in chains-antelope) |
| Unichain | already | `chains-evm` `eip155:130` | EIP-6963 / EIP-1193 |  |
| Vaulta | **new** | `chains-antelope` `antelope:aca376f206b8fc25a6ed44dbdc66547c` | none: send/receive only | accounts are names created on chain; receive needs one for this key |
| World Chain | already | `chains-evm` `eip155:480` | EIP-6963 / EIP-1193 |  |
| X Layer | already | `chains-evm` `eip155:196` | EIP-6963 / EIP-1193 |  |
| XPR Network | **new** | `chains-antelope` `antelope:384da888112027f0321850a169f737c3` | none: send/receive only | accounts are names created on chain |
| XRP Ledger | **new** | `chains-xrpl` `xrpl:0` | XLS-72d Wallet Standard (no message signing) |  |
| ZIGChain | **new** | `chains-cosmos` `cosmos:zigchain-1` | Keplr-compatible API at window.clipwallet.cosmos | coin type 118 |
| ZKsync Era | already | `chains-evm` `eip155:324` | EIP-6963 / EIP-1193 |  |
| dYdX | **new** | `chains-cosmos` `cosmos:dydx-mainnet-1` | Keplr-compatible API at window.clipwallet.cosmos | coin type 118 |
| Linea | already | `chains-evm` `eip155:59144` | EIP-6963 / EIP-1193 |  |
| Scroll | already | `chains-evm` `eip155:534352` | EIP-6963 / EIP-1193 |  |
| Morph | already | `chains-evm` `eip155:2818` | EIP-6963 / EIP-1193 |  |
| ICP | **new** | `chains-icp` `icp:737ba355e855bd4b61279056603e0550` | none: send/receive only (ICRC-94 discovery still a draft) | no public transfer testnet: icp:test = mainnet limited to DFINITY test ledgers; replies not certificate-verified |
| MultiversX | **new** | `chains-multiversx` `mvx:1` | best effort: sdk-dapp's undocumented window.multiversx.providers hook |  |
| Initia | **new** | `chains-cosmos` `cosmos:interwoven-1` | Keplr-compatible API at window.clipwallet.cosmos | coin type 60, ethsecp256k1: the EVM key |
| Fuel | **new** | `chains-fuel` `fuel:9889` | FuelConnector event |  |
| Tezos | already | `chains-tezos` `tezos:NetXdQprcVkpaWU` | existing provider |  |
| Etherlink | already | `chains-evm` `eip155:42793` | EIP-6963 / EIP-1193 | EVM layer of Tezos smart rollups |

## What was added

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

All derivations are in `packages/vault` (the only package that touches keys) and are cross-checked for the public
"abandon … about" phrase against each ecosystem's SDK (`packages/vault/test/families87.test.ts`: cosmjs, xrpl.js,
TronWeb, WharfKit, MultiversX sdk-core, @dfinity/identity-secp256k1, @stacks/wallet-sdk, fuels-ts, libauth), and every
module's paths and addresses are checked against the vault. Chain modules serialize transactions by hand
(protobuf, XRPL binary codec, Antelope ABI, SIP-005, Fuel tx format, CBOR/Candid, CashAddr/BIP-143 with FORKID) and
are cross-checked byte for byte against the official SDKs, which are devDependencies only; each module's runtime
dependencies are `@clip-wallet/core`, `@noble/*` and `@scure/base`.

## Networks without a self-custodial wallet model

### Canton

Canton is a network of participant (validator) nodes that host parties; the CLPR verifier for it is t-of-n operator
attestation and was run only against a local sandbox (clpr-smart-contracts-canton `docs/chains/canton.md`). Canton 3.x
does have "external parties" whose key is held outside the node, and CIP-0103 defines a dApp API for wallets. But
every read of a party's contracts and every submission (prepare → sign hash → execute) goes through the Ledger API of a
participant that hosts the party, behind that operator's authentication, and there is no public endpoint. A wallet can
hold the key, but it can't see or move anything without an operator relationship. **Closest honest support:** none in
Clip as shipped. A kit-built wallet whose operator runs (or contracts) a validator could add a family that talks to
its own participant through a CIP-0103 wallet gateway; that is an operator product, not a phrase-derived wallet.

### Mixin

Mixin's kernel is a UTXO DAG with CryptoNote-style one-time output keys. Its public RPC (`kernel.mixin.dev`;
methods in MixinNetwork/mixin `rpc/internal/server/http.go`: getinfo, gettransaction, getutxo, listsnapshots,
sendrawtransaction, …) has no address or key index, so a wallet can't find its own outputs without scanning every
snapshot with the view key, and there is no BIP-39 derivation standard for kernel keys. User funds live in Mixin's
account system (Mixin Messenger / Safe, registered accounts and TIP-derived keys behind api.mixin.one). The CLPR
verifier reads the kernel's collective signatures, which is a different problem from holding funds.
**Closest honest support:** none in Clip. XIN as an ERC-20 on Ethereum is an asset, not the network.

## Other honest limits

- **STRATO** works through its Ethereum JSON-RPC: legacy (EIP-155) transactions only, gas unpriced, a flat
  0.01 USDST (or voucher) per transaction that the approval screen shows as its own line. Contract calls are matched to
  SolidVM functions by selector; apps that need STRATO's EIP-712 "function call" transactions are out of scope.
- **Arc** mainnet launched on 2026-09-16; native gas is USDC (18 decimals on the EVM side).
- **Antelope** accounts must be created on chain by someone (they cost RAM). Clip finds the accounts that use its key
  (`get_accounts_by_authorizers`, Hyperion fallback) and says plainly when there is none yet.
- **ICP** replies aren't certificate-verified (no BLS check); nothing security-relevant relies on them. An ICP
  transfer must be approved within 4 minutes (ingress expiry).
- **THORChain** has no public testnet. Swaps (deposit memos) decode as blind.
- **Provenance and Initia testnets:** Keplr derives pio-testnet-1 at coin type 1 and initiation-2 at 118; Clip uses
  the mainnet coin types (505, 60) everywhere, so those testnet accounts differ from Keplr's.
- **Chainflip** has no FLIP transfer between State Chain accounts; LP order calls are shown as the raw call with a
  caution.
- **Public test accounts:** the "abandon … about" accounts are used by strangers on several testnets (XRPL account 0
  has its master key disabled; the TRON Nile account's owner permission was moved). Unit tests use fixtures; the dapp
  matrix uses its own wallet.

## Live checks done while building (testnets, public test vector account unless said)

- Fuel testnet: one 1-unit self-transfer through fuels-ts `Fuel` → Clip's connector → the module (0x5717…9db6), paid
  from a balance the public test account already held.
- XRPL testnet: a payment and an autofilled AccountSet validated `tesSUCCESS` (account index 7, faucet-funded).
- Jungle4: an Antelope transfer accepted up to CPU billing (`tx_cpu_usage_exceeded`), proving serialization and
  signature.
- Cosmos (osmo-test-5, dydx-testnet-4, zig-test-2), MultiversX devnet, ICP, Chainflip (both networks): transactions
  accepted by simulate/validation endpoints without broadcasting (ICP: "insufficient funds" from the ledger).
