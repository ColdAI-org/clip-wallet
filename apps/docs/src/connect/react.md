# React hooks

`@clip-wallet/connect/react` wraps `connect()` in a provider and three hooks. `react` (18 or 19) is an optional peer.

<<< @/snippets/connect/react.tsx

| Hook | Returns |
| --- | --- |
| `useClipConnect()` | `{ connection, status, error, connect(), disconnect() }`; `status` is `"idle"`, `"connecting"`, `"connected"` or `"error"` |
| `usePay()` | `{ pay(request), result, error, pending }`; `pay` throws `"Connect a wallet first."` without a connection |
| `useBalances()` | `{ balances, loading, refresh() }`; reads once per connection |

`ClipConnectProvider` takes the same `options` as [`connect()`](./connect.md) and resets to `"idle"` when the wallet
disconnects. Hooks used outside it throw `"useClipConnect needs <ClipConnectProvider> above it."`.
