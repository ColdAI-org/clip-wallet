import { describe, expect, it } from "vitest";
import { defineConfig } from "@clip-wallet/config";
import { createEngineDependencies } from "../src/wiring.js";
import { publicNetworks } from "../src/public-networks.js";
import { FakeVault } from "./fixtures.js";

const config = defineConfig({ name: "Clip Wallet", rdns: "org.coldai.clipwallet", networks: ["evm:*", "hedera", "solana", "bitcoin"], mainnet: false, walletConnect: {} });

describe("createEngineDependencies (real packages)", () => {
  const deps = createEngineDependencies({
    config,
    vault: new FakeVault(),
    hashPayload: (p) => p.bytes,
    currency: async () => "USD",
    walletConnect: { projectId: undefined, url: "https://clipwallet.example", iconUrl: "https://clipwallet.example/icon.png" },
  });

  it("ships testnets only, for the four Phase 1 families", () => {
    expect(deps.networks.length).toBeGreaterThan(3);
    expect(deps.networks.every((n) => n.testnet)).toBe(true);
    expect(new Set(deps.networks.map((n) => n.family))).toEqual(new Set(["evm", "hedera", "solana", "bitcoin"]));
    expect(Object.keys(deps.chains).sort()).toEqual(["bitcoin", "evm", "hedera", "solana"]);
  });

  it("switches WalletConnect off plainly when there is no project id", async () => {
    expect(deps.walletConnect.enabled).toBe(false);
    await expect(deps.walletConnect.pair("wc:x")).rejects.toMatchObject({ code: "walletconnect/no-project-id" });
  });

  it("gives the inpage providers one public RPC per network", () => {
    expect(publicNetworks(deps.networks).every((n) => n.rpcUrls.length <= 1)).toBe(true);
  });
});
