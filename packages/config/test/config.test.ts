import { afterEach, describe, expect, it } from "vitest";
import {
  ConfigError,
  MAINNET_ACKNOWLEDGEMENT,
  NETWORK_FAMILIES,
  WALLETCONNECT_ENV,
  contrastRatio,
  defaults,
  defineConfig,
  enabledFamilies,
  includesEvmChain,
  isMainnetEnabled,
  isPlaceholderRdns,
  mainnetProblems,
  rdnsDomain,
  validateConfig,
  walletKey,
} from "../src/index.js";

const base = { name: "Clip", rdns: "org.coldai.clip" };

function problems(input: unknown): string[] {
  const r = validateConfig(input);
  if (r.ok) throw new Error("expected problems");
  return r.problems;
}

afterEach(() => {
  delete process.env[WALLETCONNECT_ENV];
});

describe("defaults", () => {
  it("fills everything but name and rdns, testnet by default", () => {
    const c = defineConfig(base);
    expect(c).toEqual({
      ...base,
      icon: "./icon.svg",
      extension: {},
      theme: { accent: "#4F46E5", accentText: "#FFFFFF", font: "Inter", radius: 12 },
      networks: ["evm:*", "hedera", "solana", "bitcoin"],
      route: { mode: "balanced", filters: {}, settleOnHedera: false },
      compatibilityMode: false,
      hardware: ["ledger", "keystone"],
      walletConnect: {},
      passkeys: { enabled: true },
      services: {},
      mainnet: false,
    });
    expect(isMainnetEnabled(c)).toBe(false);
    expect(defaults.mainnet).toBe(false);
  });

  it("defaults accentText to white when only the accent changes", () => {
    expect(defineConfig({ ...base, theme: { accent: "#0B7A3B" } }).theme).toEqual({
      accent: "#0B7A3B",
      accentText: "#FFFFFF",
      font: "Inter",
      radius: 12,
    });
  });

  it("reads the WalletConnect project id from the environment", () => {
    process.env[WALLETCONNECT_ENV] = "0123456789abcdef0123456789abcdef";
    expect(defineConfig(base).walletConnect.projectId).toBe("0123456789abcdef0123456789abcdef");
    // An explicit value wins.
    expect(defineConfig({ ...base, walletConnect: { projectId: undefined } }).walletConnect.projectId).toBeUndefined();
  });
});

describe("validation errors in plain words", () => {
  it("requires a name and a reverse-domain rdns", () => {
    expect(problems({})).toEqual(["name: give your wallet a name", "rdns: set rdns to a reverse domain you own, like com.example.wallet"]);
    expect(problems({ name: " ", rdns: "Example.com" })).toEqual([
      "name: give your wallet a name",
      "rdns: use a reverse domain you own, like com.example.wallet (lowercase)",
    ]);
  });

  it("explains bad colours, unreadable contrast and radius", () => {
    expect(problems({ ...base, theme: { accent: "blue" } })).toEqual(["theme.accent: use a hex colour like #4F46E5"]);
    expect(problems({ ...base, theme: { accent: "#FFFF00" } })).toEqual([
      "theme: the accent and its text colour are too close; pick colours with a contrast ratio of at least 3:1 so buttons stay readable",
    ]);
    expect(problems({ ...base, theme: { radius: 99 } })).toEqual(["theme.radius: keep the corner radius at 32 pixels or less"]);
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21);
  });

  it("services are optional https base URLs", () => {
    expect(defineConfig(base).services).toEqual({});
    expect(defineConfig({ ...base, services: { backupUrl: "https://backup.example.com", mediaProxyUrl: "https://example.com/media" } }).services).toEqual({
      backupUrl: "https://backup.example.com",
      mediaProxyUrl: "https://example.com/media",
    });
    expect(problems({ ...base, services: { backupUrl: "http://backup.example.com" } })[0]).toMatch(/^services.backupUrl: use the https base URL/);
    expect(problems({ ...base, services: { mediaProxyUrl: "https://media.example.com/?x=1" } })[0]).toMatch(/^services.mediaProxyUrl:/);
  });

  it("accepts all 14 chain families", () => {
    expect(NETWORK_FAMILIES).toHaveLength(14);
    const all = ["evm:*", ...NETWORK_FAMILIES.filter((f) => f !== "evm")];
    expect(validateConfig({ ...base, networks: all }).ok).toBe(true);
    expect(enabledFamilies(defineConfig({ ...base, networks: all }))).toEqual([...NETWORK_FAMILIES]);
  });

  it("explains network patterns", () => {
    expect(problems({ ...base, networks: ["ethereum"] })).toEqual([
      'networks.0: use "evm:*", "evm:<chain id>", "hedera", "solana", "bitcoin", "sui", "aptos", "cardano", "substrate", "starknet", "ton", "near", "stellar", "tezos" or "algorand"',
    ]);
    expect(problems({ ...base, networks: [] })).toEqual(["networks: turn on at least one network"]);
    expect(problems({ ...base, networks: ["hedera", "hedera"] })).toEqual(["networks: each network is listed once"]);
    const c = defineConfig({ ...base, networks: ["evm:8453", "evm:84532", "hedera"] });
    expect(enabledFamilies(c)).toEqual(["evm", "hedera"]);
    expect(includesEvmChain(c, 8453)).toBe(true);
    expect(includesEvmChain(c, 1)).toBe(false);
  });

  it("explains route settings and unknown keys", () => {
    expect(problems({ ...base, route: { mode: "quickest" } })).toEqual([
      "route.mode: use one of: balanced, cheapest, fastest, reliable, greenest",
    ]);
    expect(problems({ ...base, route: { filters: { trustFloor: "strong", maxHops: 0 } } })).toEqual([
      "route.filters.trustFloor: use one of: attested, committee, light-client, validity-proof",
      "route.filters.maxHops: allow at least one hop",
    ]);
    expect(problems({ ...base, colour: "red" })).toEqual(["colour isn't a setting Clip Wallet knows; check the spelling"]);
  });

  it("explains hardware, WalletConnect and passkeys", () => {
    expect(problems({ ...base, hardware: ["trezor"] })).toEqual(['hardware.0: use "ledger" or "keystone"']);
    expect(problems({ ...base, walletConnect: { projectId: "abc" } })[0]).toMatch(/^walletConnect.projectId: use the 32-character project id .*CLIP_WALLETCONNECT_PROJECT_ID/);
    expect(problems({ ...base, passkeys: { enabled: "yes" } })).toEqual(["passkeys.enabled: use true or false"]);
    expect(problems({ ...base, passkeys: { rpOrigin: "http://wallet.example.com" } })[0]).toMatch(/^passkeys.rpOrigin: use the origin passkeys are bound to/);
  });
});

