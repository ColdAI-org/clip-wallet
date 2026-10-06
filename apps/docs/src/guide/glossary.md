# Glossary

**Family.** A group of networks that share keys, addresses and a wallet standard: `evm`, `hedera`, `solana`,
`bitcoin`, `sui`, `aptos`, `cardano`, `substrate`, `starknet`, `ton`, `near`, `stellar`, `tezos`, `algorand`
(`FAMILIES` in `@clip-wallet/core`). One `ChainModule` serves each family.

**Network.** One chain inside a family, identified by a CAIP-2 id: `eip155:84532`, `hedera:testnet`,
`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`. Users rarely see it.

**Asset key.** The `key` of an `AssetRef` (`"usdc"`, `"eth"`, `"hbar"`). The same issuer's token shares one key on
every network, so balances merge into one row. Bridged copies get their own key and `bridged: true`.

**Network chip.** The small label that names a network, shown only where a mistake could lose money: an address
valid on several networks, a token that exists only as a bridged copy, and Advanced mode.

**DappRequest.** A request from a dapp (or from the wallet itself, with `origin: "clip-wallet"`) as 1Mask hands it to
the background: origin, family, network, method and params.

**DecodedRequest.** What the approval screen shows: a title, lines, balance changes, fee, warnings, and whether the
request is `blind`.

**Blind request.** One the chain module couldn't decode. It is blocked unless the person turns on Advanced mode and
overrides it for that request.

**SignablePayload.** The bytes a chain module asks the vault to sign, with the scheme, the account and the approval
they belong to.

**Approval-bound signing.** The vault signs only payloads whose hashes were registered for an approval the person
gave, each hash once, within a short time.

**1Mask.** The connector layer that makes one wallet look native to every dapp: injected providers in the page, a
content-script bridge and a router in the background, plus WalletConnect.

**Security floor.** The checks no configuration can switch off: open phishing lists, decode-before-approve,
new-contract and look-alike checks.

**Kit-built wallet.** A wallet made with `create-clip-wallet` or the Scaffold-HBAR template: the same packages under
another name, icon, extension id and rdns.

**rdns.** A reverse domain name (`com.example.wallet`) a wallet announces in EIP-6963. Dapps and pickers key on it.

**CAIP-2 / CAIP-10.** Chain-agnostic ids for networks (`eip155:1`) and accounts (`eip155:1:0xabc…`).

**Route and fund.** When a request needs money the user holds on another network, the wallet finds the shortfall and
offers a route on CLPRouter.

**Settle on Hedera.** Phase 3 routing through bonded Connectors, with orders settled on Hedera and a missed deadline
paid from the Connector's bond.

**Clip Plugin.** A small, sandboxed extension (SES) that can add transaction notes, name lookups and notifications,
and can never sign or see keys.

**Harness.** `pnpm harness`: the mechanical checks of the rules every change must pass.
