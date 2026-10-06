# connect()

`connect(options?)` discovers wallets, picks one, asks it to connect and returns a `ClipConnection`.

## Which wallet it picks

For EVM (the default family), in this order:

1. **EIP-6963 wallets**, the preferred one first (Clip Wallet unless you set `prefer`), then the others in the order
   they announced themselves.
2. **`window.ethereum`**, if nothing announced itself.
3. **`fallback`**, any EIP-1193 provider you pass, such as Reown AppKit's.
4. **`walletConnect`**, with your own project id.

For Solana, Sui, Aptos and Bitcoin (`families`), it looks in the Wallet Standard registry for a wallet with that
family's chains and `standard:connect`, preferred one first, and asks each once.

If no wallet is found for any requested family, `connect()` throws an error with `code: "no-wallet"`.

## Options

<<< @/snippets/connect/options.ts

| Option | Default | |
| --- | --- | --- |
| `prefer` | `{ rdns: "org.coldai.clipwallet", name: "Clip Wallet" }` | the wallet to put first |
| `families` | `["evm"]` | `"evm"`, `"solana"`, `"sui"`, `"aptos"`, `"bitcoin"` |
| `chains` | the wallet's current chain | EVM chain ids your app works on |
| `assets` | the built-in table | extra assets by key ([pay()](./pay.md#assets)) |
| `rpc` | none | read-only RPC per chain id, for balances on chains the wallet isn't on right now |
| `fallback` | none | an EIP-1193 provider when nothing is injected |
| `walletConnect` | none | `{ projectId, metadata?, showQrModal?, load? }` |
| `waitMs` | `120` | how long to wait for wallets to announce themselves |
| `window` | `globalThis.window` | for iframes and tests |

## Kit-built wallets

Wallets built on the Clip Wallet kit announce their own name and rdns. Prefer yours with
`prefer: { rdns: "com.example.mywallet", name: "My Wallet" }`; everything else works the same.

## Nothing injected: WalletConnect

On a phone browser, or a browser with no wallet, fall back to WalletConnect. Clip Connect never ships a project id: use
your own from Reown Cloud. The session asks for the EIP-5792 methods, so wallets that serve them (Clip does) say so.

<<< @/snippets/connect/fallback-walletconnect.ts

`load` lets your bundler see the optional peer dependency. The small wrapper is needed because Clip Connect declares
the provider's options loosely while the package types them exactly.

## Or reuse a provider you have

<<< @/snippets/connect/fallback-appkit.ts

## The connection

| Member | |
| --- | --- |
| `wallet` | `{ name, icon?, rdns?, via, preferred }`; `via` is `"eip6963"`, `"window.ethereum"`, `"fallback"`, `"walletconnect"` or `"wallet-standard"` |
| `accounts` | every connected account, CAIP-10 |
| `evm` | `{ provider, address, chain }` when an EVM wallet is connected: hand `provider` to viem or ethers |
| `standard` | the Wallet Standard wallets connected for other families |
| `request()` | any method on any connected chain: [request()](./request.md) |
| `capabilities(chains?)` | EIP-5792 capabilities per chain, or `null` when the wallet doesn't speak EIP-5792 |
| `pay()`, `canPay()`, `balances()` | [pay(), canPay(), balances()](./pay.md) |
| `on(event, cb)` | `"accountsChanged"`, `"chainChanged"`, `"disconnect"`; returns a function that stops listening |
| `disconnect()` | revokes the site's permission where the wallet supports it, and disconnects every wallet |

## Events

<<< @/snippets/connect/events.ts
