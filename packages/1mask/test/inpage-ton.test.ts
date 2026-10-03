// @vitest-environment jsdom
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { ClipTonConnectBridge, TON_ERRORS, injectTonConnect, toTonError } from "../src/inpage/ton.js";
import { starknetTonAllowlist } from "../src/background/starknet-ton.js";
import { TON_ADDR_ITEM, makeBackground } from "./starknet-ton-harness.js";

const page = () => new JSDOM("", { url: "https://dapp.example/" }).window as unknown as Window;
const FEATURES = [
  { name: "SendTransaction" as const, maxMessages: 255, itemTypes: ["ton" as const, "jetton" as const, "nft" as const] },
  { name: "SignData" as const, types: ["text" as const, "binary" as const, "cell" as const] },
];
const PROOF = { name: "ton_proof", proof: { timestamp: 1, domain: { lengthBytes: 12, value: "dapp.example" }, signature: "c2ln", payload: "n" } };

function setup(o: Parameters<typeof makeBackground>[0] = {}) {
  const bg = makeBackground({ tonAddrItem: async () => TON_ADDR_ITEM, approve: (r) => (r.method === "ton_proof" ? PROOF : r.method === "sendTransaction" ? "te6boc" : { signature: "s" }), ...o });
  const win = page();
  const bridge = new ClipTonConnectBridge(bg.transport, { appName: "clipwallet", appVersion: "0.1.0", features: FEATURES });
  const inj = injectTonConnect(win, "clipwallet", bridge);
  return { bg, win, bridge, inj };
}
const manifestUrl = "https://dapp.example/tonconnect-manifest.json";

describe("TON Connect JS bridge injection", () => {
  it("exposes window.clipwallet.tonconnect with the bridge shape", () => {
    const { win, bridge, inj } = setup();
    expect(inj.injected).toBe(true);
    const tc = (win as any).clipwallet.tonconnect;
    expect(tc).toBe(bridge);
    expect(tc.protocolVersion).toBe(2);
    expect(tc.isWalletBrowser).toBe(false);
    expect(tc.deviceInfo).toEqual({ platform: "browser", appName: "clipwallet", appVersion: "0.1.0", maxProtocolVersion: 2, features: FEATURES });
    for (const f of ["connect", "restoreConnection", "send", "listen"]) expect(typeof tc[f]).toBe("function");
    inj.stop();
    expect((win as any).clipwallet).toBeUndefined();
  });

  it("never overwrites another wallet's key and rejects bad keys", () => {
    const bg = makeBackground();
    const win = page();
    (win as any).tonkeeper = { tonconnect: {} };
    const b = new ClipTonConnectBridge(bg.transport, { appName: "x", appVersion: "1", features: [] });
    expect(injectTonConnect(win, "tonkeeper", b).injected).toBe(false);
    expect(() => injectTonConnect(win, "bad-key", b)).toThrow(/identifier/);
  });
});

describe("connect / restoreConnection", () => {
  it("connect asks once, returns ton_addr + ton_proof, then restores silently", async () => {
    const { bridge, bg } = setup();
    expect((await bridge.restoreConnection())).toMatchObject({ event: "connect_error", payload: { code: TON_ERRORS.UNKNOWN_APP } });
    const ev = await bridge.connect(2, { manifestUrl, items: [{ name: "ton_addr", network: "-3" }, { name: "ton_proof", payload: "n" }] });
    expect(ev.event).toBe("connect");
    if (ev.event !== "connect") throw new Error();
    expect(ev.payload.items).toEqual([TON_ADDR_ITEM, PROOF]);
    expect(ev.payload.device.maxProtocolVersion).toBe(2);
    expect(bg.connects).toEqual([{ family: "ton", method: "tonconnect:connect", params: { manifestUrl, items: expect.any(Array) } }]);
    expect(bg.approvals.map((a) => a.method)).toEqual(["ton_proof"]);
    expect(bg.approvals[0]!.params).toEqual({ payload: "n" });
    const restored = await bridge.restoreConnection();
    expect(restored).toMatchObject({ event: "connect", payload: { items: [TON_ADDR_ITEM] } });
    expect(restored.id).toBeGreaterThan(ev.id);
    // a second connect for an approved site doesn't prompt again
    await bridge.connect(2, { manifestUrl, items: [{ name: "ton_addr" }] });
    expect(bg.connects).toHaveLength(1);
  });

  it("declined connect → connect_error 300; unknown network and old protocol → 1", async () => {
    const declined = setup({ connectOk: false });
    expect(await declined.bridge.connect(2, { manifestUrl, items: [{ name: "ton_addr" }] })).toMatchObject({ event: "connect_error", payload: { code: TON_ERRORS.USER_DECLINED } });
    const { bridge } = setup();
    expect(await bridge.connect(2, { manifestUrl, items: [{ name: "ton_addr", network: "-239" }] })).toMatchObject({ event: "connect_error", payload: { code: TON_ERRORS.BAD_REQUEST } });
    expect(await bridge.connect(1, { manifestUrl, items: [{ name: "ton_addr" }] })).toMatchObject({ event: "connect_error", payload: { code: TON_ERRORS.BAD_REQUEST } });
    expect(await bridge.connect(2, { manifestUrl, items: [] })).toMatchObject({ event: "connect_error", payload: { code: TON_ERRORS.BAD_REQUEST } });
  });

  it("a declined ton_proof undoes a fresh connection", async () => {
    const { bridge, bg } = setup({ approve: () => Promise.reject(Object.assign(new Error("no"), { code: 4001 })) });
    expect(await bridge.connect(2, { manifestUrl, items: [{ name: "ton_addr" }, { name: "ton_proof", payload: "n" }] })).toMatchObject({ event: "connect_error", payload: { code: 300 } });
    expect(bg.perms.has("ton")).toBe(false);
  });

  it("answers unsupported connect items with a per-item 400", async () => {
    const { bridge } = setup();
    const ev = await bridge.connect(2, { manifestUrl, items: [{ name: "ton_addr" }, { name: "ton_magic" } as never] });
    if (ev.event !== "connect") throw new Error();
    expect(ev.payload.items[1]).toEqual({ name: "ton_magic", error: { code: 400, message: "Method not supported." } });
  });
});

