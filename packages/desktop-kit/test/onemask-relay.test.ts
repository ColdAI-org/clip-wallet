/** Origin binding of 1Mask requests: the origin comes from the browser process's frame, never from the message. */
import { describe, expect, it } from "vitest";
import type { RouterPort } from "@clip-wallet/1mask/background";
import { OneMaskRelay, frameOrigin, type RelayFrame, type RelaySender } from "../src/main/browser/onemask-relay";

function frame(url: string, o: Partial<RelayFrame> = {}): RelayFrame & { sent: unknown[] } {
  const sent: unknown[] = [];
  let origin: string | undefined;
  try {
    origin = new URL(url).origin;
  } catch {
    origin = "null";
  }
  return { url, origin, parent: null, processId: 1, routingId: 1, sent, send: (_c, m) => void sent.push(m), ...o } as RelayFrame & { sent: unknown[] };
}

function setup() {
  const attached: { port: RouterPort; origin: string; got: unknown[]; closed: boolean }[] = [];
  const relay = new OneMaskRelay({
    replyChannel: "reply",
    attach(port, origin) {
      const a = { port, origin, got: [] as unknown[], closed: false };
      port.onMessage.addListener((m) => a.got.push(m));
      port.onDisconnect.addListener(() => (a.closed = true));
      attached.push(a);
    },
  });
  return { relay, attached };
}

const req = (o: Record<string, unknown> = {}) => ({ type: "request", id: "1", origin: "https://app.uniswap.org", family: "evm", method: "eth_accounts", ...o });

describe("frameOrigin", () => {
  it("is the top frame's http(s) origin, agreeing with WebFrameMain.origin", () => {
    const f = frame("https://dapp.example/path?q=1");
    const s: RelaySender = { id: 1, mainFrame: f, isDestroyed: () => false };
    expect(frameOrigin(s, f)).toBe("https://dapp.example");
  });
  it("refuses subframes, opaque origins, non-web schemes and plain http off this computer", () => {
    const top = frame("https://dapp.example/");
    const s: RelaySender = { id: 1, mainFrame: top, isDestroyed: () => false };
    expect(frameOrigin(s, frame("https://evil.example/", { parent: top, routingId: 2 }))).toBeNull();
    expect(frameOrigin(s, frame("https://dapp.example/", { origin: "null" }))).toBeNull();
    const fileTop = frame("file:///tmp/x.html");
    expect(frameOrigin({ ...s, mainFrame: fileTop }, fileTop)).toBeNull();
    const http = frame("http://example.com/");
    expect(frameOrigin({ ...s, mainFrame: http }, http)).toBeNull();
    const local = frame("http://127.0.0.1:8080/");
    expect(frameOrigin({ ...s, mainFrame: local }, local)).toBe("http://127.0.0.1:8080");
  });
});

describe("OneMaskRelay", () => {
  it("overwrites the page's claimed origin with the frame's", () => {
    const { relay, attached } = setup();
    const f = frame("https://dapp.example/");
    const s: RelaySender = { id: 7, mainFrame: f, isDestroyed: () => false };
    expect(relay.onMessage(s, f, req())).toBeNull();
    expect(attached).toHaveLength(1);
    expect(attached[0]!.origin).toBe("https://dapp.example");
    expect(attached[0]!.got[0]).toMatchObject({ origin: "https://dapp.example", method: "eth_accounts" });
  });

  it("drops messages from subframes, bad shapes and oversize payloads", () => {
    const { relay, attached } = setup();
    const top = frame("https://dapp.example/");
    const s: RelaySender = { id: 7, mainFrame: top, isDestroyed: () => false };
    expect(relay.onMessage(s, frame("https://evil.example/", { parent: top, routingId: 9 }), req())).toBe("not-top-frame-or-origin");
    expect(relay.onMessage(s, top, { ...req(), extra: 1 })).toBe("schema");
    expect(relay.onMessage(s, top, req({ params: ["x".repeat(5 * 1024 * 1024)] }))).toBe("too-large");
    expect(relay.onMessage(s, null, req())).toBe("not-top-frame-or-origin");
    expect(attached).toHaveLength(0);
  });

  it("delivers replies only to the same frame while it still shows that origin", () => {
    const { relay, attached } = setup();
    const f = frame("https://dapp.example/");
    const s = { id: 7, mainFrame: f as RelayFrame, isDestroyed: () => false };
    relay.onMessage(s, f, req());
    attached[0]!.port.postMessage({ type: "response", id: "1", result: [] });
    expect(f.sent).toHaveLength(1);
    // The tab committed another origin (as the frame now reports it): the late answer is dropped.
    (f as { url: string }).url = "https://other.example/";
    (f as { origin?: string }).origin = "https://other.example";
    attached[0]!.port.postMessage({ type: "response", id: "2", result: [] });
    expect(f.sent).toHaveLength(1);
  });

  it("closes the port on navigation and opens a fresh one for the next document", () => {
    const { relay, attached } = setup();
    const f = frame("https://dapp.example/");
    const s: RelaySender = { id: 7, mainFrame: f, isDestroyed: () => false };
    relay.onMessage(s, f, req());
    relay.navigated(7);
    expect(attached[0]!.closed).toBe(true);
    attached[0]!.port.postMessage({ type: "response", id: "1", result: [] });
    expect(f.sent).toHaveLength(0);
    relay.onMessage(s, f, req({ id: "2" }));
    expect(attached).toHaveLength(2);
    expect(relay.originOf(7)).toBe("https://dapp.example");
    relay.destroyed(7);
    expect(attached[1]!.closed).toBe(true);
    expect(relay.originOf(7)).toBeNull();
  });

  it("keeps two tabs on two origins apart", () => {
    const { relay, attached } = setup();
    const a = frame("https://a.example/");
    const b = frame("https://b.example/", { processId: 2 });
    relay.onMessage({ id: 1, mainFrame: a, isDestroyed: () => false }, a, req());
    relay.onMessage({ id: 2, mainFrame: b, isDestroyed: () => false }, b, req({ origin: "https://a.example" }));
    expect(attached.map((x) => x.origin)).toEqual(["https://a.example", "https://b.example"]);
    attached[1]!.port.postMessage({ type: "response", id: "1" });
    expect(a.sent).toHaveLength(0);
    expect(b.sent).toHaveLength(1);
  });
});
