# @clip-wallet/media-client

Decides what an untrusted NFT media URL may become. Shared by the wallet UI (to build proxy URLs) and the media proxy
service (to re-validate them), so both sides agree. Pure functions, no I/O.

- Sources: https, http, `ipfs://` and `ar://`; public gateway URLs are rewritten to `ipfs://` / `ar://`.
- Never: `data:`, `blob:`, `javascript:`, `file:`, credentials in URLs, odd ports, private or loopback hosts.
- Output: raster images, sandboxed SVG, mp4/webm video, within `MEDIA_LIMITS`.

```ts
import { mediaProxyUrl, normaliseMediaSource } from "@clip-wallet/media-client";
const media = mediaProxyUrl("https://media.example.com", nft.image); // null = show a placeholder
```

Without a configured proxy (`services.mediaProxyUrl` in clip.config.ts) the wallet fetches nothing remote.

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly. Pre-release: test networks by default.

MIT licence.
