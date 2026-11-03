import { HEDERA_TESTNET } from "@coldai/clip-wallet-chains-hedera";
import { CARDANO_PREPROD } from "@coldai/clip-wallet-chains-cardano";
import { PASEO_ASSET_HUB } from "@coldai/clip-wallet-chains-substrate";
import { NEAR_TESTNET } from "@coldai/clip-wallet-chains-near";
import { TEZOS_SHADOWNET } from "@coldai/clip-wallet-chains-tezos";
import { SUI_TESTNET } from "@coldai/clip-wallet-chains-sui";
import { APTOS_TESTNET } from "@coldai/clip-wallet-chains-aptos";
import { TON_TESTNET } from "@coldai/clip-wallet-chains-ton";
import { STARKNET_SEPOLIA } from "@coldai/clip-wallet-chains-starknet";
import { STELLAR_TESTNET } from "@coldai/clip-wallet-chains-stellar";
import { ALGORAND_TESTNET } from "@coldai/clip-wallet-chains-algorand";
import { describe, expect, it } from "vitest";
import { FeaturesService } from "../src/background.js";
import type { FeaturesConfig } from "../src/host.js";
import { FeatureRequest } from "../src/messages.js";
import { BASE_MAINNET, DEVNET, fakeHost, hbar, mockFetch, sol } from "./helpers.js";

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

  it("offers SODAX only in a mainnet build that sets it up", async () => {
    // Clearly fake: nobody holds this address.
    const sodax = { serverUrl: "https://exclip.test", feeReceiver: "0x00000000000000000000000000000000000fee01", walletName: "Test Wallet" };
    const main = fakeHost({ networks: [BASE_MAINNET], fetch: mockFetch([]).fetch });
    const status = (config: FeaturesConfig) => new FeaturesService(main, config).handle({ type: "featSwapStatus" });
    expect((await status({ testnet: false })).map((s) => s.id)).not.toContain("sodax");
    expect((await status({ testnet: true, swap: { sodax } })).map((s) => s.id)).not.toContain("sodax");
    // Set up in a mainnet build, it still stays off while its receiver isn't on the reviewed list.
    const off = (await status({ testnet: false, swap: { sodax } })).find((s) => s.id === "sodax");
    expect(off?.unavailable?.code).toBe("swap/fee-receiver-not-allowed");
    // ColdAI LLC's address is on it.
    const on = (await status({ testnet: false, swap: { sodax: { ...sodax, feeReceiver: "0x90291104f2D1ef9Ffe2Bc1635A3a270A09C8f313" } } })).find((s) => s.id === "sodax");
    expect(on).toMatchObject({ id: "sodax", name: "SODAX" });
    expect(on?.unavailable).toBeUndefined();
  });

  it("leaves dapp requests' decodes untouched", () => {
    const req = { id: "1", origin: "https://app.example", via: "injected" as const, family: "evm" as const, networkId: "eip155:1", method: "eth_sendTransaction", params: [] };
    const decoded = { requestId: "1", title: "Unreadable request", lines: [], balanceChanges: [], simulated: true, blind: true, warnings: [], networkId: "eip155:1" };
    expect(svc.refine(req, decoded)).toBe(decoded);
  });
});
