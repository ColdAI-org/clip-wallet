# @clip-wallet/connect (Clip Connect)

Connect a dapp to Clip Wallet, or to any other wallet, in one call. Clip Connect is the dapp-side half of Clip
Wallet: open source, wallet-agnostic, and built only on public standards (EIP-1193, EIP-6963, EIP-5792, ERC-7682,
Wallet Standard, CAIP-2/10). It never imports wallet internals, and it has no runtime dependencies. The core is about
5 KB minified and gzipped.

You don't need it for your dapp to work with Clip Wallet: Clip answers each ecosystem's own standard. Clip Connect is
for its extras.

- **`connect()`** finds Clip Wallet first through EIP-6963 or the Wallet Standard. If Clip isn't there, it falls back
  to any other injected wallet, then `window.ethereum`, then a provider you pass (Reown AppKit), then WalletConnect.
- **Accounts as CAIP-10** across families: `eip155:84532:0x…`, `solana:EtWT…:9xQe…`.
- **`request({ chain, method, params })`** sends any method on any connected chain: EVM JSON-RPC, or a Wallet Standard
  feature such as `solana:signMessage`.
- **`pay({ asset, amount, to })`** uses `wallet_sendCalls` with ERC-7682 auxiliary funds when the wallet offers them
  (Clip does), so the wallet can bring the shortfall in from the person's other balances; with other wallets it sends a
  plain transfer, and `result.fallback` says so.
- **`balances()`** and **`canPay()`** speak in assets (`usdc`, `eth`), summed over your chains.
- **Adapters:** React hooks (`/react`), a wagmi connector (`/wagmi`), a Solana wallet-adapter wrapper (`/solana`).

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/connect
```

## Example

```ts
import { connect } from "@clip-wallet/connect";

const wallet = await connect({ chains: [84532, 11155111] }); // Base Sepolia, Ethereum Sepolia
console.log(wallet.wallet.name, wallet.accounts); // "Clip Wallet", ["eip155:84532:0x…"]

const paid = await wallet.pay({ asset: "usdc", amount: "25", to: "0x000000000000000000000000000000000000dEaD" });
if (paid.fallback) console.log("Plain transfer: the balance on", paid.chain, "had to cover it.");
const { status } = await paid.wait(); // "confirmed" | "failed"
console.log(status);
```

### React

```tsx
import { ClipConnectProvider, useBalances, useClipConnect, usePay } from "@clip-wallet/connect/react";

function Checkout() {
  const { connection, connect } = useClipConnect();
  const { pay, pending } = usePay();
  const { balances } = useBalances();
  if (!connection) return <button onClick={() => void connect()}>Connect</button>;
  return (
    <button disabled={pending} onClick={() => void pay({ asset: "usdc", amount: "25", to: "0x000000000000000000000000000000000000dEaD" })}>
      Pay 25 USDC (you have {balances.usdc?.formatted ?? "0"})
    </button>
  );
}

export const App = () => (
  <ClipConnectProvider options={{ chains: [84532] }}>
    <Checkout />
  </ClipConnectProvider>
);
```

### wagmi

```ts
import { createConfig, http } from "@wagmi/core";
import { baseSepolia } from "@wagmi/core/chains";
import { clipConnect } from "@clip-wallet/connect/wagmi";

export const config = createConfig({ chains: [baseSepolia], transports: { [baseSepolia.id]: http() }, connectors: [clipConnect()] });
```

The wagmi connector is wagmi's own `injected` connector pointed at Clip Wallet's EIP-6963 provider. It falls back to
another announced wallet, then to `window.ethereum`. wagmi's EIP-6963 discovery keeps listing every other wallet.

### Solana wallet adapter

```ts
import { clipSolanaAdapter } from "@clip-wallet/connect/solana";

