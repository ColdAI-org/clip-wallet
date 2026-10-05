# @clip-wallet/1mask

1Mask is Clip Wallet's dapp-connector layer. It makes one wallet look native to every dapp by
answering each network family's own wallet standard, plus WalletConnect.

1Mask never touches keys and never imports `@clip-wallet/vault` or chain modules. It turns dapp
calls into `DappRequest`s (from `@clip-wallet/core`) and sends them to the wallet background. The
background decodes them, asks the user, signs and replies.

```
page (MAIN world)          content script (ISOLATED)         extension background
@clip-wallet/1mask/inpage ─postMessage─► /content ─runtime port─► /background router ─► handle(DappRequest)
                                                                                 ▲
WalletConnect relay ─────────────────────────────────► /walletconnect ──────────┘ handle(DappRequest, ctx)
```

## Entry points

| Import | Runs in | What it does |
| --- | --- | --- |
| `@clip-wallet/1mask/inpage` | page, MAIN world | `installOneMask(config)`: sets up the EIP-1193 provider with EIP-6963 announce, the Solana and Bitcoin Wallet Standard wallets, and the postMessage transport. |
| `@clip-wallet/1mask/content` | content script | `createContentBridge({ channel, connect? })`. Checks every message (source === window, channel, zod schema, size cap), attaches **its own** `location.origin`, and forwards over a `RuntimePort`. |
| `@clip-wallet/1mask/background` | service worker | `createOneMaskRouter({ networks, handle, permissions, accountsFor, ... })`. Covers per-origin per-family permissions, method allowlists, the per-site network, request ids, timeouts, rate limits and event fan-out. |
| `@clip-wallet/1mask/walletconnect` | background / popup | `createWalletConnectWallet({ projectId, metadata, networks, addressesFor, approveProposal, handle })`, built on Reown WalletKit. |
| `@clip-wallet/1mask` | anywhere | Shared types: errors and codes, identity and config, network helpers, protocol constants. |

### Wiring (extension)

```ts
// inpage.ts (MAIN world)
installOneMask({ networks: PUBLIC_REGISTRY, channel: BUILD_CHANNEL, identity: { name, icon, rdns } });

// content.ts (ISOLATED world)
createContentBridge({ channel: BUILD_CHANNEL });

// background.ts
const router = createOneMaskRouter({
  networks: REGISTRY,
  permissions: chromeStoragePermissionStore,        // implements PermissionStore
  accountsFor: (origin, family) => sitesAccounts(origin, family),
  handle: (req) => approvals.decodeAskSignReply(req), // chain module decode → UI → vault → finalize
  isUnlocked: () => vault.status().then((s) => s === "unlocked"),
});
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === PORT_NAME) router.attachPort(port, { senderOrigin: port.sender?.origin });
});
```

When `senderOrigin` is given, the router drops any request whose content-script origin differs
from the browser-reported sender origin.

Identity comes from config. The defaults are name `"Clip Wallet"`, a placeholder SVG data-URI icon
and rdns `org.coldai.clipwallet`. Kit-built wallets pass their own identity and announce as
themselves. Icons must be base64 data URIs (svg, webp, png or gif). The rdns must be reverse-DNS.

## Method coverage

### EVM (EIP-1193 + EIP-6963)

The provider is announced through `eip6963:announceProvider` on load and again on every
`eip6963:requestProvider`. The `uuid` is a v4 UUID that stays the same for the whole page session.
`window.ethereum` is **not** touched unless `claimWindowEthereum: true` is set. Even then it is only
set when no other wallet owns it.

