import { describe, expect, it, vi } from "vitest";
import type { Network } from "@clip-wallet/core";
import { toCoinType } from "viem/ens";
import { EnsBackend, HnsBackend, MultiNameResolver, SnsBackend, looksLikeName, type EnsClient } from "../src/index.js";

const ALICE = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const ALICE_BASE = "0x1234567890AbcdEF1234567890aBcdef12345678";

function fakeEns(records: Record<string, Record<string, string>>, names: Record<string, string> = {}): EnsClient & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async getEnsAddress({ name, coinType }) {
      calls.push({ name, coinType });
      return records[name]?.[String(coinType ?? 60n)] ?? null;
    },
    async getEnsName({ address, coinType }) {
      return names[`${address}|${coinType ?? 60n}`] ?? null;
    },
  };
}

const net = (id: string, family: Network["family"] = "evm"): Network =>
  ({ id, family, name: id, nativeAsset: { key: "x", symbol: "X", name: "X", decimals: 18, networkId: id }, testnet: false, rpcUrls: [], explorerUrl: "" }) as Network;

function jsonFetch(routes: Record<string, [number, unknown]>) {
  const urls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    for (const [k, [status, body]] of Object.entries(routes)) {
      if (url.includes(k)) return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    }
    return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
  }) as typeof fetch;
  return { f, urls };
}

describe("ENS", () => {
  it("resolves the default record, valid on every EVM network", async () => {
    const ens = new EnsBackend({ client: fakeEns({ "alice.eth": { "60": ALICE.toLowerCase() } }) });
    expect(await ens.resolve("Alice.eth")).toEqual({ name: "alice.eth", address: ALICE, family: "evm", networkIds: [], service: "ens", displayName: "alice.eth" });
  });

  it("asks for the L2 coin types (ENSIP-11) and carries differing per-chain addresses", async () => {
    const client = fakeEns({ "alice.eth": { "60": ALICE, [String(toCoinType(8453))]: ALICE_BASE } });
    const r = await new EnsBackend({ client }).resolve("alice.eth");
    expect(r!.address).toBe(ALICE);
    expect(r!.addressOn).toEqual({ "eip155:8453": ALICE_BASE });
    expect(client.calls).toHaveLength(6);
    expect(client.calls).toContainEqual({ name: "alice.eth", coinType: 2147492101n });
  });

  it("a name with only a chain record implies that chain", async () => {
    const client = fakeEns({ "bob.eth": { [String(toCoinType(10))]: ALICE } });
    expect((await new EnsBackend({ client }).resolve("bob.eth"))!.networkIds).toEqual(["eip155:10"]);
  });

  it("Basenames imply Base, filtered to the wallet's networks", async () => {
    const client = fakeEns({ "jesse.base.eth": { [String(toCoinType(8453))]: ALICE } });
    expect((await new EnsBackend({ client }).resolve("jesse.base.eth"))!.networkIds).toEqual(["eip155:8453"]);
    const testnetOnly = new EnsBackend({ client, networks: [net("eip155:84532")] });
    expect((await testnetOnly.resolve("jesse.base.eth"))!.networkIds).toEqual([]);
  });

  it("returns null for unset names, zero addresses and invalid names", async () => {
    const client = fakeEns({ "zero.eth": { "60": "0x0000000000000000000000000000000000000000" } });
    const ens = new EnsBackend({ client });
    expect(await ens.resolve("nobody.eth")).toBeNull();
    expect(await ens.resolve("zero.eth")).toBeNull();
    expect(await ens.resolve("bad\u0000name.eth")).toBeNull();
  });

  it("turns a resolver failure into a plain ClipError", async () => {
    const client: EnsClient = { getEnsAddress: () => Promise.reject(new Error("rpc down")), getEnsName: async () => null };
    await expect(new EnsBackend({ client }).resolve("alice.eth")).rejects.toMatchObject({ code: "names/ens-unavailable" });
  });

  it("reverse uses the L2 coin type, then falls back to the default primary name", async () => {
    const client = fakeEns({}, { [`${ALICE}|${toCoinType(8453)}`]: "alice.eth", [`${ALICE_BASE}|60`]: "bob.eth" });
    const ens = new EnsBackend({ client });
    expect(await ens.reverse(ALICE, "evm", "eip155:8453")).toBe("alice.eth");
    expect(await ens.reverse(ALICE_BASE, "evm", "eip155:8453")).toBe("bob.eth");
    expect(await ens.reverse(ALICE, "solana")).toBeNull();
  });
});

