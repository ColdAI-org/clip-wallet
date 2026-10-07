import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAINNET_ACKNOWLEDGEMENT, defineConfig } from "@clip-wallet/config";
import { DESKTOP_ICONS, electronBuilderConfig, electronLanguages } from "../src/builder";
import { walletCsp } from "../src/csp";
import { desktopBuildValues } from "../src/electron-vite";
import { stripAppTokens } from "../src/main/browser/browser-ua";

const acme = defineConfig({ name: "Acme Wallet", rdns: "com.acme.wallet", languages: ["en", "de", "pt-BR", "zh-Hans"] });

describe("electronBuilderConfig: clip.config → electron-builder", () => {
  it("names, ids, scheme and icons come from the wallet's config", () => {
    const c = electronBuilderConfig({ config: acme, env: {} });
    expect(c.appId).toBe("com.acme.wallet.desktop");
    expect(c.productName).toBe("Acme Wallet");
    expect(c.extraMetadata).toEqual({ name: "acme-wallet-desktop" });
    expect(c.artifactName).toBe("Acme-Wallet-${version}-${os}-${arch}.${ext}");
    expect(c.protocols).toEqual([{ name: "Acme Wallet", schemes: ["acmewallet"] }]);
    expect(c.linux.executableName).toBe("acme-wallet");
    expect([c.mac.icon, c.win.icon, c.linux.icon]).toEqual([DESKTOP_ICONS.mac, DESKTOP_ICONS.win, DESKTOP_ICONS.linux]);
    expect([c.mac.icon, c.win.icon, c.linux.icon]).toEqual(["build/icon.icns", "build/icon.ico", "build/icons"]);
    expect(c.mac.extendInfo.NSCameraUsageDescription).toMatch(/^Acme Wallet uses the camera/);
    expect(c.linux.synopsis).toMatch(/Test networks only\.$/);
    expect(JSON.stringify(c)).not.toMatch(/Clip Wallet|clipwallet|coldai/i);
  });

  it("app id and scheme overrides, languages, and Chromium locales", () => {
    const c = electronBuilderConfig({ config: defineConfig({ ...acme, appId: "com.example.mywallet", scheme: "acme", desktop: { appId: "com.example.desk" } }), env: {} });
    expect(c.appId).toBe("com.example.desk");
    expect(c.protocols[0]!.schemes).toEqual(["acme"]);
    expect(c.electronLanguages).toEqual(["en", "de", "pt-BR", "pt_BR", "zh-CN", "zh_CN"]);
    expect(electronLanguages(["ja"])).toEqual(["ja", "en"]);
  });

  it("signs, notarizes and publishes only when the environment says so", () => {
    const unsigned = electronBuilderConfig({ config: acme, env: {} });
    expect(unsigned.mac).toMatchObject({ identity: null, notarize: false });
    expect(unsigned.publish).toBeNull();
    const signed = electronBuilderConfig({
      config: acme,
      env: { CSC_LINK: "x.p12", APPLE_API_KEY: "k.p8", APPLE_API_KEY_ID: "id", APPLE_API_ISSUER: "iss", CLIP_UPDATES: "1", CLIP_UPDATES_OWNER: "acme", CLIP_UPDATES_REPO: "wallet" },
    });
    expect(signed.mac).not.toHaveProperty("identity");
    expect(signed.mac.notarize).toBe(true);
    expect(signed.publish).toEqual([{ provider: "github", owner: "acme", repo: "wallet", releaseType: "release" }]);
    // CLIP_UPDATES without a repository publishes nothing (no default owner).
    expect(electronBuilderConfig({ config: acme, env: { CLIP_UPDATES: "1" } }).publish).toBeNull();
  });
});

describe("clipDesktop build values", () => {
  function project(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "clip-desktop-kit-"));
    for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
    return dir;
  }

  it("inlines the icon, applies the WalletConnect id from .env, and writes the pages' CSP", () => {
    const dir = project({ "icon.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>", ".env": "CLIP_WALLETCONNECT_PROJECT_ID=0123456789abcdef0123456789abcdef\nOTHER=x\n" });
    const v = desktopBuildValues({ config: defineConfig({ ...acme, services: { mediaProxyUrl: "https://media.acme.example" } }), root: dir, env: undefined });
    expect(v.icon).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(v.config.walletConnect.projectId).toBe("0123456789abcdef0123456789abcdef");
    expect(v.csp).toBe(walletCsp("https://media.acme.example"));
    expect(v.csp).toContain("img-src 'self' data: blob: https://media.acme.example");
  });

  it("refuses a mainnet build while MAINNET.md has open boxes", () => {
    const dir = project({ "icon.svg": "<svg/>", "MAINNET.md": "- [x] audited\n- [ ] keys in a hardware module\n" });
    const config = defineConfig({
      ...acme,
      homepage: "https://wallet.acme.example",
      extension: { key: "A".repeat(392) },
      walletConnect: { projectId: "0".repeat(32) },
      mainnet: { enabled: true, acknowledged: MAINNET_ACKNOWLEDGEMENT },
    });
    expect(() => desktopBuildValues({ config, root: dir, env: {} })).toThrow(/mainnet checklist: MAINNET\.md: keys in a hardware module/);
  });
});

describe("user agent", () => {
  it("drops Electron's and the app's own tokens", () => {
    const ua = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) acme-wallet-desktop/0.1.0 Chrome/140.0.0.0 Electron/44.5.1 Safari/537.36";
    expect(stripAppTokens(ua, "Acme Wallet")).toBe("Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36");
  });
});
