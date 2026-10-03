import { describe, expect, it } from "vitest";
import type { Account, ChainContext, DappRequest, DecodedRequest } from "@clip-wallet/core";
import { HEDERA_TESTNET } from "@clip-wallet/chains-hedera";
import { ClipHandlesBackend, type HandleRecords, type HandlesReader } from "@clip-wallet/names";
import { isAddress } from "viem";
import { SocialService, buildHandleRequest, handleCalldata, refineHandleRequest, type Notice } from "../src/index.js";
import { MapKV } from "./helpers.js";

const CONTRACT = { contractId: "0.0.7001234" };
const ME_EVM = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const SOL = "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH";

const account = { id: "hedera:0", family: "hedera", index: 0, address: ME_EVM, publicKey: "02" + "11".repeat(32), derivationPath: "m/44'/3030'/0'/0/0", hederaAccountId: "0.0.5176" } as unknown as Account;
const ctx: ChainContext = { network: HEDERA_TESTNET, account, fetch: globalThis.fetch };

function decodedFor(r: DappRequest): DecodedRequest {
  return {
    requestId: r.id,
    title: `Use contract ${CONTRACT.contractId}`,
    lines: [{ label: "Contract", value: CONTRACT.contractId }, { label: "Function", value: "0x… (unknown)" }],
    balanceChanges: [],
    simulated: false,
    blind: true,
    warnings: [{ level: "danger", code: "blind-signing", message: "can't read" }],
    networkId: r.networkId,
  };
}

describe("handle transactions", () => {
  it("encodes the contract calls", () => {
    expect(handleCalldata({ kind: "register", handle: "alex" }).slice(0, 10)).toBe("0xf2c298be"); // register(string)
    expect(handleCalldata({ kind: "release", recordCount: 1 })).toBe("0x86d1a69f"); // release()
    expect(() => handleCalldata({ kind: "register", handle: "Alex" })).toThrow(/lowercase/);
    expect(() => handleCalldata({ kind: "publish", records: [] })).toThrow();
  });

  it("builds a ContractExecuteTransaction request paid by the user's Hedera account", async () => {
    const r = await buildHandleRequest({ kind: "register", handle: "alex" }, CONTRACT, ctx);
    expect(r).toMatchObject({ family: "hedera", networkId: "hedera:testnet", method: "hedera_signAndExecuteTransaction", origin: "wallet" });
    expect((r.params as { signerAccountId: string }).signerAccountId).toBe("hedera:testnet:0.0.5176");
  });

  it("turns the blind contract call into plain words with the public-record warning", async () => {
    const reg = await buildHandleRequest({ kind: "register", handle: "alex" }, CONTRACT, ctx);
    const d = refineHandleRequest(reg, decodedFor(reg), CONTRACT);
    expect(d).toMatchObject({ blind: false, title: "Claim the handle @alex" });
    expect(d.warnings.map((w) => w.code)).toEqual(["public-record"]);
    expect(d.lines.some((l) => l.label === "Function")).toBe(false);

    const pub = await buildHandleRequest({ kind: "publish", records: [{ family: "evm", address: ME_EVM }, { family: "solana", address: SOL }] }, CONTRACT, ctx);
    const p = refineHandleRequest(pub, decodedFor(pub), CONTRACT);
    expect(p.title).toBe("Publish 2 addresses on your handle");
    expect(p.lines.slice(0, 2)).toEqual([{ label: "Publish (evm)", value: ME_EVM }, { label: "Publish (solana)", value: SOL }]);
    expect(p.warnings[0]!.message).toMatch(/linked to each other/);

    const rel = await buildHandleRequest({ kind: "release", recordCount: 2 }, CONTRACT, ctx);
    expect(refineHandleRequest(rel, decodedFor(rel), CONTRACT).title).toBe("Give up your handle");
  });

  it("only refines calls to the ClipHandles contract (a generic release() elsewhere stays as decoded)", async () => {
    const other = await buildHandleRequest({ kind: "release", recordCount: 1 }, { contractId: "0.0.42" }, ctx);
    const d = decodedFor(other);
    expect(refineHandleRequest(other, d, CONTRACT)).toBe(d);
    expect(refineHandleRequest(other, d, undefined)).toBe(d);
  });
});