| Kind | Methods | Behaviour |
| --- | --- | --- |
| Connect | `eth_requestAccounts`, `wallet_requestPermissions` | Approval through `handle`, then a per-origin `evm` permission. A second connect while one is pending gets `-32002`. |
| Local | `eth_accounts`, `eth_chainId`, `net_version`, `wallet_getPermissions`, `wallet_revokePermissions` | `eth_accounts` returns `[]` until the site is connected. |
| Networks | `wallet_switchEthereumChain` | Registry chains switch **without a prompt** ("networks are invisible") and emit `chainChanged`. Unknown chains get `4902`. The network is stored per origin. |
|  | `wallet_addEthereumChain` | Accepted only for registry chains, which it switches to. The registry's RPC is used and the dapp's RPC is ignored. Unknown chains get `4001`. |
| Signing | `personal_sign`, `eth_signTypedData_v4`, `eth_sendTransaction` | Needs the permission (`4100`) and an address that belongs to the site's accounts (`4100`). A tx `chainId` that differs from the selected network gets `-32602`. |
| Read-only | `eth_call`, `eth_getBalance`, `eth_blockNumber`, `eth_estimateGas`, `eth_getTransactionReceipt`, `eth_getTransactionByHash`, `eth_getTransactionCount`, `eth_getCode`, `eth_getStorageAt`, `eth_getBlockByNumber`, `eth_getBlockByHash`, `eth_getLogs`, `eth_gasPrice`, `eth_maxPriorityFeePerGas`, `eth_feeHistory`, `eth_syncing`, `web3_clientVersion` | Proxied to `handle` (the background's RPC). No permission needed. 30 s timeout. |
| Refused | `eth_sign` | `4200`, both in the page and in the router. |
| Other | anything else | `4200`. |

Events: `connect`, `disconnect` (4900), `chainChanged`, `accountsChanged`. Error codes follow
EIP-1193 and EIP-1474: 4001, 4100, 4200, 4900, 4901, 4902, -32602, -32603, -32002 (already
pending) and -32005 (rate limit or too many pending approvals).

### Solana (Wallet Standard)

The wallet registers through `registerWallet` from `@wallet-standard/wallet` with these features:
`standard:connect` (supports `silent`), `standard:disconnect`, `standard:events`,
`solana:signTransaction`, `solana:signAndSendTransaction`, `solana:signMessage` and
`solana:signIn`. Supported transaction versions are `legacy` and `0`. Chains come from the registry
and map from CAIP-2 genesis hashes to `solana:mainnet`, `solana:devnet` and `solana:testnet`.

DappRequest: `method` is the feature name, and `params` is `{ inputs: [...] }` with bytes as
base64. `solana:signIn` connects and signs in a single approval.

### Bitcoin (Wallet Standard + sats-connect)

Features: `bitcoin:connect` (`{ purposes: ("payment"|"ordinals")[] }`), `bitcoin:disconnect`,
`bitcoin:events`, `bitcoin:signTransaction` (PSBT + `inputsToSign`),
`bitcoin:signAndSendTransaction`, `bitcoin:signMessage`, `sats-connect:` (`{ provider }`), plus
`standard:connect`, `standard:disconnect` and `standard:events` for generic adapters. Chains:
`bitcoin:mainnet`, `bitcoin:testnet` (testnet3/testnet4), `bitcoin:signet` and `bitcoin:regtest`.

The feature shapes mirror `@exodus/bitcoin-wallet-standard-features` (`bitcoin:connect`) and
`@metamask/bitcoin-wallet-standard@1.3.0`, which carries the other features and the
`"sats-connect:"` provider feature. They are declared locally in `src/inpage/bitcoin-features.ts`
so the page bundle stays free of vendor clients.

**What sats-connect dapps need.** sats-connect v4 (`@sats-connect/core`) finds Wallet Standard
wallets that expose the `"sats-connect:"` feature and then calls `provider.request(method, params)`.
That call expects a JSON-RPC 2.0 envelope back. 1Mask implements `getInfo`, `getAddresses`,
`getAccounts`, `wallet_connect`, `wallet_requestPermissions`, `wallet_disconnect`,
`wallet_renouncePermissions`, `signMessage`, `signPsbt` (`{ psbt, signInputs, broadcast }`) and
`sendTransfer`. Each one maps onto the canonical `bitcoin:*` DappRequest methods, and sendTransfer
maps to `bitcoin:sendTransfer`, so the background decodes only one shape. User rejection is
reported as sats-connect's `-32000`. Not implemented: the legacy JWT-string methods (`connect(jwt)`,
`signTransaction(jwt)`, ...), the `window.btc_providers` / `window.XverseProviders` registry,
runes, ordinals inscriptions and Stacks.

