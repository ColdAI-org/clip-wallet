# @clip-wallet/social

The wallet's social layer, as background services with no keys: an address book (contacts), Clip handles on Hedera
(read through the JSON-RPC relay; registration is a normal approval), notifications, and Discover (market data for
assets you hold or watch). Hosts build a `SocialService`; screens use the views (`/views`) over the message bus
(`/messages`).

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/social
```

## Example

```ts
import { isSocialRequest, type SocialService } from "@clip-wallet/social";

// In the wallet's background: route the screens' social messages to the service.
export function routeSocial(service: SocialService, message: { type: string }) {
  return isSocialRequest(message) ? service.handle(message) : undefined;
}
```

## Documentation

- [Social, names and hardware](https://coldai.org/clip/docs/architecture/social-names-hardware.html)
- [API reference](https://coldai.org/clip/docs/reference/api/social.html)

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

See [LICENSE](./LICENSE).