describe("SNS", () => {
  const OWNER = "Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v";
  it("resolves via the SDK proxy", async () => {
    const { f, urls } = jsonFetch({ "/resolve/bonfida": [200, { s: "ok", result: OWNER }] });
    expect(await new SnsBackend({ fetch: f }).resolve("Bonfida.sol")).toEqual({ name: "bonfida.sol", address: OWNER, family: "solana", networkIds: [], service: "sns", displayName: "bonfida.sol" });
    expect(urls).toEqual(["https://sdk-proxy.sns.id/resolve/bonfida"]);
  });
  it("not found and garbage results are null", async () => {
    const { f } = jsonFetch({ "/resolve/nope": [200, { s: "error", result: "Domain not found" }], "/resolve/evil": [200, { s: "ok", result: "<script>" }] });
    const sns = new SnsBackend({ fetch: f });
    expect(await sns.resolve("nope.sol")).toBeNull();
    expect(await sns.resolve("evil.sol")).toBeNull();
  });
  it("service errors are ClipErrors", async () => {
    const { f } = jsonFetch({ "/resolve/x": [502, "bad gateway"] });
    await expect(new SnsBackend({ fetch: f }).resolve("x.sol")).rejects.toMatchObject({ code: "names/sns-unavailable" });
  });
  it("reverse: favourite domain", async () => {
    const { f } = jsonFetch({ "/favorite-domain/": [200, { s: "ok", result: { domain: "x", reverse: "couponvault", stale: false } }] });
    expect(await new SnsBackend({ fetch: f }).reverse(OWNER, "solana")).toBe("couponvault.sol");
  });
});

describe("HNS", () => {
  const rec = { account_id: "0.0.944899", expiration: 2041535036000, deleted: false, domain: "hashpack.hbar" };
  it("resolves to the domain holder on the resolver's ledger", async () => {
    const { f, urls } = jsonFetch({ "domain=hashpack.hbar": [200, rec] });
    const hns = new HnsBackend({ ledger: "mainnet", fetch: f });
    expect(await hns.resolve("HashPack.hbar")).toEqual({ name: "hashpack.hbar", address: "0.0.944899", family: "hedera", networkIds: ["hedera:mainnet"], service: "hns", displayName: "hashpack.hbar" });
    expect(urls[0]).toBe("https://mainnet.resolver.hashgraph.name/slds/domains?domain=hashpack.hbar");
  });
  it("expired (ms or s), deleted, reserved and missing are null", async () => {
    const now = () => 2_000_000_000_000;
    const { f } = jsonFetch({
      "domain=old.hbar": [200, { ...rec, expiration: 1_900_000_000_000 }],
      "domain=olds.hbar": [200, { ...rec, expiration: 1_900_000_000 }],
      "domain=gone.hbar": [200, { ...rec, deleted: true }],
      "domain=hedera.hbar": [403, "Domain is reserved."],
    });
    const hns = new HnsBackend({ ledger: "testnet", fetch: f, now });
    for (const n of ["old.hbar", "olds.hbar", "gone.hbar", "hedera.hbar", "missing.hbar"]) expect(await hns.resolve(n)).toBeNull();
  });
  it("reverse: default name", async () => {
    const { f } = jsonFetch({ "/default-name/0.0.944899": [200, { account_id: "0.0.944899", domain: "hedera.hbar" }] });
    expect(await new HnsBackend({ ledger: "mainnet", fetch: f }).reverse("0.0.944899", "hedera")).toBe("hedera.hbar");
  });
});

describe("MultiNameResolver", () => {
  it("routes by suffix and caches hits", async () => {
    const { f, urls } = jsonFetch({ "domain=hashpack.hbar": [200, { account_id: "0.0.944899", expiration: 4102444800000 }] });
    const client = fakeEns({ "alice.eth": { "60": ALICE } });
    const r = new MultiNameResolver({ fetch: f, ens: { client }, networks: [net("hedera:testnet", "hedera")] });
    expect(r.serviceFor("a.eth")).toBe("ens");
    expect(r.serviceFor("a.sol")).toBe("sns");
    expect(r.serviceFor("a.hbar")).toBe("hns");
    expect(r.serviceFor("a.com")).toBeNull();
    expect((await r.resolve("alice.eth"))!.address).toBe(ALICE);
    const h = await r.resolve("hashpack.hbar");
    expect(h!.networkIds).toEqual(["hedera:testnet"]);
    await r.resolve("hashpack.hbar");
    expect(urls.filter((u) => u.includes("hashpack"))).toHaveLength(1);
    expect(await r.resolve("unknown.xyz")).toBeNull();
  });
  it("looksLikeName", () => {
    expect(looksLikeName("alice.eth")).toBe(true);
    expect(looksLikeName("0x1234.eth")).toBe(false);
    expect(looksLikeName("0.0.1234")).toBe(false);
    expect(looksLikeName("https://x.com")).toBe(false);
  });
  it("reverse tries each backend", async () => {
    const hns = new HnsBackend({ fetch: vi.fn() as unknown as typeof fetch });
    const r = new MultiNameResolver({}, [hns]);
    expect(await r.reverse("not-an-id", "hedera")).toBeNull();
  });
});
