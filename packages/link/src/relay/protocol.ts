/**
 * Clip Link relay (services/link-relay) wire protocol, shared by the Worker and the clients.
 *
 *   GET /v1/channel/<id>?role=a|b   (Upgrade: websocket)   id = 16 random bytes, base64url (22 chars)
 *   GET /v1/health
 *
 * One Durable Object per channel id forwards text frames between the two roles. Frames are opaque to it (already
 * end-to-end encrypted, or pairing messages that only carry public keys and MACs). If the other role isn't
 * connected, frames wait in the object's storage for at most RELAY_LIMITS.ttlMs, then everything is deleted.
 * The relay adds control frames of its own, always shaped { relay: … }.
 *
 * @module
 */
export const RELAY_LIMITS = {
  maxFrameBytes: 64 * 1024,
  maxQueuedFrames: 64,
  maxQueuedBytes: 512 * 1024,
  ttlMs: 10 * 60_000,
  /** Per socket: at most this many frames per window. */
  framesPerWindow: 120,
  windowMs: 10_000,
  /** Per channel: new connections per hour. */
  connectsPerHour: 120,
} as const;

export const CHANNEL_ID = /^[A-Za-z0-9_-]{22}$/;
export type RelayRole = "a" | "b";

export type RelayControl =
  | { relay: "peer"; present: boolean }
  | { relay: "error"; code: "too-large" | "rate-limited" | "queue-full" | "replaced" };

export function isRelayControl(m: unknown): m is RelayControl {
  return !!m && typeof m === "object" && typeof (m as { relay?: unknown }).relay === "string";
}

export function channelUrl(relay: string, id: string, role: RelayRole): string {
  const u = new URL(`/v1/channel/${id}`, relay);
  u.protocol = u.protocol === "http:" ? "ws:" : "wss:";
  u.searchParams.set("role", role);
  return u.toString();
}