export const adapter = clipSolanaAdapter(); // StandardWalletAdapter for Clip, else another Solana wallet, else null
```

### WalletConnect or AppKit, when nothing is injected

Pass `walletConnect: { projectId, load }` (your own Reown project id; `load` imports the optional peer
`@walletconnect/ethereum-provider`) or `fallback: () => provider` with any EIP-1193 provider, such as Reown AppKit's.
Clip Connect never ships a WalletConnect project id. See the [connect() guide](https://coldai.org/clip/docs/connect/connect.html).

### Kit-built wallets

Wallets built on the Clip Wallet kit announce their own identity. Prefer yours with
`connect({ prefer: { rdns: "com.example.mywallet", name: "My Wallet" } })`.

Optional peers, for the parts you use: `react`, `@wagmi/core`, `@solana/wallet-standard-wallet-adapter-base`,
`@walletconnect/ethereum-provider`.

## Documentation

- [Clip Connect](https://coldai.org/clip/docs/connect/)
- [pay(), canPay(), balances()](https://coldai.org/clip/docs/connect/pay.html)
- [Wallet calls (EIP-5792)](https://coldai.org/clip/docs/connect/wallet-calls.html)
- [API reference](https://coldai.org/clip/docs/reference/api/connect.html)

## Compatibility promise

Clip Connect is opt-in. Clip Wallet's injected providers and WalletConnect behave exactly the same for dapps that never
use it. These are EIP-1193 and EIP-6963, the Solana, Sui, Aptos and Bitcoin Wallet Standard wallets, CIP-30,
`injectedWeb3`, get-starknet, TON Connect, NEAR, Stellar, Algorand, Beacon and WalletConnect. The new wallet methods
(`wallet_getCapabilities`, `wallet_sendCalls`, `wallet_getCallsStatus`, `wallet_showCallsStatus`) are additive, so a
dapp that never calls them sees no difference. The extension's compat e2e suite checks this against real, unmodified
dapp libraries before and after every change: wagmi/viem, @solana/wallet-adapter, the Sui wallet-standard,
@polkadot/extension-dapp, Reown AppKit, CIP-30 and a plain `window.ethereum` dapp. See
[docs/compat.md](../../docs/compat.md).

## Capabilities

What `pay()` does depends on what the connected wallet says it can do:

| Wallet | `wallet_getCapabilities` | `pay()` sends | `auxiliaryFunds` | `fallback` |
| --- | --- | --- | --- | --- |
| Clip Wallet, chain where it can bring money in | `atomic: unsupported`, `auxiliaryFunds: { supported: true, assets }` | `wallet_sendCalls` with `capabilities.auxiliaryFunds { optional: true, requiredAssets }` | `true` | — |
| Clip Wallet, other chains | `atomic: unsupported` | `wallet_sendCalls` | `false` | `"no-auxiliary-funds"` |
| Another EIP-5792 wallet (smart account) | whatever it says (`atomic: supported`, …) | `wallet_sendCalls`, plus `requiredAssets` if it advertises ERC-7682 | as advertised | — / `"no-auxiliary-funds"` |
| A wallet without EIP-5792 | error 4200 / -32601 | `eth_sendTransaction` (same chain) | `false` | `"no-eip5792"` |

Clip Wallet's side, in more detail:

- **`atomic: unsupported` on every chain.** Clip accounts are EOAs. A batch is one approval, and then its calls run
  one after another. Clip refuses `atomicRequired: true` with error 5760, and `wallet_getCallsStatus` reports
  `atomic: false`.
- **`auxiliaryFunds`.** Clip advertises this on a chain when settle on Hedera can bring money in for that chain and
  asset: a bonded Connector is paid in the same asset on another network, and the order is covered on Hedera. The
  advertisement comes from the wallet's catalog and the Connector deployments, never from the user's balances.
  Whether one particular payment can be funded is decided when it arrives.
- **Over WalletConnect.** Clip serves the same methods when your session asks for them. The approved session carries
  each chain's capabilities in CAIP-25 `scopedProperties`.

## Standards (read 2026-10-05)

- EIP-5792 Wallet Call API (Final): https://eips.ethereum.org/EIPS/eip-5792. This covers `atomic`, `atomicRequired`,
  status codes 100/200/400/500/600 and errors 5700–5760.
- ERC-7682 Auxiliary Funds Capability (Draft): https://eips.ethereum.org/EIPS/eip-7682. This covers `assets` with the
  EIP-7528 native address, `requiredAssets` and errors 5770–5773.
- EIP-6963 Multi Injected Provider Discovery: https://eips.ethereum.org/EIPS/eip-6963
- Wallet Standard: https://github.com/wallet-standard/wallet-standard
- WalletConnect wallets and EIP-5792 (capabilities in `sessionProperties` / `scopedProperties`):
  https://docs.walletconnect.com/wallets/web/eip5792
- CAIP-2 / CAIP-10: https://chainagnostic.org/CAIPs/caip-2, https://chainagnostic.org/CAIPs/caip-10
- Circle USDC addresses (the built-in `usdc` key): https://developers.circle.com/stablecoins/usdc-contract-addresses

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

See [LICENSE](./LICENSE).
