# @clip-wallet/names

Turns a name into an address and the network it implies: ENS (`alice.eth`), SNS (`alice.sol`), Hedera names
(`alice.hbar`), Clip handles on Hedera, and names a Clip Plugin resolves. Read-only: no keys, no signing. Send uses it,
so the "network matters" question knows where a name points.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/names
```

## Example

```ts
import { createNameResolver } from "@clip-wallet/names";

const resolver = createNameResolver();
const hit = await resolver.resolve("alice.eth"); // { name, address, family, networkIds, … } or null
console.log(hit?.address);
```

## Documentation

- [Social, names and hardware](https://coldai.org/clip/docs/architecture/social-names-hardware.html)
- [API reference](https://coldai.org/clip/docs/reference/api/names.html)

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

Apache-2.0: see [LICENSE](./LICENSE) and [NOTICE](./NOTICE). "Clip Wallet" and "1Mask" are ColdAI trademarks (not licensed).
