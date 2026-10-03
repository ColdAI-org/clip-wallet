import { HEDERA_TESTNET } from "@clip-wallet/chains-hedera";
import { describe, expect, it } from "vitest";
import { FeaturesService } from "../src/background.js";
import { FeatureRequest } from "../src/messages.js";
import { DEVNET, fakeHost, hbar, mockFetch, sol } from "./helpers.js";

describe("FeaturesService (bus entry)", () => {
  const host = fakeHost({ networks: [HEDERA_TESTNET, DEVNET], assets: [hbar(), sol(DEVNET.id)], fetch: mockFetch([]).fetch });
  const svc = new FeaturesService(host, { testnet: true });

  it("routes validated messages to the right service", async () => {
    const featured = await svc.handle(FeatureRequest.parse({ type: "featFeatured" }) as { type: "featFeatured" });
    expect(new Set(featured.map((d) => d.family))).toEqual(new Set(["hedera", "solana"]));
    const status = await svc.handle({ type: "featSwapStatus" });
    expect(status.map((s) => s.id)).toEqual(["saucerswap", "jupiter"]);
    // No partner keys in a test build: buying is plainly off.
    expect(await svc.handle({ type: "featBuyAssets" })).toEqual([]);
    expect(await svc.handle({ type: "featTradeList" })).toEqual([]);
  });

  it("leaves dapp requests' decodes untouched", () => {
    const req = { id: "1", origin: "https://app.example", via: "injected" as const, family: "evm" as const, networkId: "eip155:1", method: "eth_sendTransaction", params: [] };
    const decoded = { requestId: "1", title: "Unreadable request", lines: [], balanceChanges: [], simulated: true, blind: true, warnings: [], networkId: "eip155:1" };
    expect(svc.refine(req, decoded)).toBe(decoded);
  });
});
