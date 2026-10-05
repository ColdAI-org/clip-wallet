import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError, MAINNET_ACKNOWLEDGEMENT, defineConfig, type ClipConfigInput } from "@clip-wallet/config";
import { CONFIG_MODULE, clipWallet, extensionIdFromKey, readClipEnv, securityFor } from "../src/wxt";

const dirs: string[] = [];
function project(env = ""): string {
  const d = mkdtempSync(join(tmpdir(), "extension-kit-"));
  dirs.push(d);
  writeFileSync(join(d, "package.json"), JSON.stringify({ name: "acme-wallet", version: "1.2.3" }));
  writeFileSync(join(d, "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  if (env) writeFileSync(join(d, ".env"), env);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const publicKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "der" }).toString("base64");
const acme = (extra: Partial<ClipConfigInput> = {}) => defineConfig({ name: "Acme Wallet", rdns: "com.acme.wallet", networks: ["evm:*", "hedera"], ...extra });

type Plugin = { resolveId(id: string): string | undefined; load(id: string): string | undefined };
type ViteShape = { define: Record<string, string>; plugins: Plugin[]; resolve?: { conditions: string[] } };
type Cfg = { manifest(env: { browser: string; manifestVersion: 3 }): Record<string, unknown>; vite(): ViteShape };
/** clipWallet() with the WXT config narrowed to what it sets. */
const wallet = (o: Parameters<typeof clipWallet>[0]) => clipWallet(o) as unknown as Cfg;
function vite(cfg: Cfg) {
  const v = cfg.vite();
  return { ...v, plugin: v.plugins[0]! };
}

describe("clipWallet()", () => {
  it("gives the extension the wallet's own identity", () => {
    const root = project(`# comment\nCLIP_WALLETCONNECT_PROJECT_ID=${"a".repeat(32)}\nOTHER=ignored\n`);
    const cfg = wallet({ config: acme({ extension: { key: publicKey }, homepage: "https://acme.example" }), root, sourceConditions: false });
    const chrome = cfg.manifest({ browser: "chrome", manifestVersion: 3 });
    expect(chrome).toMatchObject({ name: "Acme Wallet", key: publicKey, action: { default_title: "Acme Wallet" } });
    expect(String(chrome.description)).toMatch(/Test networks only\.$/);
    const firefox = cfg.manifest({ browser: "firefox", manifestVersion: 3 });
    expect(firefox.key).toBeUndefined();
    expect(firefox).toMatchObject({ browser_specific_settings: { gecko: { id: "wallet@wallet.acme.com" } } });

    const v = vite(cfg);
    expect(JSON.parse(v.define.__CLIP_IDENTITY__!)).toMatchObject({ name: "Acme Wallet", rdns: "com.acme.wallet" });
    expect(JSON.parse(v.define.__CLIP_IDENTITY__!).icon).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(JSON.parse(v.define.__CLIP_WALLET_KEY__!)).toBe("acmewallet");
    expect(JSON.parse(v.define.__CLIP_TON_CONNECT__!)).toMatchObject({ key: "acmewallet", appName: "acmewallet", appVersion: "1.2.3" });
    expect(JSON.parse(v.define.__CLIP_CHANNEL__!)).toMatch(/^acmewallet-/);
    expect(JSON.parse(v.define.__CLIP_EXTENSION_ID__!)).toBe(extensionIdFromKey(publicKey));
    expect(v.resolve).toBeUndefined();
    // The pages get the resolved config, with the WalletConnect project id from .env.
    expect(v.plugin.resolveId(CONFIG_MODULE)).toBe(`\0${CONFIG_MODULE}`);
    const mod = v.plugin.load(`\0${CONFIG_MODULE}`)!;
    expect(JSON.parse(mod.replace(/^export default /, "").replace(/;$/, ""))).toMatchObject({ name: "Acme Wallet", walletConnect: { projectId: "a".repeat(32) } });
    expect(v.plugin.load(v.plugin.resolveId("crypto")!)).toBe("export default {};");
  });

  it("derives the Chrome extension id from the public key", () => {
    // Chrome's documented example: the id is the first 32 nibbles of sha256(SPKI) in a-p.
    const id = extensionIdFromKey(publicKey);
    expect(id).toMatch(/^[a-p]{32}$/);
    expect(extensionIdFromKey(publicKey)).toBe(id);
  });

  it("always switches the open phishing lists on; Blockaid only with a key", () => {
    const v = vite(wallet({ config: acme(), root: project(), env: { CLIP_BLOCKAID_API_KEY: "" } }));
    expect(JSON.parse(v.define.__CLIP_SECURITY__!)).toEqual({ testnet: true, threat: { openLists: true, refreshHours: 24 } });
    expect(securityFor(acme(), { CLIP_BLOCKAID_API_KEY: "k" }).threat?.blockaid).toEqual({ apiKey: "k" });
  });

  it("refuses a mainnet build until the checklist is done", () => {
    const mainnet = { enabled: true as const, acknowledged: MAINNET_ACKNOWLEDGEMENT };
    expect(() => wallet({ config: acme({ rdns: "com.example.acme", mainnet }), root: project(), env: {} })).toThrow(ConfigError);
    try {
      wallet({ config: acme({ rdns: "com.example.acme", mainnet }), root: project(), env: {} });
    } catch (e) {
      expect((e as ConfigError).problems[0]).toBe("mainnet checklist: rdns: com.example.acme is a placeholder; use a reverse domain you own");
    }
    const ok = wallet({
      config: acme({ mainnet, homepage: "https://acme.example", extension: { key: publicKey } }),
      root: project(),
      env: { CLIP_WALLETCONNECT_PROJECT_ID: "b".repeat(32) },
    });
    expect(JSON.parse(vite(ok).define.__CLIP_SECURITY__!).testnet).toBe(false);
    // A project with MAINNET.md: every box must be ticked too.
    const withList = project();
    writeFileSync(join(withList, "MAINNET.md"), "# Mainnet\n- [x] done\n- [ ] Back up `.keys/extension.pem`\n");
    const ready = { config: acme({ mainnet, homepage: "https://acme.example", extension: { key: publicKey } }), root: withList, env: { CLIP_WALLETCONNECT_PROJECT_ID: "b".repeat(32) } };
    expect(() => wallet(ready)).toThrow(/mainnet checklist: MAINNET.md: Back up .keys\/extension.pem/);
    writeFileSync(join(withList, "MAINNET.md"), "# Mainnet\n- [x] done\n- [x] Back up\n");
    expect(() => wallet(ready)).not.toThrow();
    expect(String(ok.manifest({ browser: "chrome", manifestVersion: 3 }).description)).not.toMatch(/Test networks/);
  });

  it("refuses an icon from someone else's server", () => {
    expect(() => wallet({ config: acme({ icon: "https://cdn.example/icon.png" }), root: project() })).toThrow(/ship the icon with the extension/);
  });

  it("builds the same commit byte for byte: the channel comes from the version and SOURCE_DATE_EPOCH", () => {
    const channel = (env: Record<string, string>) => JSON.parse(vite(wallet({ config: acme(), root: project(), env })).define.__CLIP_CHANNEL__!);
    expect(channel({ SOURCE_DATE_EPOCH: "1700000000" })).toBe(channel({ SOURCE_DATE_EPOCH: "1700000000" }));
    expect(channel({ SOURCE_DATE_EPOCH: "1700000000" })).not.toBe(channel({ SOURCE_DATE_EPOCH: "1700000001" }));
    expect(channel({ SOURCE_DATE_EPOCH: "1700000000" })).toMatch(/^acmewallet-[0-9a-f]{16}$/);
  });

  it("asks for linked devices' permissions (activeTab; nativeMessaging only on demand) and AMO data consent", () => {
    const relay = "https://relay.acme.example";
    const cfg = wallet({ config: acme({ services: { linkRelayUrl: relay } }), root: project() });
    const chrome = cfg.manifest({ browser: "chrome", manifestVersion: 3 });
    expect(chrome.permissions).toContain("activeTab");
    expect(chrome.permissions).not.toContain("nativeMessaging");
    expect(chrome.optional_permissions).toEqual(["notifications", "nativeMessaging"]);
    expect(chrome.host_permissions).toContain(`${relay}/*`);
    const firefox = cfg.manifest({ browser: "firefox", manifestVersion: 3 });
    expect(firefox).toMatchObject({
      browser_specific_settings: { gecko: { strict_min_version: "140.0", data_collection_permissions: { required: ["financialAndPaymentInfo"] } } },
    });
  });

  it("resolves workspace sources only when asked", () => {
    expect(vite(wallet({ config: acme(), root: project(), sourceConditions: true })).resolve?.conditions[0]).toBe("development");
  });

  it("reads only CLIP_* keys from .env", () => {
    const root = project('CLIP_A=1\nCLIP_B="two"\nSECRET=x\n');
    expect(readClipEnv(join(root, ".env"))).toEqual({ CLIP_A: "1", CLIP_B: "two" });
  });
});

describe("manifest description", () => {
  it("says a testnet build is testnet-only, within Chrome's 132 characters", () => {
    const d = (description: string) =>
      String(wallet({ config: acme({ description }), root: project() }).manifest({ browser: "chrome", manifestVersion: 3 }).description);
    expect(d("Acme: a wallet.")).toBe("Acme: a wallet. Test networks only.");
    const long = d("x".repeat(132));
    expect(long).toHaveLength(132);
    expect(long).toMatch(/… Test networks only\.$/);
  });
});
