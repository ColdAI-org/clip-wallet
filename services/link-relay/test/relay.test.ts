/**
 * The relay in workerd (Miniflare via @cloudflare/vitest-pool-workers): forwarding, queueing with TTL, replacing a
 * reconnecting role, limits, and a full Clip Link pairing + encrypted session through it. The pairing "keys" are
 * fixed test values with a symmetric hash standing in for X25519 (no key is generated here; real X25519 runs in
 * packages/vault/test/link.test.ts).
 */
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { RelayChannel, contextFromOffer, newOffer, openSession, pair, type PairingKeyHandle, type WebSocketLike } from "@clip-wallet/link";

const worker = (exports as unknown as { default: { fetch(req: Request): Promise<Response> } }).default;
const ID = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function open(channel: string, role: "a" | "b") {
  const res = await worker.fetch(new Request(`https://relay.test/v1/channel/${channel}?role=${role}`, { headers: { upgrade: "websocket" } }));
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  const got: string[] = [];
  const waiters: (() => void)[] = [];
  ws.addEventListener("message", (e) => {
    got.push(String(e.data));
    waiters.splice(0).forEach((w) => w());
  });
  let closed: string | undefined;
  ws.addEventListener("close", (e) => {
    closed = e.reason || String(e.code);
  });
  ws.accept();
  const next = async (pred: (s: string) => boolean = () => true, ms = 2000) => {
    const t = Date.now();
    for (;;) {
      const i = got.findIndex(pred);
      if (i >= 0) return got.splice(i, 1)[0]!;
      if (Date.now() - t > ms) throw new Error(`no frame; have ${JSON.stringify(got)}`);
      await new Promise<void>((r) => {
        waiters.push(r);
        setTimeout(r, 50);
      });
    }
  };
  return { ws, got, next, closed: () => closed };
}

const data = (s: string) => !s.startsWith('{"relay"');

