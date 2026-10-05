# services/link-relay — Clip Link relay

A Cloudflare Worker with one Durable Object per channel (WebSocket Hibernation API) that forwards text frames
between the two sides of a Clip Link pairing (phone ⇄ extension / Clip Desktop). Frames are end-to-end
encrypted by `@clip-wallet/link`; the relay never sees keys or plaintext. Deployed for testnet builds at
`https://clip-link-relay.doyoka-platform.workers.dev` (no secrets, observability off).

    GET /v1/health
    GET /v1/channel/<22-char id>?role=a|b      Upgrade: websocket

Stores only frames waiting for an absent peer: ≤ 64 frames / 512 KiB, ≤ 10 minutes, then the channel's storage is
deleted. Limits: 64 KiB per frame, 120 frames per 10 s per socket, 120 connections per hour per channel. A role that
reconnects replaces its old socket, and frames it queued earlier are dropped (they belong to a dead session).
Threat model: `packages/link/README.md`. Tests: `pnpm --filter @clip-wallet/service-link-relay test` (workerd).