describe("SocialService", () => {
  function reader(owned: Record<string, string> = {}, records: Record<string, HandleRecords> = {}): HandlesReader {
    return {
      recordsOf: async (h) => records[h] ?? { owner: "0x0000000000000000000000000000000000000000", registeredAt: 0, updatedAt: 0, families: [], addrs: [] },
      handleOf: async () => "",
      ownedHandle: async (o) => owned[o.toLowerCase()] ?? "",
      isAvailable: async (h) => !records[h],
    };
  }
  function make(opts: { reader?: HandlesReader; contract?: boolean } = {}) {
    const queued: DappRequest[] = [];
    const shown: Notice[] = [];
    const validators = { evm: (a: string) => isAddress(a), solana: (a: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a), hedera: (a: string) => isAddress(a) || /^0\.0\.\d+$/.test(a) };
    const backend = new ClipHandlesBackend({ reader: opts.reader ?? reader(), isAddress: validators });
    const svc = new SocialService({
      kv: new MapKV(),
      validators,
      networks: [HEDERA_TESTNET],
      assets: [{ key: "hbar", symbol: "HBAR", name: "HBAR", decimals: 8, networkId: "hedera:testnet" }],
      ownAddresses: async () => [{ family: "evm", address: ME_EVM }, { family: "solana", address: SOL }],
      hederaCtx: async () => ctx,
      enqueue: async (r) => (queued.push(r), { id: `ap${queued.length}` }),
      handles: { backend, ...(opts.contract === false ? {} : { contract: CONTRACT }) },
      notifier: { show: async (n) => void shown.push(n) },
      snapshot: async () => null,
      locale: () => "en",
      fetch: globalThis.fetch,
      walletName: "Clip Wallet",
      randomId: (() => {
        let i = 0;
        return () => `id${++i}`;
      })(),
    });
    return { svc, queued, shown };
  }

  it("contacts over the bus: save, list with initials, search, address check with look-alikes", async () => {
    const { svc } = make();
    const c = await svc.handle({ type: "socContactSave", input: { name: "alex", addresses: [{ family: "evm", address: ME_EVM }] } });
    expect(c).toMatchObject({ name: "alex", initial: "A" });
    expect((await svc.handle({ type: "socContacts" })).encrypted).toBe(false);
    expect((await svc.handle({ type: "socContactSearch", query: "al", family: "evm" }))[0]!.contact.name).toBe("alex");
    expect(await svc.handle({ type: "socAddressCheck", address: ME_EVM.toLowerCase(), family: "evm" })).toMatchObject({ contact: { contact: { name: "alex" } }, lookalikes: [] });
    const poison = await svc.handle({ type: "socAddressCheck", address: "0x9858000000000000000000000000000000ceDa94", family: "evm" });
    expect(poison.contact).toBeUndefined();
    expect(poison.lookalikes[0]!.contact.name).toBe("alex");
    // Exported lookup for the security stream.
    expect((await svc.lookup().lookalikes("0x9858000000000000000000000000000000ceDa94", "evm")).length).toBe(1);
  });

  it("handle status, claim, publish (own addresses only), reverse and release go to the approval queue", async () => {
    const records = { alex: { owner: ME_EVM, registeredAt: 100, updatedAt: 100, families: ["evm"], addrs: [ME_EVM] } };
    const { svc, queued } = make({ reader: reader({ [ME_EVM.toLowerCase()]: "alex" }, records) });
    const st = await svc.handle({ type: "socHandleStatus" });
    expect(st).toMatchObject({ enabled: true, hederaReady: true, mine: { handle: "alex", records: [{ family: "evm", address: ME_EVM }], reverse: false, registeredAt: 100_000 } });
    expect(st.publishable.map((p) => p.family)).toEqual(["evm", "solana"]);
    expect(await svc.handle({ type: "socHandleCheck", handle: "alex" })).toEqual({ valid: true, available: false });
    expect(await svc.handle({ type: "socHandleCheck", handle: "Bad Handle" })).toEqual({ valid: false, available: false });
    await expect(svc.handle({ type: "socHandleRegister", handle: "alex" })).rejects.toMatchObject({ code: "handles/taken" });
    expect(await svc.handle({ type: "socHandleRegister", handle: "@Sam" })).toEqual({ approvalId: "ap1" });
    await expect(svc.handle({ type: "socHandlePublish", records: [{ family: "evm", address: "0x1234567890AbcdEF1234567890aBcdef12345678" }] })).rejects.toMatchObject({ code: "handles/not-yours" });
    expect(await svc.handle({ type: "socHandlePublish", records: [{ family: "solana", address: SOL }, { family: "evm", address: "" }] })).toEqual({ approvalId: "ap2" });
    expect(await svc.handle({ type: "socHandleReverse", enabled: true })).toEqual({ approvalId: "ap3" });
    expect(await svc.handle({ type: "socHandleRelease" })).toEqual({ approvalId: "ap4" });
    expect(queued.every((r) => r.family === "hedera" && r.origin === "wallet")).toBe(true);
    expect((await svc.handle({ type: "socHandleLookup", input: "alex" }))!.byFamily).toEqual({ evm: ME_EVM });
  });

  it("without a deployed contract, handles say plainly they're off", async () => {
    const { svc } = make({ contract: false });
    expect(await svc.handle({ type: "socHandleStatus" })).toMatchObject({ enabled: false });
    await expect(svc.handle({ type: "socHandleRegister", handle: "alex" })).rejects.toMatchObject({ code: "names/clip-off" });
  });

  it("notification settings, alerts and the test notice", async () => {
    const { svc, shown } = make();
    expect((await svc.handle({ type: "socNotifySettings" })).enabled).toBe(false);
    expect((await svc.handle({ type: "socNotifySet", enabled: true, kinds: { nft: false } })).kinds.nft).toBe(false);
    const a = await svc.handle({ type: "socAlertAdd", assetKey: "hbar", direction: "above", price: 0.5, currency: "USD" });
    expect(a).toMatchObject({ symbol: "HBAR", armed: true });
    await expect(svc.handle({ type: "socAlertAdd", assetKey: "doge", direction: "above", price: 1, currency: "USD" })).rejects.toMatchObject({ code: "alerts/asset" });
    await svc.handle({ type: "socNotifyTest" });
    expect(shown[0]).toMatchObject({ title: "Notifications are on" });
  });
});
