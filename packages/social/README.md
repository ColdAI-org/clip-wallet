# @clip-wallet/social

The wallet's social layer, as background services with no keys: an address book (contacts), Clip handles on Hedera
(read through the JSON-RPC relay; registration is a normal approval), notifications, and Discover (market data for
assets you hold or watch). Hosts build a `SocialService`; screens use the views (`/views`) over the message bus
(`/messages`).

```ts
import { SocialService } from "@clip-wallet/social";
```

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly. Pre-release: test networks by default.

MIT licence.