### Hedera

Hedera dapps reach the wallet in two ways:

1. **EVM provider on eip155:295/296/297.** If the registry lists these networks (`id:
   "eip155:296"`, chain id 296, Hashio RPC), the EIP-6963 provider serves them like any EVM chain.
   **Decision:** these JSON-RPC style requests get `family: "evm"` and are handled by chains-evm
   through the Hashio relay. The router's `familyForNetwork` hook defaults to "every eip155 network
   is evm". A kit that wants chains-hedera to handle 296 can override it to return `"hedera"`.
2. **WalletConnect `hedera` namespace** (`@hashgraph/hedera-wallet-connect` DAppConnector).
   Chains are `hedera:mainnet`, `hedera:testnet`, `hedera:previewnet` and `hedera:devnet`.
   Methods: `hedera_getNodeAddresses`, `hedera_executeTransaction`, `hedera_signMessage`,
   `hedera_signAndExecuteQuery`, `hedera_signAndExecuteTransaction` and `hedera_signTransaction`.
   Events: `accountsChanged` and `chainChanged`. Accounts are `hedera:testnet:0.0.x`. These requests
   get `family: "hedera"`.

v1 has no injected Hedera provider, and the router answers `4200` for injected `hedera` calls.

### WalletConnect

`createWalletConnectWallet` uses `@reown/walletkit` (`WalletKit.init({ core, metadata })`) with
`@walletconnect/core` (`new Core({ projectId })`). The `projectId` must be passed in from the
extension's build config. It is never hardcoded.

- **Proposals (CAIP-25).** `mapProposalNamespaces` covers `eip155`, `solana`, `bip122` and
  `hedera`. Only registry chains that have an account are approved.
  - Required chains or namespace keys that can't be served → the proposal is rejected (`5100` /
    `5104`).
  - Optional chains, methods and events that can't be served → dropped, and listed in
    `unsupported` for the approval screen.
  - Required methods that aren't supported (for example `eth_sign`) are still listed so the session
    conforms, but they are refused at request time with `5101`.
  - Chain-keyed namespaces (`"eip155:1": {...}`) are supported.
- **Requests.** `session_request` becomes `DappRequest{ via: "walletconnect", family, networkId:
  chainId, method, params }`. WC method names pass through as they are (`solana_signTransaction`,
  `signPsbt`, `hedera_signAndExecuteTransaction`), so chain modules decode WC shapes when
  `via === "walletconnect"`. `eth_accounts`, `eth_chainId` and switching to a chain inside the
  session are answered locally.
- **Verify API.** `ctx.warnings` carries `domain-mismatch` (validation `INVALID`, or the metadata
  URL differs from the attested origin) and `known-scam` (`isScam`, or the local `isKnownScam`
  list). These go to `handle(req, ctx)` and `approveProposal(summary)` to be merged into
  `DecodedRequest.warnings`. When validation is `VALID`, the DappRequest origin is the attested
  origin.
- **One-click auth.** `session_authenticate` (CAIP-122 / SIWE + ReCaps) is handled with
  `populateAuthPayload`. `handle` receives a single `wallet_authenticate` request
  (`{ message, address, domain, authPayload }`) and must return a personal_sign signature. The
  wallet then answers with `buildAuthObject` → `approveSessionAuthenticate`. It signs one CACAO,
  for the first supported eip155 chain.
