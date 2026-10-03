import { describe, expect, it } from "vitest";
import { WalletEngine } from "../src/engine.js";
import { MemoryKV } from "../src/kv.js";
import { EngineHardware, createEngineHardwareClient } from "../src/hardware.js";
import { EVM_ADDRESS, FakeVault, SEPOLIA, fakePort, makeDeps, makeEnv, tick } from "./fixtures.js";
import { HW_ADDRESS, fakeHardwareDeps } from "./hardware-fixtures.js";

const ORIGIN = "https://dapp.test";
const PW = "a long test password";

async function setup() {
  const vault = new FakeVault();
  const deps = makeDeps(vault);
  const env = makeEnv();
  const kv = new MemoryKV();
  const engine = new WalletEngine(deps, kv, env);
  engine.start();
  const fake = fakeHardwareDeps(kv, () => env.broadcast());
  const hw = new EngineHardware(fake.deps);
  engine.attachHardware(hw);
  await engine.handle({ type: "createWallet", password: PW });
  return { engine, vault, env, kv, hw, client: createEngineHardwareClient(hw), keyring: fake.keyring, bridge: fake.bridge, releaseLedger: fake.releaseLedger };
}

describe("WalletEngine + hardware accounts", () => {
  it("adding a hardware account makes it the wallet's account for that family", async () => {
    const { engine, client } = await setup();
    expect(engine.cachedAccount("evm")?.address).toBe(EVM_ADDRESS);
    const found = await client.ledgerAccounts("evm", 0, 2);
    expect(found.map((a) => a.address)).toEqual([HW_ADDRESS, HW_ADDRESS]);
    await client.addAccounts([found[1]!.id]);
    expect(engine.cachedAccount("evm")?.id).toBe(found[1]!.id);
    const listed = await client.listAccounts();
    expect(listed).toMatchObject([{ id: found[1]!.id, active: true, hardware: { kind: "ledger", deviceName: "Nano X" } }]);
    // Back to the recovery-phrase account.
    await client.setActive("evm", null);
    expect(engine.cachedAccount("evm")?.address).toBe(EVM_ADDRESS);
  });

  it("refuses ids it never showed, and every call while locked", async () => {
    const { engine, client } = await setup();
    await expect(client.addAccounts(["hw:ledger:0a1b2c3d:evm:7"])).rejects.toMatchObject({ code: "hw/unknown-account" });
    await expect(client.addAccounts(["evm:0"])).rejects.toMatchObject({ code: "bus/invalid" });
    await engine.handle({ type: "lock" });
    await expect(client.listAccounts()).rejects.toMatchObject({ code: "vault/locked" });
  });

  it("routes signing to the Ledger, shows the device step meanwhile, and never asks the vault", async () => {
    const { engine, vault, client, keyring, releaseLedger } = await setup();
    const [first] = await client.ledgerAccounts("evm", 0, 1);
    await client.addAccounts([first!.id]);
    await engine.permissions.grant(ORIGIN, "evm");
    const { port, send } = fakePort();
    engine.attachDappPort(port, ORIGIN);
    const reply = send(ORIGIN, "personal_sign", ["0x68656c6c6f", HW_ADDRESS]);
    await tick();
    await tick();
    const [pending] = await engine.handle({ type: "listApprovals" });
    const approving = engine.handle({ type: "approve", id: pending!.id });
    await tick();
    await tick();
    expect((await engine.handle({ type: "getApproval", id: pending!.id }))?.hardware).toEqual({ kind: "ledger", stage: "confirm", app: "Ethereum" });
    releaseLedger();
    await approving;
    expect((await reply).result).toBe(`0x${"07".repeat(64)}1c`);
    expect(vault.signed).toHaveLength(0);
    expect(keyring.registered.size).toBe(1);
  });

  it("shows a Keystone exchange through getApproval and finishes on the scanned answer", async () => {
    const { engine, client } = await setup();
    await client.keystoneImport({ type: "crypto-multi-accounts", cborHex: "a0" }).then((r) => expect(r.families).toEqual(["evm", "bitcoin"]));
    const [k] = await client.keystoneAccounts("evm", 0, 1);
    await client.addAccounts([k!.id]);
    const id = await engine.handle({ type: "send", assetKey: "eth", networkId: SEPOLIA.id, to: "0x000000000000000000000000000000000000dEaD", amount: "0.1" });
    const approving = engine.handle({ type: "approve", id });
    await tick();
    await tick();
    const view = await engine.handle({ type: "getApproval", id });
    expect(view?.hardware).toEqual({ kind: "keystone", stage: "exchange", request: { type: "eth-sign-request", cborHex: "a1016161", expect: ["eth-signature"] } });
    await expect(client.keystoneAnswer(id, { type: "crypto-psbt", cborHex: "00" })).rejects.toMatchObject({ code: "hw/wrong-qr" });
    await client.keystoneAnswer(id, { type: "eth-signature", cborHex: "a1" });
    await approving;
    expect(await engine.handle({ type: "getApproval", id })).toBeNull();
  });

  it("cancel fails the approval plainly and locking cancels open exchanges", async () => {
    const { engine, client, keyring } = await setup();
    await client.keystoneImport({ type: "crypto-multi-accounts", cborHex: "a0" });
    const [k] = await client.keystoneAccounts("evm", 0, 1);
    await client.addAccounts([k!.id]);
    const id = await engine.handle({ type: "send", assetKey: "eth", networkId: SEPOLIA.id, to: "0x000000000000000000000000000000000000dEaD", amount: "0.1" });
    const approving = engine.handle({ type: "approve", id });
    await tick();
    await client.hardwareCancel(id);
    await expect(approving).rejects.toMatchObject({ code: "hw/cancelled" });
    // The request is still waiting; approving again re-registers it.
    expect(await engine.handle({ type: "getApproval", id })).not.toBeNull();
    await engine.handle({ type: "lock" });
    expect(keyring.locked).toBe(1);
  });
});
