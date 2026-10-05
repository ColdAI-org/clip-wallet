/** The IPC contract: schemas refuse anything off-shape, and only our own top frames may use the wallet channels. */
import { describe, expect, it } from "vitest";
import { ChromeCall, DesktopCall, HidReply, OneMaskFromPage, WalletCall } from "../src/shared/ipc";
import { APP_ORIGIN, isAppSender, type Role } from "../src/main/ipc-guard";

const roles = new Map<number, Role>([
  [1, "wallet"],
  [2, "approval"],
  [3, "chrome"],
]);
const ev = (id: number, url: string, parent: unknown = null, detached = false) => ({ sender: { id }, senderFrame: { url, parent, detached } });

describe("isAppSender", () => {
  it("accepts the top frame of a registered wallet window on the app origin", () => {
    expect(isAppSender(ev(1, `${APP_ORIGIN}/wallet/index.html#/`), roles, ["wallet", "approval"])).toBe(true);
    expect(isAppSender(ev(2, `${APP_ORIGIN}/approval/index.html#abc`), roles, ["wallet", "approval"])).toBe(true);
  });
  it("refuses unknown webContents (a dapp tab), wrong roles, subframes, detached frames and other origins", () => {
    expect(isAppSender(ev(99, `${APP_ORIGIN}/wallet/index.html`), roles, ["wallet"])).toBe(false);
    expect(isAppSender(ev(3, `${APP_ORIGIN}/browser/index.html`), roles, ["wallet", "approval"])).toBe(false);
    expect(isAppSender(ev(1, `${APP_ORIGIN}/wallet/index.html`, {}), roles, ["wallet"])).toBe(false);
    expect(isAppSender(ev(1, `${APP_ORIGIN}/wallet/index.html`, null, true), roles, ["wallet"])).toBe(false);
    expect(isAppSender(ev(1, "https://evil.example/", null), roles, ["wallet"])).toBe(false);
    expect(isAppSender(ev(1, "clip-app://other/wallet/index.html"), roles, ["wallet"])).toBe(false);
    expect(isAppSender(ev(1, "file:///etc/passwd"), roles, ["wallet"])).toBe(false);
    expect(isAppSender({ sender: { id: 1 }, senderFrame: null }, roles, ["wallet"])).toBe(false);
  });
  it("accepts the dev server origin only when one is given", () => {
    expect(isAppSender(ev(1, "http://localhost:5173/wallet/index.html"), roles, ["wallet"])).toBe(false);
    expect(isAppSender(ev(1, "http://localhost:5173/wallet/index.html"), roles, ["wallet"], "http://localhost:5173")).toBe(true);
  });
});

describe("schemas", () => {
  it("wallet calls need a plain message type", () => {
    expect(WalletCall.safeParse({ type: "getState" }).success).toBe(true);
    expect(WalletCall.safeParse({ type: "get State" }).success).toBe(false);
    expect(WalletCall.safeParse({ type: "" }).success).toBe(false);
    expect(WalletCall.safeParse("getState").success).toBe(false);
  });
  it("desktop calls: only http(s) URLs to open, bounded ceremony fields", () => {
    expect(DesktopCall.safeParse({ op: "openBrowser", url: "https://app.example" }).success).toBe(true);
    expect(DesktopCall.safeParse({ op: "openBrowser", url: "file:///etc/hosts" }).success).toBe(false);
    expect(DesktopCall.safeParse({ op: "openExternal", url: "javascript:alert(1)" }).success).toBe(false);
    expect(DesktopCall.safeParse({ op: "bioEnroll", ceremonyId: "c1", prfInput: "not base64url!" }).success).toBe(false);
    expect(DesktopCall.safeParse({ op: "bioEnroll", ceremonyId: "c1", prfInput: "AAAA" }).success).toBe(true);
    expect(DesktopCall.safeParse({ op: "rm -rf" }).success).toBe(false);
  });
  it("browser toolbar calls are bounded", () => {
    expect(ChromeCall.safeParse({ op: "navigate", tabId: 1, input: "app.example" }).success).toBe(true);
    expect(ChromeCall.safeParse({ op: "navigate", tabId: 0, input: "x" }).success).toBe(false);
    expect(ChromeCall.safeParse({ op: "answer", promptId: "p1", choice: "always" }).success).toBe(false);
  });
  it("hid replies carry hex only", () => {
    expect(HidReply.safeParse({ id: "h1", ok: true, data: "9000" }).success).toBe(true);
    expect(HidReply.safeParse({ id: "h1", ok: true, data: "zz" }).success).toBe(false);
  });
  it("1Mask requests from the preload are strict (no extra fields)", () => {
    const base = { type: "request", id: "1", origin: "https://a.example", family: "evm", method: "eth_accounts" };
    expect(OneMaskFromPage.safeParse(base).success).toBe(true);
    expect(OneMaskFromPage.safeParse({ ...base, sender: "x" }).success).toBe(false);
  });
});
