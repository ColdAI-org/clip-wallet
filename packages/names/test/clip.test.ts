import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isAddress } from "viem";
import type { Network } from "@clip-wallet/core";
import { CLIP_HANDLES_ABI, ClipHandlesBackend, MultiNameResolver, isValidHandle, looksLikeName, parseHandle, type HandleRecords, type HandlesReader } from "../src/index.js";

const ALICE = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const SOL = "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH";
const NOW = 1_790_000_000_000;

const isAddr = {
  evm: (a: string) => isAddress(a),
  hedera: (a: string) => /^0\.0\.\d+$/.test(a) || isAddress(a),
  solana: (a: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a),
};

function reader(records: Record<string, HandleRecords>, reverse: Record<string, string> = {}): HandlesReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async recordsOf(h) {
      calls.push(h);
      return records[h] ?? { owner: "0x0000000000000000000000000000000000000000", registeredAt: 0, updatedAt: 0, families: [], addrs: [] };
    },
    async handleOf(owner) {
      return reverse[owner.toLowerCase()] ?? "";
    },
  };
}

const alex: HandleRecords = { owner: ALICE, registeredAt: NOW / 1000 - 90 * 86400, updatedAt: NOW / 1000 - 86400, families: ["solana", "evm", "bitcoin"], addrs: [SOL, ALICE, "bc1qnotchecked"] };

describe("handle syntax", () => {
  it("matches the contract's rule", () => {
    expect(isValidHandle("alex")).toBe(true);
    expect(isValidHandle("a-b-c")).toBe(true);
    expect(isValidHandle("ab")).toBe(false);
    expect(isValidHandle("al--ex")).toBe(false);
    expect(isValidHandle("-alex")).toBe(false);
    expect(isValidHandle("alex-")).toBe(false);
    expect(isValidHandle("аlex")).toBe(false); // Cyrillic а
    expect(isValidHandle("x".repeat(32))).toBe(true);
    expect(isValidHandle("x".repeat(33))).toBe(false);
  });
  it("parses @handle and handle.clip, case-insensitively", () => {
    expect(parseHandle("@Alex")).toBe("alex");
    expect(parseHandle(" alex.CLIP ")).toBe("alex");
    expect(parseHandle("@al ex")).toBeNull();
    expect(parseHandle("alex.eth")).toBeNull();
    expect(looksLikeName("@alex")).toBe(true);
    expect(looksLikeName("alex.clip")).toBe(true);
  });
});

describe("ClipHandlesBackend", () => {
  it("returns every valid published address, EVM first, dropping families without a check", async () => {
    const b = new ClipHandlesBackend({ reader: reader({ alex }), isAddress: isAddr, now: () => NOW });
    const r = await b.resolve("@Alex");
    expect(r).toMatchObject({ name: "@alex", displayName: "@alex", service: "clip", address: ALICE, family: "evm", networkIds: [] });
    expect(r!.byFamily).toEqual({ evm: ALICE, solana: SOL });
    expect(r!.handle).toMatchObject({ owner: ALICE, recentlyRegistered: false });
  });

  it("drops records that fail the family's address check", async () => {
    const bad: HandleRecords = { ...alex, families: ["evm", "solana"], addrs: ["0x12", SOL] };
    const r = await new ClipHandlesBackend({ reader: reader({ bad }), isAddress: isAddr }).resolve("@bad");
    expect(r!.byFamily).toEqual({ solana: SOL });
    expect(r!.family).toBe("solana");
  });

  it("drops families the wallet doesn't have", async () => {
    const networks = [{ id: "solana:devnet", family: "solana" }] as Network[];
    const r = await new ClipHandlesBackend({ reader: reader({ alex }), isAddress: isAddr, networks }).resolve("@alex");
    expect(r!.byFamily).toEqual({ solana: SOL });
  });

  it("free handles and handles without usable records resolve to null", async () => {
    const b = new ClipHandlesBackend({ reader: reader({ empty: { ...alex, families: [], addrs: [] } }), isAddress: isAddr });
    expect(await b.resolve("@nobody")).toBeNull();
    expect(await b.resolve("@empty")).toBeNull();
    expect(await b.resolve("@x")).toBeNull(); // invalid: never hits the chain
  });

  it("flags a handle registered in the last week", async () => {
    const fresh = { ...alex, registeredAt: NOW / 1000 - 3600 };
    const r = await new ClipHandlesBackend({ reader: reader({ fresh }), isAddress: isAddr, now: () => NOW }).resolve("@fresh");
    expect(r!.handle!.recentlyRegistered).toBe(true);
  });

  it("says plainly when no contract is configured", async () => {
    const b = new ClipHandlesBackend({ isAddress: isAddr });
    expect(b.enabled).toBe(false);
    await expect(b.resolve("@alex")).rejects.toMatchObject({ code: "names/clip-off" });
  });

  it("maps reader failures to a plain error", async () => {
    const b = new ClipHandlesBackend({ reader: { recordsOf: async () => Promise.reject(new Error("503")), handleOf: async () => "" }, isAddress: isAddr });
    await expect(b.resolve("@alex")).rejects.toMatchObject({ code: "names/clip-unavailable" });
  });

  it("reverse: only with opt-in AND the handle publishing that exact address", async () => {
    const b = new ClipHandlesBackend({ reader: reader({ alex }, { [ALICE.toLowerCase()]: "alex" }), isAddress: isAddr });
    expect(await b.reverse(ALICE, "evm")).toBe("@alex");
    const other = "0x1234567890AbcdEF1234567890aBcdef12345678";
    const spoof = new ClipHandlesBackend({ reader: reader({ alex }, { [other.toLowerCase()]: "alex" }), isAddress: isAddr });
    expect(await spoof.reverse(other, "evm")).toBeNull();
    expect(await b.reverse(SOL, "solana")).toBeNull();
  });

  it("plugs into MultiNameResolver", async () => {
    const r = new MultiNameResolver({ ens: false, sns: false, hns: false, clip: { reader: reader({ alex }), isAddress: isAddr } });
    expect(r.serviceFor("@alex")).toBe("clip");
    expect(r.serviceFor("alex.clip")).toBe("clip");
    expect((await r.resolve("alex.clip"))!.byFamily!.solana).toBe(SOL);
  });

  it("the resolver's ABI matches the compiled contract", () => {
    const path = fileURLToPath(new URL("../../../contracts/handles/abi/ClipHandles.json", import.meta.url));
    const compiled = JSON.parse(readFileSync(path, "utf8")) as { type: string; name?: string; inputs?: { type: string }[]; outputs?: { type: string }[] }[];
    const sig = (f: { name?: string; inputs?: { type: string }[]; outputs?: { type: string }[] }) => `${f.name}(${(f.inputs ?? []).map((i) => i.type)})->(${(f.outputs ?? []).map((o) => o.type)})`;
    const have = new Set(compiled.filter((f) => f.type === "function").map(sig));
    for (const f of CLIP_HANDLES_ABI) expect(have.has(sig(f as never)), sig(f as never)).toBe(true);
  });
});