describe("send / listen", () => {
  const tx = JSON.stringify({ network: "-3", messages: [{ address: "0QB…", amount: "1" }] });

  it("routes sendTransaction / signData to the approval path and wraps results with the request id", async () => {
    const { bridge, bg } = setup();
    expect(await bridge.send({ method: "sendTransaction", params: [tx], id: "1" })).toEqual({ error: { code: TON_ERRORS.UNKNOWN_APP, message: expect.any(String) }, id: "1" });
    await bridge.connect(2, { manifestUrl, items: [{ name: "ton_addr" }] });
    expect(await bridge.send({ method: "sendTransaction", params: [tx], id: "2" })).toEqual({ result: "te6boc", id: "2" });
    expect(bg.approvals.at(-1)).toMatchObject({ family: "ton", method: "sendTransaction", networkId: "ton:-3", params: [tx] });
    expect(await bridge.send({ method: "signData", params: ['{"type":"text","text":"hi"}'], id: "3" })).toEqual({ result: { signature: "s" }, id: "3" });
  });

  it("enforces increasing request ids and well-formed requests", async () => {
    const { bridge } = setup();
    await bridge.connect(2, { manifestUrl, items: [{ name: "ton_addr" }] });
    await bridge.send({ method: "sendTransaction", params: [tx], id: "5" });
    expect(await bridge.send({ method: "sendTransaction", params: [tx], id: "5" })).toMatchObject({ error: { code: TON_ERRORS.BAD_REQUEST } });
    expect(await bridge.send({ method: "sendTransaction", params: [tx], id: "4" })).toMatchObject({ error: { code: TON_ERRORS.BAD_REQUEST } });
    expect(await bridge.send({ method: "sendTransaction", params: "x" as never, id: "9" })).toMatchObject({ error: { code: TON_ERRORS.BAD_REQUEST } });
    expect(await bridge.send({ method: "mystery", params: [], id: "10" })).toMatchObject({ error: { code: TON_ERRORS.METHOD_NOT_SUPPORTED } });
  });

  it("dApp disconnect revokes quietly; wallet-side disconnect reaches listen() with increasing event ids", async () => {
    const { bridge, bg } = setup();
    const got: { event: string; id: number }[] = [];
    const stop = bridge.listen((e) => got.push(e));
    await bridge.connect(2, { manifestUrl, items: [{ name: "ton_addr" }] });
    expect(await bridge.send({ method: "disconnect", params: [], id: "1" })).toEqual({ result: {}, id: "1" });
    expect(bg.perms.has("ton")).toBe(false);
    expect(got).toEqual([]);
    const ev = await bridge.connect(2, { manifestUrl, items: [{ name: "ton_addr" }] });
    await bg.revoke("ton");
    expect(got).toEqual([{ event: "disconnect", id: ev.id + 1, payload: {} }]);
    stop();
    await bridge.connect(2, { manifestUrl, items: [{ name: "ton_addr" }] });
    await bg.revoke("ton");
    expect(got).toHaveLength(1);
  });

  it("maps router errors to TON Connect codes", () => {
    expect(toTonError({ code: 4001, message: "no" })).toEqual({ code: 300, message: "no" });
    expect(toTonError({ code: 4100, message: "x" }).code).toBe(100);
    expect(toTonError({ code: 4200, message: "x" }).code).toBe(400);
    expect(toTonError({ code: -32602, message: "x" }).code).toBe(1);
    expect(toTonError(new Error("x")).code).toBe(0);
    expect([...starknetTonAllowlist("ton")]).toContain("tonconnect:sendTransaction");
  });
});