describe("mainnet", () => {
  it("is off unless the checklist object is given word for word", () => {
    expect(problems({ ...base, mainnet: true })).toEqual([
      "mainnet: Clip Wallet runs on test networks unless you opt in: use mainnet: false, or mainnet: { enabled: true, acknowledged: MAINNET_ACKNOWLEDGEMENT }",
    ]);
    const wrong = problems({ ...base, mainnet: { enabled: true, acknowledged: "yes" } });
    expect(wrong.join("\n")).toMatch(/copy MAINNET_ACKNOWLEDGEMENT from @clip-wallet\/config word for word/);
    const c = defineConfig({ ...base, mainnet: { enabled: true, acknowledged: MAINNET_ACKNOWLEDGEMENT } });
    expect(isMainnetEnabled(c)).toBe(true);
  });

  it("throws a ConfigError listing every problem", () => {
    try {
      defineConfig({ name: "", rdns: "x", mainnet: true } as never);
      throw new Error("expected a ConfigError");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).problems).toHaveLength(3);
      expect((e as Error).message).toMatch(/^clip.config.ts has 3 problems:\n {2}- name: /);
    }
  });
});

describe("identity", () => {
  it("derives the wallet key and the rdns domain", () => {
    expect(walletKey({ name: "Clip Wallet", rdns: "org.coldai.clipwallet" })).toBe("clipwallet");
    expect(walletKey({ name: "Acme Wallet 2", rdns: "com.acme.wallet" })).toBe("acmewallet2");
    expect(walletKey({ name: "Кошелёк", rdns: "com.acme.koshelek" })).toBe("koshelek");
    expect(rdnsDomain("org.coldai.clipwallet")).toBe("coldai.org");
    expect(isPlaceholderRdns("com.example.mywallet")).toBe(true);
    expect(isPlaceholderRdns("com.acme.wallet")).toBe(false);
  });

  it("checks homepage, description and the extension public key", () => {
    expect(problems({ ...base, homepage: "http://acme.example" })[0]).toMatch(/^homepage: use the https address/);
    expect(problems({ ...base, description: "x".repeat(133) })).toEqual(["description: keep the description to 132 characters or fewer"]);
    expect(problems({ ...base, extension: { key: "-----BEGIN PRIVATE KEY-----" } })[0]).toMatch(/^extension.key: use the base64 public key/);
    expect(defineConfig({ ...base, extension: { key: "A".repeat(392) } }).extension.key).toHaveLength(392);
  });
});

describe("mainnet checklist", () => {
  const ack = { enabled: true as const, acknowledged: MAINNET_ACKNOWLEDGEMENT };
  it("lists what a mainnet build still needs, in plain words", () => {
    const c = defineConfig({ name: "Acme", rdns: "com.example.acme", icon: "https://cdn.example/icon.png", mainnet: ack });
    expect(mainnetProblems(c)).toEqual([
      "rdns: com.example.acme is a placeholder; use a reverse domain you own",
      "homepage: set your wallet's https website (WalletConnect and the wallet listings link to it)",
      "extension.key: set the extension's public key so its id stays the same in every store (create-clip-wallet identity writes one)",
      "walletConnect: set CLIP_WALLETCONNECT_PROJECT_ID to your own WalletConnect Cloud project id",
      "icon: ship the icon inside the extension (./icon.svg or ./icon.png), not from a URL",
    ]);
    expect(mainnetProblems(defineConfig({ name: "Acme", rdns: "org.coldai.clipwallet", homepage: "https://acme.example", extension: { key: "A".repeat(392) }, mainnet: ack }), { [WALLETCONNECT_ENV]: "0".repeat(32) })).toEqual([
      "rdns: org.coldai.clipwallet is Clip Wallet's; announce your own reverse domain",
    ]);
    expect(mainnetProblems(defineConfig({ name: "Acme", rdns: "com.acme.wallet", homepage: "https://acme.example", extension: { key: "A".repeat(392) }, walletConnect: { projectId: "0".repeat(32) }, mainnet: ack }))).toEqual([]);
  });
});
