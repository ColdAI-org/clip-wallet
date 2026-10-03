// @vitest-environment jsdom
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { ClipTonConnectBridge, injectTonConnect } from "../src/inpage/ton.js";
import { exposeOnGlobal } from "../src/inpage/injected-base.js";
import { resolveIdentity } from "../src/shared/config.js";
import { makeBackground } from "./starknet-ton-harness.js";

const page = () => new JSDOM("", { url: "https://dapp.example/" }).window as unknown as Window;
const identity = resolveIdentity();

describe("window.clipwallet is shared by TON Connect and the NEAR/Stellar/Algorand providers", () => {
  const bridge = () => new ClipTonConnectBridge(makeBackground().transport, { appName: "clipwallet", appVersion: "0.1.0", features: [] });

  it("TON first, then a family provider", () => {
    const win = page();
    const b = bridge();
    const ton = injectTonConnect(win, "clipwallet", b);
    const near = {};
    exposeOnGlobal(win, "clipwallet", "near", near, identity);
    const root = (win as any).clipwallet;
    expect(ton.injected).toBe(true);
    expect(root.tonconnect).toBe(b);
    expect(root.near).toBe(near);
    expect(root.info.rdns).toBe(identity.rdns);
    ton.stop();
    expect((win as any).clipwallet.near).toBe(near);
    expect((win as any).clipwallet.tonconnect).toBeUndefined();
  });

  it("a family provider first, then TON", () => {
    const win = page();
    const near = {};
    exposeOnGlobal(win, "clipwallet", "near", near, identity);
    const b = bridge();
    expect(injectTonConnect(win, "clipwallet", b).injected).toBe(true);
    expect((win as any).clipwallet.tonconnect).toBe(b);
    expect((win as any).clipwallet.near).toBe(near);
  });

  it("still refuses another wallet's global", () => {
    const win = page();
    (win as any).clipwallet = { someoneElse: true };
    expect(injectTonConnect(win, "clipwallet", bridge()).injected).toBe(false);
    expect((win as any).clipwallet.tonconnect).toBeUndefined();
  });
});
