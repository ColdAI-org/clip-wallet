import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { displayHost, isNavigable, normalizeInput, partitionFor, promptFor, webOrigin } from "../src/main/browser/url-policy";
import { resolveAppPath, walletCsp } from "../src/main/app-paths";
import { deepLinkFromArgv, parseDeepLink } from "../src/main/deeplink";

describe("url policy", () => {
  it("only https, and http for this computer / LAN", () => {
    expect(webOrigin("https://app.example/x")).toBe("https://app.example");
    expect(webOrigin("http://localhost:3000/")).toBe("http://localhost:3000");
    expect(webOrigin("http://192.168.1.4/")).toBe("http://192.168.1.4");
    for (const u of ["http://example.com/", "file:///etc/hosts", "javascript:alert(1)", "data:text/html,x", "clip-app://wallet/wallet/index.html", "chrome://settings", "https://user:pw@app.example/", "about:blank", "blob:https://a/x"])
      expect(isNavigable(u), u).toBe(false);
  });
  it("address bar input becomes a URL, never a search", () => {
    expect(normalizeInput("app.example")).toBe("https://app.example/");
    expect(normalizeInput("app.example/swap?x=1")).toBe("https://app.example/swap?x=1");
    expect(normalizeInput("localhost:5173")).toBe("http://localhost:5173/");
    expect(normalizeInput("https://app.example")).toBe("https://app.example/");
    expect(normalizeInput("buy eth")).toBeNull();
    expect(normalizeInput("hello")).toBeNull();
    expect(normalizeInput("javascript:alert(1)")).toBeNull();
    expect(normalizeInput("http://example.com")).toBeNull();
  });
  it("one deterministic session per origin", () => {
    expect(partitionFor("https://a.example")).toBe(partitionFor("https://a.example"));
    expect(partitionFor("https://a.example")).not.toBe(partitionFor("https://b.example"));
    expect(partitionFor("https://a.example")).not.toBe(partitionFor("http://a.example"));
    expect(partitionFor("https://a.example")).toMatch(/^persist:site-[0-9a-f]{32}$/);
    expect(displayHost("https://www.app.example")).toBe("app.example");
  });
  it("permission prompts: a few kinds ask, the rest are denied", () => {
    expect(promptFor("media", ["video"])).toBe("camera");
    expect(promptFor("media", ["audio"])).toBe("microphone");
    expect(promptFor("notifications")).toBe("notifications");
    for (const p of ["hid", "usb", "serial", "midi", "midiSysex", "pointerLock", "fullscreen", "openExternal", "unknown"]) expect(promptFor(p), p).toBeNull();
  });
});

describe("clip-app protocol", () => {
  it("serves only files inside the bundle", () => {
    // In the platform's own path form, as the app passes it (backslashes on Windows).
    const root = join(sep, "app", "out", "renderer");
    expect(resolveAppPath(root, "clip-app://wallet/wallet/index.html")).toBe(join(root, "wallet", "index.html"));
    expect(resolveAppPath(root, "clip-app://wallet/../../../etc/passwd")).toBe(join(root, "etc", "passwd"));
    expect(resolveAppPath(root, "clip-app://wallet/..%2F..%2Fsecret")).toBeNull();
    expect(resolveAppPath(root, "clip-app://wallet/%2e%2e/%2e%2e/secret")).toBe(join(root, "secret"));
    expect(resolveAppPath(root, "clip-app://other/wallet/index.html")).toBeNull();
    expect(resolveAppPath(root, "https://wallet/index.html")).toBeNull();
  });
  it("CSP: no remote script, no eval, no frames; images only from the media proxy", () => {
    const csp = walletCsp("https://media.example/v1");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/unsafe-eval/);
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("img-src 'self' data: blob: https://media.example");
    expect(csp).toContain("connect-src 'self'");
  });
});

describe("deep links", () => {
  const wc = `wc:${"a".repeat(64)}@2?relay-protocol=irn&symKey=${"b".repeat(64)}`;
  it("parses the supported links and ignores the rest", () => {
    expect(parseDeepLink(`clipwallet://wc?uri=${encodeURIComponent(wc)}`)).toEqual({ kind: "wc", uri: wc });
    expect(parseDeepLink(wc)).toEqual({ kind: "wc", uri: wc });
    expect(parseDeepLink("clipwallet://browse?url=https%3A%2F%2Fapp.example%2F")).toEqual({ kind: "browse", url: "https://app.example/" });
    expect(parseDeepLink("clipwallet://browse?url=file%3A%2F%2F%2Fetc%2Fhosts")).toBeNull();
    expect(parseDeepLink("clipwallet://trade#offer=abc_DEF-1")).toEqual({ kind: "trade", route: `/trade/open?link=${encodeURIComponent("#offer=abc_DEF-1")}` });
    expect(parseDeepLink("clipwallet://wc?uri=wc%3Anope")).toBeNull();
    expect(parseDeepLink("https://evil.example/wc?uri=x")).toBeNull();
    expect(parseDeepLink("clipwallet://reveal-phrase")).toBeNull();
    expect(deepLinkFromArgv(["/Applications/Clip.app", "--flag", "clipwallet://browse?url=x"])).toBe("clipwallet://browse?url=x");
  });
});
