---
"@clip-wallet/1mask": patch
"@clip-wallet/kit-modules": patch
---

1Mask: unconnected sites may only proxy cheap chain-state reads (eth_blockNumber, gas price, fee history, syncing,
client version) through the wallet's RPC; every other read needs the connection. Proxied reads have their own
per-site limits (5/s, burst 20, 8 in flight; `rateLimit.readsPerSecond` / `readBurst` / `maxInflightReads`). After a
declined connect the site can't ask again for 30 s, doubling to 10 min (`rateLimit.connectCooldownMs`). The Tezos
Beacon peer keeps at most 16 uncollected results per site and drops them after 15 minutes. Audit 1MASK-L.
