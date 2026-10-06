# wagmi connector

`clipConnect()` from `@clip-wallet/connect/wagmi` is wagmi's own `injected` connector, pointed at Clip Wallet's
EIP-6963 provider. It falls back to another announced wallet, then to `window.ethereum`. `@wagmi/core` 2 or 3 is an
optional peer.

<<< @/snippets/connect/wagmi.ts

- It gives your app **one Connect button that prefers Clip**. wagmi's own EIP-6963 discovery keeps listing every other
  wallet next to it.
- Its id is `"clipConnect"`; its name and icon are the chosen wallet's.
- `clipConnect({ prefer: { rdns, name } })` prefers a kit-built wallet instead; `shimDisconnect` (default `true`) is
  passed to wagmi.

For `pay()` with auxiliary funds, call Clip Connect's `connect()` (or use the [React hooks](./react.md)) on the same
provider.
