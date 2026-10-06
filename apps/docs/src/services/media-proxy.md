# Media proxy

`services/media-proxy` fetches NFT images and video for the wallet, so the wallet never loads an untrusted URL itself.
Without it, NFT media show placeholder art and nothing remote is fetched.

```text
GET /v1/media?src=<canonical source>&kind=image|video
```

Build the URL with `mediaProxyUrl()` from `@clip-wallet/media-client`. The Worker re-validates with the same code
(`parseProxyQuery()`), so the two can't disagree:

<<< @/snippets/services/media-url.ts

## What it enforces

- **Sources:** `https`, `http`, `ipfs://<CID>[/path]` and `ar://<tx>[/path]`. Public IPFS and Arweave gateway URLs are
  rewritten to `ipfs://` / `ar://` and fetched through the configured gateways. Refused: `data:`, `blob:`,
  `javascript:`, `file:`, credentials in URLs, non-default ports, private, loopback, link-local and multicast IP
  ranges, IPv6 literals, single-label hosts, `localhost`, `.local`, `.internal`.
- **Redirects** are followed by hand, at most 3, and every hop is checked again, so a public URL can't bounce to a
  cloud metadata address.
- **Types** come from sniffing the first bytes, never from the URL or the upstream `Content-Type`: PNG, JPEG, GIF, WebP,
  AVIF, SVG, MP4, WebM. HTML, scripts and PDFs get `415`.
- **Size:** 10 MiB for images, 50 MiB for video, checked against `Content-Length` and again while streaming.
- **SVG** is served with a `sandbox` CSP and rendered only in `<img>`, where its scripts don't run.
- **Headers** are fresh: nothing from upstream passes through (no cookies, no upstream CORS or CSP). Outbound requests
  carry no cookies or referrer.
- **Caching:** content-addressed sources (`ipfs`, `ar`) are immutable for a year; others a day. Errors aren't cached,
  except `404` and `415` for an hour.
- **Rate limit:** 300 requests a minute per client IP (`MEDIA_LIMITER`).

## Configuration

| Variable | Default |
| --- | --- |
| `IPFS_GATEWAY` | `https://ipfs.filebase.io` (shared and rate-limited: use a dedicated gateway before real traffic) |
| `ARWEAVE_GATEWAY` | `https://arweave.net` |

No secrets. Deploying it: [Self-host on Cloudflare](./self-hosting.md#media-proxy). Details:
[`services/media-proxy/README.md`](repo:services/media-proxy/README.md).
