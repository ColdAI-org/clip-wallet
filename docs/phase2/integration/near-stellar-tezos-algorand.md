# Integration: stream "near-stellar-tezos-algorand"

New in this stream (merged as-is, no edits to shared files):

| path | what |
|---|---|
| `packages/chains-near` | `createNearModule()`, `NEAR_NETWORKS` (`near:testnet`, `near:mainnet`), `USDC_CONTRACTS`, `tokenAssetKey`, `listAccountIds`, `staking` (staking pools) |
| `packages/chains-stellar` | `createStellarModule()`, `STELLAR_NETWORKS` (`stellar:testnet`, `stellar:pubnet`), `USDC_ISSUERS`, `classicAsset`, `buildAddAsset` / `buildRemoveAsset` (trustlines) |
| `packages/chains-tezos` | `createTezosModule()`, `TEZOS_NETWORKS` (`tezos:NetXsqzbfFenSTS` shadownet, `tezos:NetXdQprcVkpaWU` mainnet; ghostnet is retired), `KNOWN_TOKENS`, `fromBeaconNetwork` / `beaconNetworkType`, `staking` (delegation + stake/unstake/finalize) |
| `packages/chains-algorand` | `createAlgorandModule()` (default ARC-52 BIP32-Ed25519 `m/44'/283'/i'/0/0`, `{ scheme: "slip10" }` for `m/44'/283'/i'/0'/0'`), `ALGORAND_NETWORKS`, `ALGORAND_NETS`, `asaAssetKey`, `buildOptIn` / `buildOptOut` |
| `packages/kit-modules` | `@clip-wallet/kit-modules/{near,stellar,algorand,tezos}`: Wallet Selector module, Stellar Wallets Kit module, use-wallet v5 adapter, Beacon wallet side |
| `packages/1mask/src/inpage/{near,stellar,algorand,tezos,injected-base,p2}.ts` | injected providers at `window.clipwallet.<family>` (+ NEAR Connect announcement) and the Beacon page relay; `installP2Providers` |
| `packages/1mask/src/background/p2-families.ts` | allowlists (`p2InjectedAllowlist`), `createP2Dispatcher`, `BeaconRelay`, `P2_CONNECT_METHODS` (also `@clip-wallet/1mask/background/p2`) |
| `packages/1mask/src/shared/p2-methods.ts` | wire method names, Stellar passphrases, Algorand genesis map |
| `packages/1mask/src/walletconnect/p2-namespaces.ts` | WalletConnect namespaces `near`, `stellar`, `tezos`, `algorand` |
| `packages/core/src/index.ts` | additive: `Nft.standard` + `nep171`, `fa2`, `arc3`, `arc19`, `arc69`; `Warning.code` + `account-takeover`, `account-closure`, `memo-required` |
| `pnpm-workspace.yaml` | `allowBuilds`: `bufferutil`, `secp256k1`, `utf-8-validate` set to `false` (optional native add-ons; pnpm 12 refuses to install otherwise) |

## What the integration step applies

Two exact patches sit next to this file. Pick the one that matches the tree:

