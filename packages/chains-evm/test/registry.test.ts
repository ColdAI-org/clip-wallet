import { isAddress } from "viem";
import { describe, expect, it } from "vitest";
import { EVM_NETWORKS, EVM_NETWORK_SPECS, EVM_TESTNETS } from "../src/networks.js";
import { KNOWN_FUNCTIONS, lookupSelector } from "../src/selectors.js";
import { CURATED_TOKENS, looksLikeSpam } from "../src/tokens.js";

describe("network registry", () => {
  it("has unique CAIP-2 ids derived from chain ids", () => {
    const ids = EVM_NETWORKS.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const n of EVM_NETWORKS) {
      expect(n.id).toBe(`eip155:${n.chainId}`);
      expect(n.family).toBe("evm");
      expect(n.nativeAsset.networkId).toBe(n.id);
    }
  });

  it("covers 59 CLPR EVM networks plus the Sepolia testnets", () => {
    expect(EVM_NETWORKS).toHaveLength(63);
    expect(EVM_TESTNETS.map((n) => n.chainId).sort((a, b) => a! - b!)).toEqual([84532, 421614, 5042002, 11155111, 11155420]);
  });

  it("pins well-known chain ids", () => {
    const by = Object.fromEntries(EVM_NETWORK_SPECS.map((s) => [s.slug, s.chainId]));
    expect(by).toMatchObject({ ethereum: 1, base: 8453, "arbitrum-one": 42161, "op-mainnet": 10, "bnb-smart-chain": 56, "polygon-pos": 137, "avalanche-c-chain": 43114, linea: 59144, scroll: 534352, "zksync-era": 324, monad: 143 });
  });

  it("does not include Hedera (its own module) or non-EVM ledgers", () => {
    const ids = EVM_NETWORKS.map((n) => n.chainId);
    expect(ids).not.toContain(295);
    expect(ids).not.toContain(296);
    expect(ids).not.toContain(123354377739506); // STRATO, SolidVM
  });

  it("keeps Hedera's EVM apart: request-only networks 296/295, HBAR in weibars, specFor knows them", async () => {
    const { HEDERA_EVM_NETWORKS, specFor } = await import("../src/networks.js");
    expect(HEDERA_EVM_NETWORKS.map((n) => [n.id, n.testnet, n.nativeAsset.decimals, n.nativeAsset.key])).toEqual([
      ["eip155:296", true, 18, "hbar"],
      ["eip155:295", false, 18, "hbar"],
    ]);
    expect(HEDERA_EVM_NETWORKS.every((n) => n.family === "evm" && n.rpcUrls[0]!.startsWith("https://") && n.rpcUrls[0]!.endsWith(".hashio.io/api"))).toBe(true);
    expect(specFor("eip155:296")?.evmLayerOf).toBe("hedera");
    expect(EVM_NETWORKS.some((n) => n.chainId === 296 || n.chainId === 295)).toBe(false);
  });

  it("uses public https RPCs without API keys", () => {
    for (const n of EVM_NETWORKS) {
      expect(n.rpcUrls.length).toBeGreaterThan(0);
      for (const u of n.rpcUrls) {
        expect(u.startsWith("https://")).toBe(true);
        expect(u).not.toMatch(/api[-_]?key|apikey|\$\{|[0-9a-f]{32}/i);
      }
      if (n.indexerUrl) expect(n.indexerUrl).toMatch(/^https:\/\/.+\/api\/v2$/);
    }
  });

  it("testnet native ETH never shares the mainnet key", () => {
    for (const n of EVM_TESTNETS) expect(n.nativeAsset.key).not.toBe("eth");
  });
});

describe("curated tokens", () => {
  it("are checksummed, unique and keyed by issuer", () => {
    const seen = new Set<string>();
    for (const t of CURATED_TOKENS) {
      expect(isAddress(t.address, { strict: true })).toBe(true);
      const k = `${t.chainId}:${t.address.toLowerCase()}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
      if (t.key === "usdc.e") expect(t.bridged).toBe(true);
      if (t.key === "usdc") expect(t.bridged).toBeUndefined();
    }
  });
});

describe("spam heuristics", () => {
  it.each([
    ["Visit claim-usdc.com", "x"],
    ["$ Reward", "Airdrop voucher"],
    ["ЕТН", "Ether"], // Cyrillic lookalike
    ["t.me/scam", "x"],
  ])("flags %s", (symbol, name) => expect(looksLikeSpam(symbol, name)).toBe(true));
  it.each([["USDC", "USD Coin"], ["PEPE", "Pepe"], ["WETH", "Wrapped Ether"]])("passes %s", (s, n) => expect(looksLikeSpam(s, n)).toBe(false));
  it("trusts curated and flags Blockscout scam reputation", () => {
    expect(looksLikeSpam("Visit x.com", "x", { curated: true })).toBe(false);
    expect(looksLikeSpam("OK", "Ok", { reputation: "scam" })).toBe(true);
  });
});

describe("selector table", () => {
  it("computes standard selectors", () => {
    expect(lookupSelector("0xd0e30db0")?.action).toBe("Deposit"); // deposit()
    expect(lookupSelector("0x38ed1739")?.action).toBe("Swap tokens"); // swapExactTokensForTokens
    expect(lookupSelector("0xac9650d8")?.action).toBe("Run several actions"); // multicall(bytes[])
    expect(lookupSelector("0x3593564c")?.action).toBe("Swap tokens"); // execute(bytes,bytes[],uint256)
  });
  it("never uses a raw method name as the action", () => {
    for (const k of KNOWN_FUNCTIONS) expect(k.action).not.toMatch(/[a-z][A-Z]|\(|_/);
  });
});
