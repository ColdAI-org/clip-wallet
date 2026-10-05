# @clip-wallet/names

Turns a name into an address and the network it implies: ENS (`alice.eth`), SNS (`alice.sol`), Hedera names
(`alice.hbar`) and Clip handles on Hedera. Reads only; no keys, no signing. Used by Send to resolve recipients, so the
"network matters" prompt knows where a name points.

```ts
import { createNameResolver } from "@clip-wallet/names";
const resolver = createNameResolver();
const r = await resolver.resolve("alice.eth"); // { name, address, family, networkIds, … } or null
```

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly. Pre-release: test networks by default.

MIT licence.
