import { ClipError } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { RouteClient, testnetGraph } from "../src/index.js";
import {
  BASE_SEPOLIA,
  ETH_BASE,
  HBAR,
  HEDERA,
  PORTFOLIO,
  SEPOLIA,
  USDC_HEDERA,
  fixtureDeployments,
  fixtureGraph,
  stubOnlyGraph,
} from "./fixtures.js";

const now = new Date("2026-10-03T00:00:00Z");
const client = (over: ConstructorParameters<typeof RouteClient>[0] = {}) =>
  new RouteClient({ graph: fixtureGraph(), deployments: fixtureDeployments(), nativeAssets: { [BASE_SEPOLIA]: ETH_BASE }, ...over });

async function rejection(p: Promise<unknown>): Promise<ClipError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ClipError);
    return e as ClipError;
  }
  throw new Error("expected a rejection");
}

describe("quote", () => {
  it("returns a plain-language quote for paying HBAR on Hedera from Sepolia ETH", async () => {
    const [q] = await client().quote({ to: HEDERA, asset: HBAR, amount: "2500000000", from: [SEPOLIA], now });
    expect(q).toBeDefined();
    expect(q!.title).toBe("Pay 25 HBAR on Hedera with ETH from Ethereum");
    expect(q!.from).toBe(SEPOLIA);
    // 25 HBAR at $0.10 = $2.50 = 0.00125 ETH at $2000.
    expect(q!.escrow.amount).toBe("1250000000000000");
    expect(q!.escrow.display).toBe("0.00125 ETH");
    expect(BigInt(q!.fee.amount)).toBeGreaterThan(0n);
    expect(q!.fee.asset.symbol).toBe("ETH");
    expect(BigInt(q!.youPay.amount)).toBe(BigInt(q!.escrow.amount) + BigInt(q!.fee.amount));
    expect(q!.time.p90Seconds).toBe(880);
    expect(q!.time.display).toBe("about 15 minutes");
    expect(q!.carbon.display).toMatch(/CO2e/);
    expect(q!.trust).toEqual({ tier: "committee", display: expect.stringContaining("committee") });
    expect(q!.steps.map((s) => s.text)).toEqual([
      expect.stringMatching(/^Send 0\.00\d+ ETH from Ethereum \(includes a 0\.\d+ ETH route fee\)$/),
      "Wait about 15 minutes while Ethereum finalises it and Hedera checks the proof",
      "The app on Hedera is told you paid 25 HBAR; 0.00125 ETH is released to the seller once that is proven",
    ]);
    // The way back uses a stub verifier: allowed on testnet, flagged.
    expect(q!.usesTestVerifier).toBe(true);
    expect(q!.warnings[0]).toMatch(/^Test network only/);
  });

  it("routes from Base Sepolia through Sepolia when the direct Channel is paused", async () => {
    const quotes = await client().quote({ to: HEDERA, asset: HBAR, amount: "100000000", from: [BASE_SEPOLIA], mode: "fastest", now });
    expect(quotes[0]!.route.ledgers).toEqual([BASE_SEPOLIA, SEPOLIA, "eip155:296"]);
    expect(quotes[0]!.steps).toHaveLength(4);
  });

  it("skips sources the user holds nothing on", async () => {
    const quotes = await client().quote({ to: HEDERA, asset: HBAR, amount: "100000000", portfolio: PORTFOLIO, now });
    expect(new Set(quotes.map((q) => q.from))).toEqual(new Set([SEPOLIA]));
  });

  it("refuses routes that rely on a test verifier on mainnet", async () => {
    const mainnet = new RouteClient({ network: "mainnet", graph: fixtureGraph(), deployments: fixtureDeployments(false) });
    const e = await rejection(mainnet.quote({ to: HEDERA, asset: HBAR, amount: "100000000", from: [SEPOLIA], now }));
    expect(e.code).toBe("no-route");
    expect(e.userMessage).toBe("We couldn't find a way to pay HBAR on Hedera from your other balances right now.");
    expect(String(e.cause)).toMatch(/test verifier/);
  });

  it("won't even plan through a stub-verified hop on mainnet", async () => {
    const mainnet = new RouteClient({ network: "mainnet", graph: stubOnlyGraph(), deployments: fixtureDeployments(false) });
    const e = await rejection(mainnet.quote({ to: HEDERA, asset: HBAR, amount: "100000000", from: [SEPOLIA], now }));
    expect(e.code).toBe("no-route");
  });

  it("allows stub-verified hops on testnet, flagged", async () => {
    const [q] = await client({ graph: stubOnlyGraph() }).quote({ to: HEDERA, asset: HBAR, amount: "100000000", from: [SEPOLIA], now });
    expect(q!.usesTestVerifier).toBe(true);
    expect(q!.trust.tier).toBe("attested");
  });

  it("won't build a mainnet client on testnet deployments", () => {
    expect(() => new RouteClient({ network: "mainnet" })).toThrow(ClipError);
  });

  it("refuses non-Hedera destinations in Phase 1", async () => {
    const e = await rejection(client().quote({ to: SEPOLIA, asset: HBAR, amount: "1", now }));
    expect(e.code).toBe("phase1-hedera-only");
  });

  it("needs a price for tokens", async () => {
    const e = await rejection(client().quote({ to: HEDERA, asset: USDC_HEDERA, amount: "1000000", now }));
    expect(e.code).toBe("no-price");
    const [q] = await client({ prices: { usdc: 1 } }).quote({ to: HEDERA, asset: USDC_HEDERA, amount: "1000000", from: [SEPOLIA], now });
    expect(q!.escrow.amount).toBe("500000000000000"); // $1 = 0.0005 ETH
  });

  it("applies filters: no ISO 20022-certified network means no route", async () => {
    const e = await rejection(client().quote({ to: HEDERA, asset: HBAR, amount: "1", filters: { iso20022: true }, now }));
    expect(e.code).toBe("no-route");
  });

  it("on the real testnet graph the Channel isn't open, so quoting needs allowNotYetOpen", async () => {
    const e = await rejection(new RouteClient().quote({ to: HEDERA, asset: HBAR, amount: "100000000", now }));
    expect(e.code).toBe("no-route");
    const [q] = await new RouteClient({ allowNotYetOpen: true }).quote({ to: HEDERA, asset: HBAR, amount: "100000000", now });
    expect(q!.from).toBe(SEPOLIA);
    expect(q!.warnings.join(" ")).toMatch(/isn't open yet/);
    expect(q!.usesTestVerifier).toBe(true);
    expect(q!.estimated).toBe(true);
    expect(testnetGraph().edges.every((e) => e.status === "projected")).toBe(true);
  });
});
