/**
 * Clip Link relay. One Durable Object per channel forwards WebSocket text frames between role "a" and role "b".
 * It stores nothing but frames in flight to a role that isn't connected, for at most 10 minutes, then deletes
 * everything. It never sees plaintext: pairing frames carry only public keys, commitments and MACs, and every
 * frame after pairing is XChaCha20-Poly1305 ciphertext (@clip-wallet/link). Protocol: @clip-wallet/link/relay-protocol.
 *
 * Uses the WebSocket Hibernation API (state.acceptWebSocket, webSocketMessage/webSocketClose, attachments) so an
 * idle channel costs nothing: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
 */
import { DurableObject } from "cloudflare:workers";
import { CHANNEL_ID, RELAY_LIMITS, type RelayControl, type RelayRole } from "@clip-wallet/link/relay-protocol";

export interface Env {
  CHANNELS: DurableObjectNamespace<LinkChannel>;
}

const HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; frame-ancestors 'none'", "referrer-policy": "no-referrer" };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, "content-type": "application/json" } });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/v1/health") return json(200, { ok: true });
    const m = /^\/v1\/channel\/([^/]+)$/.exec(url.pathname);
    if (!m) return json(404, { error: "not-found" });
    const id = m[1]!;
    const role = url.searchParams.get("role");
    if (!CHANNEL_ID.test(id) || (role !== "a" && role !== "b")) return json(400, { error: "bad-request" });
    if (req.method !== "GET" || req.headers.get("upgrade")?.toLowerCase() !== "websocket") return json(426, { error: "websocket-required" });
    return env.CHANNELS.get(env.CHANNELS.idFromName(id)).fetch(req);
  },
} satisfies ExportedHandler<Env>;

interface Attachment {
  role: RelayRole;
  win: number;
  count: number;
}

const other = (r: RelayRole): RelayRole => (r === "a" ? "b" : "a");
const control = (m: RelayControl) => JSON.stringify(m);
const enc = new TextEncoder();

/** Queued frame keys: q:<to role>:<zero-padded seq>  → { f: frame, at: ms }. */
export class LinkChannel extends DurableObject<Env> {
  private sockets(role: RelayRole): WebSocket[] {
    return this.ctx.getWebSockets(role);
  }

  async fetch(req: Request): Promise<Response> {
    const role = new URL(req.url).searchParams.get("role") as RelayRole;
    const now = Date.now();
    // Per-channel connection budget (a leaked channel id can't be hammered).
    const hour = Math.floor(now / 3_600_000);
    const c = (await this.ctx.storage.get<{ hour: number; n: number }>("connects")) ?? { hour, n: 0 };
    const n = c.hour === hour ? c.n + 1 : 1;
    if (n > RELAY_LIMITS.connectsPerHour) return json(429, { error: "rate-limited" });
    await this.ctx.storage.put("connects", { hour, n });

    // A role reconnecting replaces its old socket, and its old undelivered frames belong to a dead session.
    for (const ws of this.sockets(role)) ws.close(4001, "replaced");
    await this.deleteQueue(other(role));

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, win: now, count: 0 } satisfies Attachment);
    const peers = this.sockets(other(role));
    server.send(control({ relay: "peer", present: peers.length > 0 }));
    for (const [key, v] of await this.ctx.storage.list<{ f: string; at: number }>({ prefix: `q:${role}:` })) {
      if (now - v.at <= RELAY_LIMITS.ttlMs) server.send(v.f);
      await this.ctx.storage.delete(key);
    }
    for (const p of peers) p.send(control({ relay: "peer", present: true }));
    await this.ctx.storage.setAlarm(now + RELAY_LIMITS.ttlMs);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment;
    if (typeof message !== "string") return ws.close(1003, "text only");
    if (enc.encode(message).length > RELAY_LIMITS.maxFrameBytes) {
      ws.send(control({ relay: "error", code: "too-large" }));
      return;
    }
    const now = Date.now();
    const fresh = now - a.win > RELAY_LIMITS.windowMs;
    const next: Attachment = { role: a.role, win: fresh ? now : a.win, count: fresh ? 1 : a.count + 1 };
    ws.serializeAttachment(next);
    if (next.count > RELAY_LIMITS.framesPerWindow) {
      ws.send(control({ relay: "error", code: "rate-limited" }));
      if (next.count > RELAY_LIMITS.framesPerWindow * 2) ws.close(4008, "rate limited");
      return;
    }
    if (message === '{"t":"ka"}') return; // keep-alive from a service worker: not forwarded
    const to = other(a.role);
    const peers = this.sockets(to);
    if (peers.length) {
      for (const p of peers) p.send(message);
      return;
    }
    const queued = await this.ctx.storage.list<{ f: string }>({ prefix: `q:${to}:` });
    const bytes = [...queued.values()].reduce((s, v) => s + v.f.length, 0);
    if (queued.size >= RELAY_LIMITS.maxQueuedFrames || bytes + message.length > RELAY_LIMITS.maxQueuedBytes) {
      ws.send(control({ relay: "error", code: "queue-full" }));
      return;
    }
    const seq = ((await this.ctx.storage.get<number>("seq")) ?? 0) + 1;
    await this.ctx.storage.put({ seq, [`q:${to}:${String(seq).padStart(12, "0")}`]: { f: message, at: now } });
    await this.ctx.storage.setAlarm(now + RELAY_LIMITS.ttlMs);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a) return;
    // Only report "gone" if no newer socket of this role is open.
    if (this.sockets(a.role).filter((s) => s !== ws).length === 0) for (const p of this.sockets(other(a.role))) p.send(control({ relay: "peer", present: false }));
    await this.ctx.storage.setAlarm(Date.now() + RELAY_LIMITS.ttlMs);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /** TTL: expired frames go; an idle channel with nothing left is wiped completely. */
  async alarm(): Promise<void> {
    const now = Date.now();
    for (const [key, v] of await this.ctx.storage.list<{ at: number }>({ prefix: "q:" })) if (now - v.at > RELAY_LIMITS.ttlMs) await this.ctx.storage.delete(key);
    const open = this.ctx.getWebSockets().length;
    const left = (await this.ctx.storage.list({ prefix: "q:" })).size;
    if (!open && !left) await this.ctx.storage.deleteAll();
    else await this.ctx.storage.setAlarm(now + RELAY_LIMITS.ttlMs);
  }

  private async deleteQueue(to: RelayRole) {
    const keys = [...(await this.ctx.storage.list({ prefix: `q:${to}:` })).keys()];
    if (keys.length) await this.ctx.storage.delete(keys);
  }
}
