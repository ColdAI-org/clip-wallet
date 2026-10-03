import { describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6 }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {} }));

const { parseDeepLink } = await import("../src/lib/deeplinks");
const { secureKey, secureVaultStorage } = await import("../src/background/storage");

const WC = `wc:${"a".repeat(64)}@2?relay-protocol=irn&symKey=${"b".repeat(64)}`;
const opts = { scheme: "clipwallet", universalHost: "clipwallet.example" };

describe("deep links", () => {
  it("accepts WalletConnect pairing links", () => {
    expect(parseDeepLink(`clipwallet://wc?uri=${encodeURIComponent(WC)}`, opts)).toEqual({ kind: "wc", uri: WC });
    expect(parseDeepLink(`https://clipwallet.example/wc?uri=${encodeURIComponent(WC)}`, opts)).toEqual({ kind: "wc", uri: WC });
    expect(parseDeepLink(WC, opts)).toEqual({ kind: "wc", uri: WC });
  });
  it("opens dapps in the browser only for http(s) URLs", () => {
    expect(parseDeepLink(`clipwallet://browse?url=${encodeURIComponent("https://app.uniswap.org")}`, opts)).toEqual({ kind: "browse", url: "https://app.uniswap.org" });
    expect(parseDeepLink(`clipwallet://browse?url=${encodeURIComponent("javascript:alert(1)")}`, opts)).toBeNull();
  });
  it("opens Secure Trade offers from the app scheme or the universal link", () => {
    const offer = "eyJ2IjoxfQ";
    expect(parseDeepLink(`clipwallet://trade#offer=${offer}`, opts)).toEqual({ kind: "trade", link: `#offer=${offer}` });
    expect(parseDeepLink(`clipwallet://trade?offer=${offer}`, opts)).toEqual({ kind: "trade", link: `#offer=${offer}` });
    expect(parseDeepLink(`https://clipwallet.example/trade#offer=${offer}`, opts)).toEqual({ kind: "trade", link: `#offer=${offer}` });
    expect(parseDeepLink("clipwallet://trade?offer=<script>", opts)).toBeNull();
    expect(parseDeepLink("clipwallet://trade", opts)).toBeNull();
    expect(parseDeepLink(`https://evil.example/trade#offer=${offer}`, opts)).toBeNull();
  });
  it("ignores everything else", () => {
    expect(parseDeepLink("clipwallet://wc?uri=wc:nope", opts)).toBeNull();
    expect(parseDeepLink(`https://evil.example/wc?uri=${encodeURIComponent(WC)}`, opts)).toBeNull();
    expect(parseDeepLink("otherapp://wc", opts)).toBeNull();
    expect(parseDeepLink(null, opts)).toBeNull();
  });
});

describe("vault storage in the Keychain / Keystore", () => {
  it("maps the vault's key onto SecureStore's allowed characters", async () => {
    expect(secureKey("clip-wallet/vault/v1")).toBe("clip-wallet.vault.v1");
    const m = new Map<string, string>();
    const opts: unknown[] = [];
    const s = secureVaultStorage({
      getItemAsync: async (k, o) => (opts.push(o), m.get(k) ?? null),
      setItemAsync: async (k, v, o) => void (opts.push(o), m.set(k, v)),
      deleteItemAsync: async (k) => void m.delete(k),
    });
    await s.set("clip-wallet/vault/v1", "{}");
    expect(await s.get("clip-wallet/vault/v1")).toBe("{}");
    expect(opts[0]).toMatchObject({ keychainAccessible: 6 });
    await s.remove("clip-wallet/vault/v1");
    expect(await s.get("clip-wallet/vault/v1")).toBeUndefined();
  });
});