describe("link relay", () => {
  it("health and input checks", async () => {
    expect(await (await worker.fetch(new Request("https://relay.test/v1/health"))).json()).toEqual({ ok: true });
    expect((await worker.fetch(new Request(`https://relay.test/v1/channel/${ID()}?role=a`))).status).toBe(426);
    expect((await worker.fetch(new Request("https://relay.test/v1/channel/short?role=a", { headers: { upgrade: "websocket" } }))).status).toBe(400);
    expect((await worker.fetch(new Request(`https://relay.test/v1/channel/${ID()}?role=c`, { headers: { upgrade: "websocket" } }))).status).toBe(400);
  });

  it("forwards frames between the two roles and tells each when the other is there", async () => {
    const ch = ID();
    const a = await open(ch, "a");
    expect(await a.next()).toBe('{"relay":"peer","present":false}');
    const b = await open(ch, "b");
    expect(await b.next()).toBe('{"relay":"peer","present":true}');
    expect(await a.next()).toBe('{"relay":"peer","present":true}');
    a.ws.send("hello b");
    b.ws.send("hello a");
    expect(await b.next(data)).toBe("hello b");
    expect(await a.next(data)).toBe("hello a");
    b.ws.close(1000, "bye");
    expect(await a.next()).toBe('{"relay":"peer","present":false}');
  });

  it("queues frames for an absent role and delivers them when it connects; a reconnecting sender's old frames are dropped", async () => {
    const ch = ID();
    const a = await open(ch, "a");
    a.ws.send("one");
    a.ws.send("two");
    await new Promise((r) => setTimeout(r, 50));
    const b = await open(ch, "b");
    expect(await b.next(data)).toBe("one");
    expect(await b.next(data)).toBe("two");
    b.ws.close();
    await new Promise((r) => setTimeout(r, 50));
    a.ws.send("stale");
    await new Promise((r) => setTimeout(r, 50));
    // a reconnects (new session): "stale" belonged to the old one.
    const a2 = await open(ch, "a");
    await new Promise((r) => setTimeout(r, 50));
    expect(a.closed()).toBe("replaced");
    a2.ws.send("fresh");
    await new Promise((r) => setTimeout(r, 50));
    const b2 = await open(ch, "b");
    expect(await b2.next(data)).toBe("fresh");
    await new Promise((r) => setTimeout(r, 100));
    expect(b2.got.filter(data)).toEqual([]);
  });

  it("refuses oversized frames", async () => {
    const ch = ID();
    const a = await open(ch, "a");
    a.ws.send("x".repeat(64 * 1024 + 1));
    expect(await a.next((s) => s.includes("error"))).toBe('{"relay":"error","code":"too-large"}');
  });

  it("a whole pairing and encrypted session run through it; the relay only relays", async () => {
    // WebSocket constructor for RelayChannel, backed by the Worker under test.
    class WorkerSocket implements WebSocketLike {
      readyState = 0;
      private ws?: WebSocket;
      private ls: [string, (ev: { data?: unknown; code?: number; reason?: string }) => void][] = [];
      constructor(url: string) {
        const u = new URL(url);
        u.protocol = "https:";
        void worker.fetch(new Request(u.toString(), { headers: { upgrade: "websocket" } })).then((res) => {
          this.ws = res.webSocket!;
          this.ws.addEventListener("message", (e) => this.emit("message", { data: e.data }));
          this.ws.addEventListener("close", (e) => this.emit("close", { code: e.code, reason: e.reason }));
          this.ws.accept();
          this.readyState = 1;
          this.emit("open", {});
        });
      }
      private emit(t: string, ev: { data?: unknown; code?: number; reason?: string }) {
        for (const [k, cb] of this.ls) if (k === t) cb(ev);
      }
      addEventListener(t: "open" | "message" | "close" | "error", cb: (ev: { data?: unknown; code?: number; reason?: string }) => void) {
        this.ls.push([t, cb]);
      }
      send(d: string) {
        this.ws!.send(d);
      }
      close(code?: number, reason?: string) {
        this.ws?.close(code, reason);
      }
    }
    const fixed = (label: string): PairingKeyHandle => {
      const publicKey = sha256(new TextEncoder().encode(`relay-test/${label}`));
      return {
        id: label,
        publicKey,
        async agree(peer, th) {
          const [x, y] = [publicKey, peer].sort((p, q) => (p[0]! - q[0]!) || (p[1]! - q[1]!));
          return sha256(new Uint8Array([...x!, ...y!, ...th]));
        },
        destroy() {},
      };
    };
    const ki = fixed("i");
    const kr = fixed("r");
    const offer = newOffer({ key: ki, purpose: "signer", relay: "https://relay.test", name: "Chrome" });
    const ca = new RelayChannel({ relay: "https://relay.test", channel: offer.channel, role: "a", WebSocket: WorkerSocket as never });
    const cb = new RelayChannel({ relay: "https://relay.test", channel: offer.channel, role: "b", WebSocket: WorkerSocket as never });
    const [pi, pr] = await Promise.all([
      pair({ channel: ca, role: "i", key: ki, ctx: contextFromOffer(offer, "i"), me: { name: "Chrome", platform: "extension" } }),
      pair({ channel: cb, role: "r", key: kr, ctx: contextFromOffer(offer, "r"), me: { name: "Phone", platform: "mobile" } }),
    ]);
    expect(pi.sas).toBe(pr.sas);
    const [x, y] = await Promise.all([pi.confirm(), pr.confirm()]);
    const [sa, sb] = await Promise.all([openSession(ca, x.linkSecret, "i"), openSession(cb, y.linkSecret, "r")]);
    const got = new Promise((r) => sb.onMessage(r));
    sa.send({ t: "request", method: "personal_sign", note: "Sign in to app.example" });
    expect(await got).toEqual({ t: "request", method: "personal_sign", note: "Sign in to app.example" });
  });
});
