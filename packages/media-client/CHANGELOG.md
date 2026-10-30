# @clip-wallet/media-client

## 0.2.0

### Patch Changes

- 07f329b: Relicensed from MIT to the Apache License 2.0 (`Copyright 2026 ColdAI`). Every published package now ships `LICENSE`
  (Apache-2.0) and a `NOTICE` with the trademark note ("Clip Wallet", "1Mask" and the logo are ColdAI trademarks; the
  licence grants no trademark rights). `@clip-wallet/route` keeps the MIT notice of the vendored CLPRouter SDK planner,
  and `create-clip-wallet` keeps the MIT notice of the Scaffold-HBAR / Scaffold-ETH 2 dapp in its bundled template.
  Projects made with `create-clip-wallet` or the Scaffold-HBAR template start as Apache-2.0.
- f5a0e15: `isBlockedHost()` parses the host with the WHATWG URL parser (new `parseHost()`) and compares addresses by range and
  names by label: IPv4 in any spelling (`127.1`, `0x7f.0.0.1`), documentation, benchmark and reserved ranges, and
  private-use names (`.lan`, `.home`, `.corp`, `.test`, …) are now refused; public names that only contain such words
  aren't. Audit MEDIA-01.
- 2d940da: Every package README is now an npm landing page: what the package is for, how to install it, a minimal example that compiles, and links to the developer docs.
