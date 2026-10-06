# @clip-wallet/media-client

Decides what an untrusted NFT media URL may become. Shared by the wallet UI (to build proxy URLs) and the media proxy
service (to re-validate them), so both sides agree. Pure functions, no I/O.

- Sources: https, http, `ipfs://` and `ar://`; public gateway URLs are rewritten to `ipfs://` / `ar://`.
- Never: `data:`, `blob:`, `javascript:`, `file:`, credentials in URLs, odd ports, private or loopback hosts.
- Output: raster images, sandboxed SVG, mp4/webm video, within `MEDIA_LIMITS`.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/media-client
```

## Example

```ts
import { mediaProxyUrl } from "@clip-wallet/media-client";

// null = show a placeholder and fetch nothing.
const media = mediaProxyUrl("https://media.example.com", "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/1.png");
console.log(media); // { kind: "image", src: "https://media.example.com/v1/media?src=ipfs%3A%2F%2F…&kind=image" }
```

Without a configured proxy (`services.mediaProxyUrl` in clip.config.ts) the wallet fetches nothing remote.

## Documentation

- [Media proxy](https://coldai.org/clip/docs/services/media-proxy.html)
- [API reference](https://coldai.org/clip/docs/reference/api/media-client.html)

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

Apache-2.0: see [LICENSE](./LICENSE) and [NOTICE](./NOTICE). "Clip Wallet" and "1Mask" are ColdAI trademarks (not licensed).
