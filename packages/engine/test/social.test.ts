/** Social stream wiring in the engine: Clip-handle recipients, the approval's recipient, social messages and lock. */
import { describe, expect, it } from "vitest";
import { WalletEngine } from "../src/engine.js";
import { MemoryKV } from "../src/kv.js";
import { createSocial } from "../src/social.js";
import { createEngineSocialClient } from "../src/client.js";
import { BASE_SEPOLIA, FakeVault, SEPOLIA, makeDeps, makeEnv } from "./fixtures.js";

const ALEX = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";

async function setup() {
  const deps = makeDeps(new FakeVault());
  // A name resolver that knows one Clip handle publishing an EVM and a Solana address.
  deps.names = {
    resolve: async (name: string) =>
      name.toLowerCase() === "@alex" ? { address: ALEX, displayName: "@alex", networkIds: [], byFamily: { evm: ALEX, solana: "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH" } } : null,
  };
  const kv = new MemoryKV();
  const engine = new WalletEngine(deps, kv, makeEnv());
  engine.start();
  const shown: string[] = [];
  const social = createSocial({
    networks: deps.networks,
    assets: deps.assets,
    chains: deps.chains,
    kv,
    ctx: (id) => engine.featureCtx(id),
    enqueue: async (r, app) => ({ id: (await engine.enqueueWalletRequest(r, app)).id }),
    approvals: async () => engine.socialApprovals(),
    prices: deps.prices,
    notifier: { show: async (n) => void shown.push(n.title) },
    deviceLanguages: () => ["en"],
    walletName: "Clip Wallet",
    fetch: (async () => new Response("{}", { status: 503 })) as typeof fetch,
  });
  engine.attachSocial(social);
  await engine.handle({ type: "createWallet", password: "a long test password" });
  return { engine, social, shown, kv };
}

describe("engine + social", () => {
  it("pays a Clip handle at the address it publishes for the asset's family", async () => {
    const { engine } = await setup();
    await engine.handle({ type: "rememberRecipientNetwork", address: ALEX, assetKey: "eth", networkId: SEPOLIA.id });
    expect(await engine.handle({ type: "resolveRecipient", input: "@alex", assetKey: "eth" })).toMatchObject({ kind: "resolved", address: ALEX, displayName: "@alex", networkId: SEPOLIA.id });
  });

  it("wallet sends carry the recipient to the approval (for 'Send to Alex')", async () => {
    const { engine } = await setup();
    const id = await engine.handle({ type: "send", assetKey: "eth", networkId: BASE_SEPOLIA.id, to: "@alex", amount: "0.1" });
    const view = await engine.handle({ type: "getApproval", id });
    expect(view?.recipient).toEqual({ address: ALEX, family: "evm" });
    expect(engine.socialApprovals()).toEqual([{ id, app: "Clip Wallet", title: "Send 0.1 ETH" }]);
  });

  it("routes social messages; contacts need the vault unlocked, notification settings don't", async () => {
    const { engine } = await setup();
    const client = createEngineSocialClient(engine);
    await client.saveContact({ input: { name: "Alex", addresses: [{ family: "evm", address: ALEX }] } });
    expect((await client.checkAddress({ address: ALEX.toLowerCase(), family: "evm" })).contact?.contact.name).toBe("Alex");
    await engine.handle({ type: "lock" });
    await expect(client.contacts()).rejects.toMatchObject({ code: "vault/locked" });
    expect((await client.notificationSettings()).enabled).toBe(false);
    await expect(engine.handleUntrusted({ type: "socNotifySet", kinds: { spam: true } })).rejects.toMatchObject({ code: "bus/invalid" });
  });

  it("polls public data while locked (cached accounts) once notifications are on", async () => {
    const { engine, social, shown } = await setup();
    await createEngineSocialClient(engine).setNotifications({ enabled: true });
    await engine.handle({ type: "lock" });
    expect(await social.poll()).toEqual([]); // baseline
    await createEngineSocialClient(engine).testNotification();
    expect(shown).toEqual(["Notifications are on"]);
  });
});