- **Sessions.** `sessions()`, `disconnect(topic)` (`6000`) and `notifyAccountsChanged()`
  (updateSession + `accountsChanged` / `bip122_addressesChanged`).
- **Errors.** WC SDK codes: 5000 user rejected, 5100 unsupported chains, 5101 unsupported methods,
  3001 unauthorized method, 6000 user disconnected.

## EIP-5792 Wallet Call API and ERC-7682 auxiliary funds (opt-in)

Sources (read 2026-10-05): https://eips.ethereum.org/EIPS/eip-5792 (Final), https://eips.ethereum.org/EIPS/eip-7682
(Draft), https://docs.walletconnect.com/wallets/web/eip5792 (CAIP-25 `scopedProperties`).

The methods are on only when the host passes `calls` (a `CallsHost`) to `createOneMaskRouter` or
`createWalletConnectWallet`. Without it, they answer 4200 as before. `CallsHost.enabled()` can switch them off for a
while, for example while another device signs (link/remote).

| Method | Behaviour |
| --- | --- |
| `wallet_getCapabilities` | Connected sites and own addresses only (4100). Per chain it returns `atomic: { status: "unsupported" }` (EOA accounts) and `auxiliaryFunds: { supported, assets }` where the host can bring money in. Chains the wallet doesn't have are left out. |
| `wallet_sendCalls` | Validated in `shared/calls.ts`: version, hex chainId, up to 10 calls, unknown non-optional capabilities (5700), unknown chain (5710), too many calls (5740), `atomicRequired: true` (5760), ERC-7682 `requiredAssets` (5772 / 5773). Then one approval on the chain the params name, with method `wallet_sendCalls`. The host decodes every call (see `@clip-wallet/engine/calls-batch`). |
| `wallet_getCallsStatus`, `wallet_showCallsStatus` | Only the origin that sent a batch can see it. Any other id gives 5730. |

Over WalletConnect, the four methods are served on eip155 when the app's proposal asks for them. The approved session
carries each chain's capabilities in `scopedProperties`. `wallet_sendCalls` goes to the chain its params name, which
must be in the session.

## Security properties (tested)

- The content script ignores messages from other windows or frames (`event.source !== window`),
  messages on the wrong channel, and messages that fail the schema.
- The origin always comes from the content script. A page-supplied `origin` field fails the strict
  schema. The router can also cross-check it against `port.sender.origin`.
- Accounts are never revealed before connect: `eth_accounts`, `wallet_getPermissions`, the provider
  state and silent Wallet Standard connect all return nothing.
- `eth_sign` is refused, and `wallet_addEthereumChain` with an unknown chain is refused.
- The EIP-6963 announce shape is checked: v4 uuid that stays stable per session, rdns, data-URI icon,
  frozen detail.
- Wallet Standard registration exposes the listed features and registry chains.
- WalletConnect namespace mapping is tested against fixture proposals, with no network.

## Compatibility mode (not implemented in v1)

`InpageConfig.compatibility` is a typed stub (`CompatibilityModeConfig`, see `src/shared/compat.ts`).
It is off by default, and installing with `enabled: true` throws. The plan is an opt-in shim per
origin for sites that only read `window.ethereum` flags or legacy globals:

- claim `window.ethereum` even when another wallet is present,
- optionally impersonate `isMetaMask`,
- expose `window.solana` / `window.BitcoinProvider`.

Each of these would be recorded per origin next to the permission, and never set globally.

## Known gaps

- No EIP-5792 (`wallet_sendCalls`, `wallet_getCapabilities`), `wallet_watchAsset`,
  `eth_signTransaction`, `eth_subscribe` or legacy `send` / `sendAsync`.
- No `solana:signAndSendAllTransactions` or `solana:signOffchainMessage` features.
- sats-connect legacy JWT API and the `btc_providers` registry are not implemented.
- One-click auth signs a single CACAO. It does not sign one per chain.
- Permissions are per origin and family. Choosing which accounts a site sees is up to
  `accountsFor`.
