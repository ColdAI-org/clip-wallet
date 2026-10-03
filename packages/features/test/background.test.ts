import { HEDERA_TESTNET } from "@clip-wallet/chains-hedera";
import { CARDANO_PREPROD } from "@clip-wallet/chains-cardano";
import { PASEO_ASSET_HUB } from "@clip-wallet/chains-substrate";
import { NEAR_TESTNET } from "@clip-wallet/chains-near";
import { TEZOS_SHADOWNET } from "@clip-wallet/chains-tezos";
import { SUI_TESTNET } from "@clip-wallet/chains-sui";
import { APTOS_TESTNET } from "@clip-wallet/chains-aptos";
import { TON_TESTNET } from "@clip-wallet/chains-ton";
import { STARKNET_SEPOLIA } from "@clip-wallet/chains-starknet";
import { STELLAR_TESTNET } from "@clip-wallet/chains-stellar";
import { ALGORAND_TESTNET } from "@clip-wallet/chains-algorand";
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

  it("registers staking and swaps for every Phase 2.5 family", async () => {
    const nets = [CARDANO_PREPROD, PASEO_ASSET_HUB, NEAR_TESTNET, TEZOS_SHADOWNET, SUI_TESTNET, APTOS_TESTNET, TON_TESTNET, STARKNET_SEPOLIA, STELLAR_TESTNET, ALGORAND_TESTNET];
    const all = fakeHost({ networks: nets, fetch: mockFetch([]).fetch });
    const svc2 = new FeaturesService(all, { testnet: true });
    const status = await svc2.handle({ type: "featSwapStatus" });
    expect(status.map((s) => s.id).sort()).toEqual(
      ["minswap", "dexhunter", "assethub", "ref-finance", "sirius", "aftermath", "hyperion", "avnu", "stonfi", "stellar-dex", "tinyman"].sort(),
    );
    // Testnet build: mainnet-only and key-only providers say so in plain words; the others are usable.
    const off = Object.fromEntries(status.filter((s) => s.unavailable).map((s) => [s.id, s.unavailable!.message]));
    for (const id of ["assethub", "ref-finance", "hyperion", "stellar-dex", "tinyman"]) expect(off[id]).toBeUndefined();
    for (const id of ["minswap", "sirius", "aftermath", "stonfi", "avnu", "dexhunter"]) expect(off[id]).toMatch(/\.$/);
    for (const m of Object.values(off)) expect(m).not.toMatch(/testnet|preprod|sepolia|shadownet/i);
    const overview = await svc2.handle({ type: "featStakingOverview" });
    expect(overview.map((a) => a.assetKey).sort()).toEqual(["ada", "apt", "gram", "near", "pas", "sui", "xtz"].sort());
    expect(overview.some((a) => a.unavailable?.code === "staking/coming-soon")).toBe(false);
  });

  it("leaves dapp requests' decodes untouched", () => {
    const req = { id: "1", origin: "https://app.example", via: "injected" as const, family: "evm" as const, networkId: "eip155:1", method: "eth_sendTransaction", params: [] };
    const decoded = { requestId: "1", title: "Unreadable request", lines: [], balanceChanges: [], simulated: true, blind: true, warnings: [], networkId: "eip155:1" };
    expect(svc.refine(req, decoded)).toBe(decoded);
  });
});
