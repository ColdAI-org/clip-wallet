# Integration: vault2 (all families in the vault, Bitcoin change addresses)

Branch `p2/vault2`. Edits: `packages/vault`, `packages/chains-bitcoin`, `packages/core` (additive only).
Nothing in the do-not-edit list was touched. Apply the lines below during integration.

## Contract additions (packages/core, additive, all optional)

- `SignablePayload.derivationSubPath?: string`: sign with a key below the account node.
  - Bitcoin: `"1/<n>"`, a change address handed out to that account.
  - Cardano: `"0/<n>"`, `"1/<n>"` or `"2/0"` (the stake key).
  - Other families refuse it.
  - Covered by `hashSignablePayload`. Hashes of payloads without a sub-path are unchanged from Phase 1.
- `interface ChildAddress { address; publicKey; derivationPath; derivationSubPath }`
- `ChainContext.freshChangeAddress?: () => Promise<ChildAddress>`
- `ChainContext.changeAddresses?: ChildAddress[]`

## apps/extension/src/background/wiring.ts

Add to `interface WalletVault` (after `deriveAccount`):

```ts
  listAccounts(families?: readonly Family[]): Promise<Account[]>;
  addAccount(family: Family, label?: string): Promise<Account>;
  setAccountLabel(family: Family, index: number, label: string): Promise<void>;
  freshChange: ClipVault["freshChange"];
  listChange: ClipVault["listChange"];
```

Vault options (where `new ClipVault({...})` is built; defaults shown, all testnet):

```ts
  // cardanoNetwork: "testnet", tonNetwork: "testnet", tonWalletVersion: "v5r1",
  // algorandScheme: "arc52", starknetScheme: "argent-x",
  // starknetAccountClassHash: STARKNET_OZ_ACCOUNT_CLASS_HASH,
  // addressOf: delegate starknet (and anything else) to chain modules if they own the address format
```

## apps/extension/src/background/service.ts (`private async ctx(networkId)`)

Give the Bitcoin module change addresses. Replace the returned object with:

```ts
    const account = await this.account(network.family);
    const base: ChainContext = {
      network: override ? { ...network, rpcUrls: [override, ...network.rpcUrls] } : network,
      account,
      fetch: globalThis.fetch.bind(globalThis),
    };
    if (network.family !== "bitcoin") return base;
    return {
      ...base,
      changeAddresses: await this.deps.vault.listChange("bitcoin", account.index),
      freshChangeAddress: () => this.deps.vault.freshChange("bitcoin", account.index),
    };
```

Pass the **same** `changeAddresses` to `decode`/`prepare`/`finalize` as to `buildTransfer`. The module also
remembers the change address it picked per request id, so decode shows it as "Change back to you".

## tools/harness/check.mjs (recommended)

The new key libraries aren't on the key-material list yet. Add them to `KEY_MATERIAL`; their verify
functions stay allowed for chain modules:

```js
  {
    module: /^@scure\/sr25519$/,
    symbols: ["secretFromSeed", "sign", "getSharedSecret", "fromKeypair", "HDKD", "vrf"],
    what: "sr25519 private-key or signing APIs (@scure/sr25519); verify is fine",
  },
  {
    module: /^@scure\/starknet$/,
    symbols: ["sign", "grindKey", "getStarkKey", "getPublicKey", "getSharedSecret", "ethSigToPrivate"],
    what: "Stark private-key or signing APIs (@scure/starknet); verify and pedersen are fine",
  },
```

Also consider `@emurgo/cardano-serialization-lib-*` (`Bip32PrivateKey`, `PrivateKey`),
`@polkadot/keyring`, `@polkadot/util-crypto` (`mnemonicToMiniSecret`, `sr25519PairFromSeed`, `*Sign`),
`@taquito/signer` (`InMemorySigner`), `@ton/crypto` (`mnemonicToPrivateKey`, `keyPairFromSeed`, `sign`),
`algosdk` (`mnemonicToSecretKey`, `signBytes`), `near-seed-phrase`, `@mysten/sui/keypairs/*` (`Ed25519Keypair`),
`@aptos-labs/ts-sdk` (`Account`, `Ed25519PrivateKey`), `@stellar/stellar-*` (`Keypair.fromSecret`,
`Keypair.random`) and `starknet` (`ec.starkCurve.sign`). The vault only uses these as test devDependencies.

## Notes for the chain-module streams

- **`Account.publicKey`** is hex without `0x`:
  - Starknet: the 32-byte Stark key (x-coordinate).
  - Cardano: the payment key. The stake key hash is inside the base address.
  - Substrate: the 32-byte sr25519 key.
- **Substrate:** `Account.address` uses generic SS58 prefix 42. Re-encode per network (Polkadot 0, Kusama 2).
- **Algorand (ARC-52):** `Account.curve` is `"bip32-ed25519"`. The scheme is still `"ed25519"`, and the
  signatures verify as plain Ed25519.
- **TON:** `Account.address` is a wallet v5r1, non-bounceable address. On testnet it uses the testnet global
  id (`0Q…`). v5r1 addresses differ between mainnet and testnet.
- **Starknet:**
  - The default address is an OpenZeppelin counterfactual account (v0.17.0 class hash). Inject `addressOf`
    for Argent or Braavos account classes.
  - `stark-ecdsa` payloads must be ≤ 32 bytes and below 2^251.
  - Returns `r ‖ s` (64 bytes) plus `recovery`.
- **Cardano:** a transaction that needs the stake key (delegation, withdrawal) adds a second
  `SignablePayload` with `derivationSubPath: "2/0"`.
