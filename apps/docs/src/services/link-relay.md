# Link relay

`services/link-relay` forwards end-to-end encrypted frames between the two sides of a [Clip Link](../architecture/link.md)
pairing: the phone and the extension, or the phone and Clip Desktop. It never sees keys or plaintext.

```text
GET /v1/health
GET /v1/channel/<22-character id>?role=a|b      Upgrade: websocket
```

One Durable Object per channel (WebSocket Hibernation API).

- **What it stores:** only frames waiting for an absent peer, at most 64 frames or 512 KiB, for at most 10 minutes;
  then the channel's storage is deleted.
- **Limits:** 64 KiB per frame, 120 frames per 10 seconds per socket, 120 connections an hour per channel.
- **Reconnects:** a role that reconnects replaces its old socket, and frames it queued earlier are dropped.
- **No secrets, no logs** (observability is off).

The relay sees ciphertext, frame sizes and timing. Pairing is protected by the commit-reveal exchange, the 6-digit code
and key confirmation, so a malicious relay can't link two devices without the people noticing.

Deploying it: [Self-host on Cloudflare](./self-hosting.md#link-relay). Point a wallet at it with
`services.linkRelayUrl`. Tests: `pnpm --filter @clip-wallet/service-link-relay test` (a pairing through the Durable
Object in workerd).
