# services/media-proxy — sandboxed NFT media

A Cloudflare Worker the wallet UI loads every NFT image/video through, so the extension never fetches an
untrusted URL itself. Deployed for testnet builds at `https://clip-media-proxy.doyoka-platform.workers.dev` (see [docs/phase25/deploy.md](../../docs/phase25/deploy.md)).

```
GET /v1/media?src=<canonical source>&kind=image|video
```

Build URLs with `mediaProxyUrl(base, rawUrl)` from [`@clip-wallet/media-client`](../../packages/media-client);
the Worker re-validates with the same code (`parseProxyQuery`), so the two can't disagree.

## What it enforces

- **Sources:** `https`, `http`, `ipfs://<CIDv0|CIDv1>[/path]`, `ar://<43-char tx>[/path]`. Public IPFS path and
  subdomain gateway URLs and `arweave.net/<tx>` are rewritten to `ipfs://`/`ar://` and fetched through
  `IPFS_GATEWAY` (default `https://ipfs.filebase.io`; ipfs.io stopped serving HTTP content in Sept 2026) / `ARWEAVE_GATEWAY`. Rejected: `data:`, `blob:`, `javascript:`, `file:`, userinfo, non-default
  ports, IPv4 in private/loopback/link-local/CGNAT/documentation/benchmark/multicast/reserved ranges (in any
  spelling the URL parser accepts: `127.1`, `0x7f.0.0.1`, `2130706433`), IPv6 literals, single-label hosts, and
  special-use or private-use names (`localhost`, `.local`, `.internal`, `.arpa`/`.home.arpa`, `.test`, `.invalid`,
  `.onion`, `.alt`, `.lan`, `.home`, `.corp`, `.intranet`, `.private`). Hosts are parsed with the WHATWG URL parser
  and compared as addresses or by labels (`parseHost` / `isBlockedHost` in `@clip-wallet/media-client`), never as
  strings.
- **Redirects:** followed by hand (`redirect: "manual"`), at most 3, and every hop is re-validated with the
  same rules, so a public URL can't bounce to `169.254.169.254`, a private address or a `.lan` name.
- **DNS:** a public name that resolves to a private address (DNS rebinding) is stopped by the platform: Cloudflare
  Workers' `fetch()` can't reach private or loopback addresses. Self-hosting it anywhere else needs an egress
  firewall that does the same.
- **Types:** decided by sniffing the first bytes, never by the URL or upstream `Content-Type`: PNG, JPEG,
  GIF, WebP, AVIF, SVG, MP4, WebM. The sniffed kind must match the requested `kind`. HTML, JS, PDF → 415.
- **Size:** 10 MiB images, 50 MiB video; checked against `Content-Length` and again while streaming
  (a lying upstream gets the stream aborted, and the truncated body is never cached).
- **SVG:** served as `image/svg+xml` (not rasterised) with
  `Content-Security-Policy: default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox`. The UI
  only ever renders it in `<img>`, where SVG scripts don't run; the CSP covers someone opening the URL
  directly. Rasterising to PNG (resvg-wasm) was left out: it adds ~2 MB of WASM and CPU per request for no
  extra safety given `<img>` + sandbox CSP.
- **Headers:** a fresh set; nothing from upstream is passed through (no `Set-Cookie`, upstream CORS/CSP,
  `Location`, etc.). Outbound requests carry no cookies or referrer.
- **Caching:** Cache API, keyed by canonical source + kind. Content-addressed sources (`ipfs`, `ar`) are
  `immutable` for a year; others a day. Errors are not cached (except 404/415 for an hour).
- **Rate limit:** the Workers rate-limiting binding `MEDIA_LIMITER`, 300 requests / 60 s per client IP.

## Tests

`pnpm --filter @clip-wallet/service-media-proxy test` (workerd via `@cloudflare/vitest-pool-workers` 0.22; upstream
fetch injected, nothing leaves the machine). 20 tests: headers stripped, gateways, SVG CSP, type sniffing,
size caps (declared and streamed), redirect SSRF, redirect limit, error mapping, rate limit, cache.

Sources: rate-limit binding config <https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/>;
Cache API <https://developers.cloudflare.com/workers/runtime-apis/cache/>; file signatures from the WHATWG
MIME Sniffing standard §6 (image/video type patterns).
