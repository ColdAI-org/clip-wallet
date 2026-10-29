---
"@clip-wallet/engine": patch
"@clip-wallet/extension-kit": patch
"@clip-wallet/1mask": patch
"@clip-wallet/core": patch
---

Disconnecting an app now ends the requests it sent while connected. Disconnect in the wallet, or the app's own
(`wallet_revokePermissions`, `standard:disconnect` and the like), rejects them with `approval/cancelled` and takes them
off the queue, the same way a timeout does; a Connector payment under way stays until it arrives or is claimed, and never
signs for the app. Approve also checks the site is still connected before it signs a request that came with a
permission. A WalletConnect session that ends, from either side, cancels its waiting requests too. New message
`bg.err.appDisconnected`, in every language.
