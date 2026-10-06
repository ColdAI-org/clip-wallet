# Services

Three optional Cloudflare Workers live in `services/`. Clip Wallet works without any of them; each one switches a
feature on when a wallet's `clip.config.ts` points at a deployment. Each sees only ciphertext or public data.

| Service | Folder | Config key | Switches on | Storage |
| --- | --- | --- | --- | --- |
| [Backup](./backup.md) | `services/backup` | `services.backupUrl` | passkey backup (email, Google or Apple sign-in) and settings sync | D1 + R2 |
| [Media proxy](./media-proxy.md) | `services/media-proxy` | `services.mediaProxyUrl` | NFT images and video | Cache API |
| [Link relay](./link-relay.md) | `services/link-relay` | `services.linkRelayUrl` | phone as signer, pairing, moving a wallet | Durable Objects |

Run your own: [Self-host on Cloudflare](./self-hosting.md). Then point your wallet at it:

<<< @/snippets/kit/services.ts

The extension's manifest picks the services' origins up as host permissions automatically.

## Testing them

Each service's tests run inside workerd with `@cloudflare/vitest-pool-workers`, against local D1, R2 and Durable
Objects. Nothing remote is touched:

```sh
pnpm --filter @clip-wallet/service-backup test
pnpm --filter @clip-wallet/service-media-proxy test
pnpm --filter @clip-wallet/service-link-relay test
```

Run one locally with `pnpm --filter @clip-wallet/service-backup dev` (`wrangler dev --local`).
