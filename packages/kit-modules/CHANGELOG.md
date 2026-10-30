# @clip-wallet/kit-modules

## 0.2.0

### Patch Changes

- 07f329b: Relicensed from MIT to the Apache License 2.0 (`Copyright 2026 ColdAI`). Every published package now ships `LICENSE`
  (Apache-2.0) and a `NOTICE` with the trademark note ("Clip Wallet", "1Mask" and the logo are ColdAI trademarks; the
  licence grants no trademark rights). `@clip-wallet/route` keeps the MIT notice of the vendored CLPRouter SDK planner,
  and `create-clip-wallet` keeps the MIT notice of the Scaffold-HBAR / Scaffold-ETH 2 dapp in its bundled template.
  Projects made with `create-clip-wallet` or the Scaffold-HBAR template start as Apache-2.0.
- b526f86: The NEAR Wallet Selector, Stellar Wallets Kit and use-wallet modules show the name and icon the installed wallet announces (`window[globalKey].info`, set by 1Mask), so a kit-built wallet appears under its own identity in those pickers. Explicit options still win; without an announcement they fall back to Clip Wallet's identity.
- b97d4c2: 1Mask: unconnected sites may only proxy cheap chain-state reads (eth_blockNumber, gas price, fee history, syncing,
  client version) through the wallet's RPC; every other read needs the connection. Proxied reads have their own
  per-site limits (5/s, burst 20, 8 in flight; `rateLimit.readsPerSecond` / `readBurst` / `maxInflightReads`). After a
  declined connect the site can't ask again for 30 s, doubling to 10 min (`rateLimit.connectCooldownMs`). The Tezos
  Beacon peer keeps at most 16 uncollected results per site and drops them after 15 minutes. Audit 1MASK-L.
- 2d940da: Every package README is now an npm landing page: what the package is for, how to install it, a minimal example that compiles, and links to the developer docs.