- **`near-stellar-tezos-algorand.patch`**: against `main` as merged here (move stream's integration NOT applied yet).
- **`near-stellar-tezos-algorand.after-move.patch`**: against `main` + `docs/phase2/integration/move.md`'s diff. Same changes,
  with the shared lines (families lists, `CONNECT_METHODS`, `PLAIN_ETA`, `chains`, router dispatch, config pattern) already
  merged with sui/aptos.

```sh
git apply docs/phase2/integration/near-stellar-tezos-algorand.patch   # or .after-move.patch
pnpm install && pnpm typecheck && pnpm test && pnpm harness
```

Both were applied on a scratch tree, `pnpm install && pnpm typecheck && pnpm test && pnpm harness` passed (1mask 94 tests
incl. the new `test/p2-router.test.ts`, extension 16, config 10, every package green), `apps/extension` `wxt build`
succeeded (after-main patch), and they were reverted. If the tree has moved on, the exact lines below are what to add.

### packages/1mask/src/background/methods.ts

```ts
import { p2InjectedAllowlist } from "./p2-families.js";
// in injectedAllowlist(), before `default:`
    case "near":
    case "stellar":
    case "tezos":
    case "algorand":
      return p2InjectedAllowlist(family);
```

### packages/1mask/src/background/router.ts

```ts
import { P2_FAMILIES, createP2Dispatcher, type BeaconRelay } from "./p2-families.js";

// OneMaskRouterOptions
  /** Tezos Beacon extension peer (kit-modules/tezos createBeaconExtensionPeer) behind 1Mask's page relay. */
  tezosBeacon?: BeaconRelay | (() => BeaconRelay | undefined);

// inside createOneMaskRouter, before "public"
  const p2 = createP2Dispatcher(
    { permitted, requirePermission, accounts, connect, approve, makeReq, requireNetwork, revoke: (origin, family) => revoke(origin, family) },
    opts.tezosBeacon ? { beacon: opts.tezosBeacon } : {},
  );

// dispatchRaw, after the solana/bitcoin(/sui/aptos) line
    if (P2_FAMILIES.has(family)) return p2.dispatch(origin, family, method, params, chain);
```

### packages/1mask/src/shared/config.ts (InpageConfig)

```ts
  providers?: { evm?: boolean; solana?: boolean; bitcoin?: boolean; /* sui?, aptos?, */ near?: boolean; stellar?: boolean; tezos?: boolean; algorand?: boolean };
  /** Global the NEAR/Stellar/Algorand providers hang off (window[globalKey].<family>). Default "clipwallet". */
  globalKey?: string;
  /** Beacon extension id (Beacon's wallet list matches the browser extension id). Default: identity.rdns. */
  beaconExtensionId?: string;
```

### packages/1mask/src/inpage/index.ts

```ts
import { installP2Providers, type InstalledP2 } from "./p2.js";
// InstalledOneMask
  /** NEAR (window.clipwallet.near + NEAR Connect), Stellar (SEP-43), Algorand, Tezos (Beacon relay). */
  p2?: InstalledP2;
// end of installOneMask, before `return out;`
  const p2 = installP2Providers(win, identity, config.networks, transport, {
    want: { near: want.near ?? true, stellar: want.stellar ?? true, tezos: want.tezos ?? true, algorand: want.algorand ?? true },
    ...(config.globalKey ? { globalKey: config.globalKey } : {}),
    ...(config.beaconExtensionId ? { beaconExtensionId: config.beaconExtensionId } : {}),
  });
  stops.push(p2.stop);
  out.p2 = p2;
// exports
export * from "./p2.js";
```

### packages/1mask/src/walletconnect

- `namespaces.ts`: `WcNamespaceKey` gains `| P2WcNamespaceKey`; spread `P2_WC_NAMESPACE_FAMILY`, `P2_WC_SUPPORTED_METHODS`,
  `P2_WC_SUPPORTED_EVENTS` into `WC_NAMESPACE_FAMILY`, `WC_SUPPORTED_METHODS`, `WC_SUPPORTED_EVENTS`.
- `wallet.ts` `answerLocally`: `near_getAccounts` → `sessionAccounts(session, chainId).map((accountId) => ({ accountId }))`.
  (`tezos_getAccounts` goes to chains-tezos, which answers without a signature.)

### packages/config

`NETWORK_FAMILIES` and `NETWORK_PATTERN` gain `near`, `stellar`, `tezos`, `algorand`; the regex message lists them;
`test/config.test.ts` expects the new message.

### apps/extension

- `package.json`: `@clip-wallet/chains-{near,stellar,tezos,algorand}`, `@clip-wallet/kit-modules` (workspace), `buffer ^6.0.3`.
- `clip.config.ts`: `networks: ["evm:*", "hedera", "solana", "bitcoin", "near", "stellar", "tezos", "algorand"]` (mainnet still gated).
- `src/background/wiring.ts`: `near: createNearModule()`, `stellar: createStellarModule()`, `tezos: createTezosModule()`,
  `algorand: createAlgorandModule()` in `chains`; `dapps: new OneMaskConnector(networks, { kv: opts.kv, name: opts.config.name, iconUrl: opts.iconUrl })`.
- `src/shared/catalog.ts`: `...NEAR_NETWORKS, ...STELLAR_NETWORKS, ...TEZOS_NETWORKS, ...ALGORAND_NETWORKS`, and zero-balance
  USDC per network (NEAR `USDC_CONTRACTS`, Stellar `classicAsset(id, "USDC", USDC_ISSUERS[…])`, Algorand
  `ALGORAND_NETS[…].usdc`), USDt on Tezos mainnet (Circle has no Tezos USDC).
- `src/background/real.ts`: `CONNECT_METHODS` gains `...P2_CONNECT_METHODS` (`near:connect`, `stellar:connect`,
  `tezos:connect`, `algorand:connect`); `PLAIN_ETA` gains `near: 2, stellar: 6, tezos: 10, algorand: 4`; `OneMaskConnector`
  takes `{ kv, name, iconUrl }` and passes `tezosBeacon: lazyBeacon(...)` to the router. `lazyBeacon` installs the `buffer`
  polyfill, then imports `@clip-wallet/kit-modules/tezos` and creates the peer with `storage` on the KV (`beacon:*` keys)
  and `dispatch` = `router.dispatch`.
- `src/background/service.ts`: `FAMILIES` gains the four; address recognition uses only families with a module
  (`this.deps.chains[f]?.isAddress`) so fixture mode keeps working.
- `test/catalog.test.ts`: families and USDC expectations.

## Notes for the integrator

- **Vault**: NEAR `m/44'/397'/i'` (implicit = hex pubkey), Stellar `m/44'/148'/i'` (SEP-5), Tezos `m/44'/1729'/i'/0'` (tz1),
  Algorand ARC-52 `m/44'/283'/i'/0/0` (curve `bip32-ed25519`) — all match the merged vault. If the vault runs with
  `algorandScheme: "slip10"`, wire `createAlgorandModule({ scheme: "slip10" })`. Fixture accounts are the vault's
  "abandon … about" accounts (Stellar `GB3J…QBYX`, Tezos `tz1VQA4RP4fLjEEMW2FR4pE9kAg5abb5h5GL`, NEAR
  `ed25519:6j4b…qE25`, Algorand `ACJDJWM7…LAZ53E`).
- **Signing payloads** (all scheme `ed25519`): NEAR sha256(borsh tx) and the NEP-413 hash; Stellar sha256(signature
  payload) / sha256(auth-entry preimage) / SEP-53 hash; Tezos blake2b-256(0x03 ‖ forged) and blake2b(payload) for
  `tezos_sign`; Algorand `"TX" ‖ msgpack`.
- **Request state**: chains-near, chains-tezos (and stellar for Soroban simulation) cache the built transaction per
  `DappRequest.id` between decode/prepare and finalize. Keep one module instance per family (wiring does). A service-worker
  restart between approval and send means approving again.
- **Danger warnings** the approval UI should render prominently: `account-takeover` (NEAR full-access AddKey/DeployContract,
  Stellar signer/master-weight changes, Algorand rekey), `account-closure` (NEAR DeleteAccount, Stellar accountMerge,
  Algorand close-to), `memo-required` (Stellar SEP-29).
- **NEAR accounts**: `accountsFor(origin, "near")` currently exposes the implicit account. To offer named accounts, map
  `nearModule.listAccountIds(ctx)` into `AccountLike[]` there.
- **Beacon extension id**: Beacon's wallet list (`beacon-sdk/scripts/blockchains/tezos.ts`, `tezosExtensionList[].id`) is
  keyed by the browser extension id. The relay answers with `identity.rdns` unless `InpageConfig.beaconExtensionId` is set;
  once the store id is fixed (manifest `key`), bake it in via `__CLIP_*` defines and pass it to `installOneMask`.
- **Beacon P2P (QR pairing)**: `createBeaconP2PWallet` wraps `@airgap/beacon-wallet` WalletClient (Matrix relays, axios,
  localStorage-style storage). It is not wired into the service worker by this patch; run it from the popup or an offscreen
  document with a pairing-string input, and give WalletClient a `storage` adapter.
- **Bundle size**: `background.js` goes from 3.94 MB to 5.03 MB (four chain modules, stellar-base, algosdk, taquito
  local-forging and Beacon). WXT inlines the dynamic Beacon import into the service worker; it is evaluated only on the
  first Beacon message.
- **Fixture mode**: `mocks/mock-chains.ts` / `mocks/networks.ts` have no entries for the four families; the service change
  keeps it working without them.
