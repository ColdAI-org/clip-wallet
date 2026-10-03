import { describe, expect, it, vi } from "vitest";
import { createContentBridge } from "../src/content/index.js";
import { SOURCE_INPAGE } from "../src/shared/protocol.js";
import { newWindow, portPair, tick } from "./helpers.js";

function setup(url = "https://dapp.example/app") {
  const win = newWindow(url);
  const received: any[] = [];
  const toPage: any[] = [];
  let connects = 0;
  const pairs: ReturnType<typeof portPair>[] = [];
  createContentBridge({
    channel: "chan",
    win,
    connect: () => {
      connects++;
      const p = portPair();
      pairs.push(p);
      p.background.onMessage.addListener((m) => received.push(m));
      return p.content;
    },
  });
  win.addEventListener("message", (e: MessageEvent) => {
    if ((e.data as any)?.source === "1mask-content") toPage.push(e.data);
  });
  const req = (over: Record<string, unknown> = {}) => ({
    channel: "chan",
    source: SOURCE_INPAGE,
    type: "request",
    id: "r1",
    family: "evm",
    method: "eth_chainId",
    ...over,
  });
  return { win, received, toPage, pairs, req, connects: () => connects };
}

describe("content bridge security", () => {
  it("forwards a valid same-window request and attaches the origin itself", async () => {
    const s = setup();
    s.win.postMessage(s.req(), "*");
    await vi.waitFor(() =>
      expect(s.received).toEqual([
        { type: "request", id: "r1", origin: "https://dapp.example", family: "evm", method: "eth_chainId" },
      ]),
    );
  });

  it("ignores messages from other windows/frames", async () => {
    const s = setup();
    const other = newWindow("https://evil.example/");
    s.win.dispatchEvent(new (s.win as any).MessageEvent("message", { data: s.req(), source: other, origin: "https://evil.example" }));
    // and a real iframe posting to its parent
    const frame = s.win.document.createElement("iframe");
    s.win.document.body.appendChild(frame);
    s.win.dispatchEvent(new (s.win as any).MessageEvent("message", { data: s.req({ id: "r2" }), source: frame.contentWindow }));
    s.win.dispatchEvent(new (s.win as any).MessageEvent("message", { data: s.req({ id: "r3" }), source: null }));
    await tick(10);
    expect(s.received).toEqual([]);
    expect(s.connects()).toBe(0);
  });

  it("ignores the wrong channel and non-inpage sources", async () => {
    const s = setup();
    s.win.postMessage(s.req({ channel: "other" }), "*");
    s.win.postMessage(s.req({ source: "1mask-content" }), "*");
    s.win.postMessage("hello", "*");
    s.win.postMessage(null, "*");
    await tick(10);
    expect(s.received).toEqual([]);
  });

  it("rejects a page-supplied origin field (strict schema) instead of trusting it", async () => {
    const s = setup();
    s.win.postMessage(s.req({ origin: "https://bank.example" }), "*");
    await vi.waitFor(() => expect(s.toPage[0]).toMatchObject({ type: "response", id: "r1", error: { code: -32602 } }));
    expect(s.received).toEqual([]);
  });

  it("rejects schema-invalid requests (bad family, missing method)", async () => {
    const s = setup();
    s.win.postMessage(s.req({ family: "cosmos" }), "*");
    s.win.postMessage(s.req({ id: "r2", method: "" }), "*");
    await vi.waitFor(() => expect(s.toPage.map((m) => m.error?.code)).toEqual([-32602, -32602]));
    expect(s.received).toEqual([]);
  });

  it("refuses non-http(s) origins", async () => {
    const s = setup("file:///tmp/x.html");
    s.win.postMessage(s.req(), "*");
    await tick(10);
    expect(s.received).toEqual([]);
  });

  it("relays responses only for in-flight ids, and relays events", async () => {
    const s = setup();
    s.win.postMessage(s.req(), "*");
    await vi.waitFor(() => expect(s.pairs.length).toBe(1));
    const bg = s.pairs[0]!.background;
    bg.postMessage({ type: "response", id: "unknown", result: 1 });
    bg.postMessage({ type: "response", id: "r1", result: "0x1" });
    bg.postMessage({ type: "event", family: "evm", event: "chainChanged", data: "0x2" });
    bg.postMessage({ type: "bogus" });
    await vi.waitFor(() => expect(s.toPage.length).toBe(2));
    await tick(10); // nothing else may arrive
    expect(s.toPage).toEqual([
      { channel: "chan", source: "1mask-content", type: "response", id: "r1", result: "0x1" },
      { channel: "chan", source: "1mask-content", type: "event", family: "evm", event: "chainChanged", data: "0x2" },
    ]);
  });

  it("fails in-flight requests with 4900 when the port drops and reconnects lazily", async () => {
    const s = setup();
    s.win.postMessage(s.req(), "*");
    await vi.waitFor(() => expect(s.pairs.length).toBe(1));
    s.pairs[0]!.disconnectFromBackground();
    await vi.waitFor(() => expect(s.toPage[0]).toMatchObject({ id: "r1", error: { code: 4900 } }));
    s.win.postMessage(s.req({ id: "r2" }), "*");
    await vi.waitFor(() => expect(s.connects()).toBe(2));
  });
});
