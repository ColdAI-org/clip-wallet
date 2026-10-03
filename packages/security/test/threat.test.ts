import { describe, expect, it } from "vitest";
import { BlockaidProvider } from "../src/threat/blockaid.js";
import { LocalHeuristics, isPoisoningEntry, lookalike, zeroValueSuspects } from "../src/threat/heuristics.js";
import { LIST_SOURCES, ListProvider, Matcher, distance, suffixes } from "../src/threat/lists.js";
import { ThreatIntel, addressesOf } from "../src/threat/service.js";
import type { HistoryEntry } from "../src/host.js";
import { LIST_BODIES, LIST_ROUTES } from "./fixtures.js";
import { DEVNET, ME_EVM, ME_SOL, SEPOLIA, dappRequest, decoded, fakeHost, mockFetch } from "./helpers.js";

const source = (id: string) => LIST_SOURCES.find((s) => s.id === id)!;
const matcher = (id: keyof typeof LIST_BODIES) => new Matcher(source(id).parse(LIST_BODIES[id]), source(id).kind);

describe("open list parsing and matching", () => {
  it("parses every list format", () => {
    expect(source("metamask").parse(LIST_BODIES.metamask)).toMatchObject({ tolerance: 1, fuzzy: ["metamask.io", "opensea.io", "etherscan.io"] });
    expect(source("scamsniffer").parse(LIST_BODIES.scamsniffer).deny).toEqual(["wallet-connect-claim.example", "www.jumper-bonus.example"]);
    expect(source("phantom").parse(LIST_BODIES.phantom).deny).toEqual(["phantom-airdrop.example", "solflare-bonus.example", "raydium-claim.example"]);
    expect(source("polkadot").parse(LIST_BODIES.polkadot).allow).toContain("github.io");
    expect(source("polkadot-addresses").parse(LIST_BODIES["polkadot-addresses"]).deny).toHaveLength(2);
    expect(() => source("scamsniffer").parse("[]")).toThrow();
    expect(() => source("metamask").parse("<html>rate limited</html>")).toThrow();
  });

  it("blocks a listed domain and its subdomains, not its parents", () => {
    const m = matcher("metamask");
    expect(m.site("claim-airdrop.example")).toEqual({ kind: "deny", entry: "claim-airdrop.example" });
    expect(m.site("app.claim-airdrop.example")).toEqual({ kind: "deny", entry: "claim-airdrop.example" });
    expect(m.site("example")).toBeNull();
    expect(m.site("uniswap.org")).toBeNull();
  });

  it("the allowlist wins over the blocklist (MetaMask order)", () => {
    expect(matcher("metamask").site("safe.drainer-lookalike.example")).toBeNull();
    expect(matcher("metamask").site("x.drainer-lookalike.example")?.kind).toBe("deny");
    expect(matcher("polkadot").site("someone.github.io")).toBeNull();
  });

  it("flags one-letter look-alikes of protected names (MetaMask fuzzylist), but not the real site", () => {
    const m = matcher("metamask");
    expect(m.site("metamesk.io")).toEqual({ kind: "fuzzy", entry: "metamask.io" });
    expect(m.site("www.0pensea.io")).toEqual({ kind: "fuzzy", entry: "opensea.io" });
    expect(m.site("metamask.io")).toBeNull();
    expect(m.site("portfolio.metamask.io")).toBeNull();
    expect(m.site("opensea.pro")).toBeNull(); // allowlisted
    expect(m.site("totally-different.io")).toBeNull();
  });

  it("address lists: EVM case-insensitive, ss58 exact", () => {
    const evm = matcher("scamsniffer-addresses");
    expect(evm.address("0xdeadBEEF00000000000000000000000000000001")).toBe(true);
    expect(evm.address(ME_EVM)).toBe(false);
    const dot = matcher("polkadot-addresses");
    expect(dot.address("14FscqFT8S8W8emC5294cEpDctgAucJW7C99mpxS4cucpHoA")).toBe(true);
    expect(dot.address("14fscqft8s8w8emc5294cepdctgaucjw7c99mpxs4cucphoa")).toBe(false);
  });

  it("levenshtein with early exit; suffixes", () => {
    expect(distance("metamask", "metamesk")).toBe(1);
    expect(distance("kitten", "sitting")).toBe(3);
    expect(distance("abc", "abcdef", 1)).toBe(2);
    expect(suffixes("a.b.c")).toEqual(["a.b.c", "b.c", "c"]);
  });
});

describe("ListProvider caching", () => {
  it("downloads once, caches in kv, serves from cache within the refresh window, keeps the last copy on failure", async () => {
    let now = 1_000_000;
    let down = false;
    const { fetch, calls } = mockFetch([[/./, (u: string) => (down ? undefined : LIST_ROUTES.find(([re]) => re.test(u))?.[1])]]);
    const host = fakeHost({ networks: [], fetch, now: () => now });
    const p = new ListProvider(source("scamsniffer"), host, 24);
    expect(p.status().entries).toBeUndefined();
    await p.refresh();
    expect(p.checkSiteSync("www.jumper-bonus.example")).toHaveLength(1);
    expect(p.status()).toMatchObject({ enabled: true, entries: 2, updatedAt: 1_000_000 });
    expect(host.store.get("security/list/scamsniffer")).toBeTruthy();
    await p.refresh();
    expect(calls).toHaveLength(1); // fresh enough

    // A new background lifetime loads from kv without the network.
    const again = new ListProvider(source("scamsniffer"), host, 24);
    await again.load();
    expect(again.checkSiteSync("wallet-connect-claim.example")[0]).toMatchObject({ code: "phishing-site", level: "danger" });
    expect(calls).toHaveLength(1);

    now += 25 * 3_600_000;
    down = true;
    await again.refresh();
    expect(calls).toHaveLength(2);
    expect(again.checkSiteSync("wallet-connect-claim.example")).toHaveLength(1);
    expect(again.status().unavailable?.message).toBe("Couldn't refresh this list. Using the last copy.");
  });

  it("only ever requests the list URL itself (no site, no address)", async () => {
    const { fetch, calls } = mockFetch(LIST_ROUTES);
    const host = fakeHost({ networks: [], fetch });
    const intel = new ThreatIntel(host, {});
    await intel.refresh(true);
    await intel.assessSite("https://claim-airdrop.example");
    await intel.assessRequest(dappRequest({ origin: "https://claim-airdrop.example" }), decoded([{ label: "To", value: ME_EVM }]), SEPOLIA, ME_EVM);
    // Six list downloads, plus the new-contract check, which asks the explorer about the CONTRACT only.
    expect(calls.filter((c) => c.url.startsWith("https://raw.githubusercontent.com/"))).toHaveLength(6);
    expect(calls.filter((c) => !c.url.startsWith("https://raw.githubusercontent.com/")).map((c) => c.url)).toEqual([
      "https://eth-sepolia.blockscout.test/api/v2/addresses/0x2222222222222222222222222222222222222222",
    ]);
    for (const c of calls) {
      expect(c.url).not.toContain("claim-airdrop");
      expect(c.url.toLowerCase()).not.toContain(ME_EVM.slice(2));
      expect(c.body).toBeUndefined();
    }
  });
});

describe("ThreatIntel", () => {
  async function intel(over: Parameters<typeof fakeHost>[0] extends infer P ? Partial<P> : never = {}) {
    const m = mockFetch([...LIST_ROUTES]);
    const host = fakeHost({ networks: [SEPOLIA, DEVNET], fetch: m.fetch, ...over });
    const t = new ThreatIntel(host, {});
    await t.refresh(true);
    return { t, host, calls: m.calls };
  }

  it("site checks: every list contributes, one warning per message, danger only", async () => {
    const { t } = await intel();
    expect(await t.assessSite("https://phantom-airdrop.example")).toEqual([
      { level: "danger", code: "phishing-site", message: "This site is on Phantom's list of scam sites. Don't connect or sign anything." },
    ]);
    expect(await t.assessSite("https://dot-claim.example/connect")).toHaveLength(1);
    expect(await t.assessSite("https://app.uniswap.org")).toEqual([]);
    expect(await t.assessSite("wallet")).toEqual([]);
    expect((await t.checkSite("https://metamesk.io")).safe).toBe(false);
  });

  it("isKnownScam is synchronous (for WalletConnect assessVerify)", async () => {
    const { t } = await intel();
    expect(t.isKnownScam("https://wallet-connect-claim.example")).toBe(true);
    expect(t.isKnownScam("https://react.dev")).toBe(false);
    expect(t.isKnownScam("not a url")).toBe(false);
  });

  it("decode path: a scam spender becomes malicious-transaction; phishing origin becomes phishing-site", async () => {
    const { t } = await intel();
    const d = decoded([{ label: "Allowed app", value: "0x9999999999999999999999999999999999999999" }], { warnings: [{ level: "danger", code: "unlimited-approval", message: "x" }] });
    const out = await t.apply(dappRequest({ origin: "https://uniswap-rewards.example" }), d, SEPOLIA, ME_EVM);
    expect(out.warnings.map((w) => w.code)).toEqual(["phishing-site", "malicious-transaction", "unlimited-approval"]);
    expect(out.warnings[1]!.message).toContain("ScamSniffer");
    // Clean request: untouched object.
    const clean = decoded([{ label: "To", value: "0x2222222222222222222222222222222222222222" }]);
    expect(await t.apply(dappRequest(), clean, SEPOLIA, ME_EVM)).toBe(clean);
  });

  it("addressesOf picks recipients from To lines and everything else as counterparties", () => {
    const r = addressesOf(dappRequest(), decoded([{ label: "To", value: "0x3333333333333333333333333333333333333333" }, { label: "Allowed app", value: "0x4444444444444444444444444444444444444444" }, { label: "Amount", value: "5 USDC" }]), [ME_SOL]);
    expect(r.recipients).toEqual([ME_SOL, "0x3333333333333333333333333333333333333333"]);
    expect(r.counterparties).toContain("0x2222222222222222222222222222222222222222");
    expect(r.counterparties).toContain("0x4444444444444444444444444444444444444444");
  });

  it("never throws: a broken provider just adds nothing", async () => {
    const host = fakeHost({ networks: [SEPOLIA], fetch: mockFetch([]).fetch });
    const t = new ThreatIntel(host, {}, [
      { id: "x", name: "x", privacy: "", sendsUserData: false, status: () => ({ enabled: true }), checkTransaction: async () => { throw new Error("boom"); }, checkSite: async () => { throw new Error("boom"); } },
    ]);
    expect(await t.assessSite("https://a.example")).toEqual([]);
    const d = decoded();
    expect(await t.apply(dappRequest(), d, SEPOLIA, ME_EVM)).toBe(d);
  });

  it("status lists each provider with its privacy note; Blockaid off by default", async () => {
    const { t } = await intel();
    const s = t.status();
    expect(s.map((p) => p.id)).toEqual(["metamask", "scamsniffer", "scamsniffer-addresses", "phantom", "polkadot", "polkadot-addresses", "local", "blockaid"]);
    expect(s.filter((p) => p.sendsUserData).map((p) => p.id)).toEqual(["blockaid"]);
    expect(s.find((p) => p.id === "blockaid")).toMatchObject({ enabled: false, unavailable: { code: "threat/blockaid-off" } });
    expect(s.find((p) => p.id === "metamask")!.entries).toBe(3);
  });

  it("openLists: false switches the downloads off", () => {
    const t = new ThreatIntel(fakeHost({ networks: [], fetch: mockFetch([]).fetch }), { openLists: false });
    expect(t.status().map((p) => p.id)).toEqual(["local", "blockaid"]);
  });
});

describe("local heuristics", () => {
  const FRIEND = "0x1234567890abcdef1234567890abcdef12345678";
  const TWIN = "0x1234500000000000000000000000000000045678";
  const DAY = 86_400_000;

  it("look-alike: same start and end, different middle", () => {
    expect(lookalike(FRIEND, TWIN)).toBe(true);
    expect(lookalike(FRIEND, FRIEND.toUpperCase().replace("0X", "0x"))).toBe(false); // same address
    expect(lookalike(FRIEND, "0x9999999999999999999999999999999999999999")).toBe(false);
    expect(lookalike(ME_SOL, `${ME_SOL.slice(0, 5)}${"1".repeat(ME_SOL.length - 10)}${ME_SOL.slice(-5)}`)).toBe(true);
  });

  it("flags a recipient that imitates an address-book entry", async () => {
    const host = fakeHost({ networks: [SEPOLIA], fetch: mockFetch([]).fetch, addressBook: [{ address: FRIEND, name: "Mum" }] });
    const f = await new LocalHeuristics(host).checkTransaction({ request: dappRequest({ origin: "wallet" }), decoded: decoded(), network: SEPOLIA, account: ME_EVM, recipients: [TWIN], counterparties: [TWIN] });
    expect(f).toEqual([expect.objectContaining({ code: "address-poisoning", level: "danger" })]);
    expect(f[0]!.message).toContain("Mum (0x1234…5678)");
    // The real one is fine.
    expect(await new LocalHeuristics(host).checkTransaction({ request: dappRequest({ origin: "wallet" }), decoded: decoded(), network: SEPOLIA, account: ME_EVM, recipients: [FRIEND], counterparties: [] })).toEqual([]);
  });

  it("zero-value transfer poisoning: the fake 'sent' entry doesn't count as a real recipient", async () => {
    const history: HistoryEntry[] = [
      { family: "evm", networkId: SEPOLIA.id, direction: "out", counterparty: FRIEND, amount: "5000000", assetKey: "usdc", timestamp: 1 },
      { family: "evm", networkId: SEPOLIA.id, direction: "out", counterparty: TWIN, amount: "0", assetKey: "usdc", timestamp: 2 },
      { family: "evm", networkId: SEPOLIA.id, direction: "in", counterparty: "0x7777777777777777777777777777777777777777", amount: "0", timestamp: 3 },
    ];
    expect([...zeroValueSuspects(history)]).toEqual([TWIN.toLowerCase(), "0x7777777777777777777777777777777777777777"]);
    expect(isPoisoningEntry(history[1]!, history)).toBe(true);
    expect(isPoisoningEntry(history[0]!, history)).toBe(false);
    const host = fakeHost({ networks: [SEPOLIA], fetch: mockFetch([]).fetch, history });
    const h = new LocalHeuristics(host);
    const f = await h.checkTransaction({ request: dappRequest({ origin: "wallet" }), decoded: decoded(), network: SEPOLIA, account: ME_EVM, recipients: [TWIN], counterparties: [] });
    expect(f[0]).toMatchObject({ code: "address-poisoning" });
    const g = await h.checkTransaction({ request: dappRequest({ origin: "wallet" }), decoded: decoded(), network: SEPOLIA, account: ME_EVM, recipients: ["0x7777777777777777777777777777777777777777"], counterparties: [] });
    expect(g[0]!.message).toContain("zero-value transfer");
  });

  it("new contract: cautions on a contract created days ago, asking only about the contract", async () => {
    const now = Date.parse("2026-10-03T12:00:00Z");
    const m = mockFetch([
      [/\/api\/v2\/addresses\/0x2222/, { is_contract: true, creation_transaction_hash: "0xabc" }],
      [/\/api\/v2\/transactions\/0xabc$/, { timestamp: "2026-10-01T09:00:00.000000Z" }],
    ]);
    const host = fakeHost({ networks: [SEPOLIA], fetch: m.fetch, now: () => now });
    const h = new LocalHeuristics(host, 7);
    const input = { request: dappRequest(), decoded: decoded(), network: SEPOLIA, account: ME_EVM, recipients: [], counterparties: [] };
    expect(await h.checkTransaction(input)).toEqual([expect.objectContaining({ code: "new-recipient", level: "caution", message: expect.stringContaining("2 days ago") })]);
    await h.checkTransaction(input);
    expect(m.calls).toHaveLength(2); // cached
    for (const c of m.calls) expect(c.url.toLowerCase()).not.toContain(ME_EVM.slice(2));
    // Old contract, or a wallet-built request: nothing.
    const old = new LocalHeuristics(fakeHost({ networks: [SEPOLIA], fetch: m.fetch, now: () => now + 30 * DAY }), 7);
    expect(await old.checkTransaction(input)).toEqual([]);
    expect(await h.checkTransaction({ ...input, request: dappRequest({ origin: "wallet" }) })).toEqual([]);
  });
});

describe("Blockaid (optional)", () => {
  it("disabled without a key: never calls Blockaid", async () => {
    const m = mockFetch([]);
    const b = new BlockaidProvider(m.fetch);
    expect(await b.checkSite("https://a.example")).toEqual([]);
    expect(await b.checkTransaction({ request: dappRequest(), decoded: decoded(), network: SEPOLIA, account: ME_EVM, recipients: [], counterparties: [] })).toEqual([]);
    expect(m.calls).toHaveLength(0);
    expect(b.status().unavailable?.message).toContain("Add a Blockaid API key");
  });

  it("EVM transaction scan: X-API-Key header, chain name, verdict to malicious-transaction", async () => {
    const m = mockFetch([[/api\.blockaid\.io\/v0\/evm\/transaction\/scan$/, { validation: { result_type: "Malicious", description: "Transfers your tokens to a known drainer" } }]]);
    const b = new BlockaidProvider(m.fetch, { apiKey: "test-key-not-real" });
    const f = await b.checkTransaction({ request: dappRequest(), decoded: decoded(), network: SEPOLIA, account: ME_EVM, recipients: [], counterparties: [] });
    expect(f).toEqual([{ level: "danger", code: "malicious-transaction", source: "blockaid", message: "Blockaid says this would hurt you: Transfers your tokens to a known drainer. Don't sign it." }]);
    const body = JSON.parse(m.calls[0]!.body!);
    expect(body).toMatchObject({ chain: "ethereum-sepolia", account_address: ME_EVM, metadata: { domain: "https://app.example.org" }, options: ["validation"] });
    expect(body.data).toMatchObject({ from: ME_EVM, to: "0x2222222222222222222222222222222222222222" });
    expect((m.calls[0]!.init!.headers as Record<string, string>)["X-API-Key"]).toBe("test-key-not-real");
  });

  it("Warning verdict is a caution; Benign adds nothing; a failing call adds nothing", async () => {
    const warn = new BlockaidProvider(mockFetch([[/scan$/, { validation: { result_type: "Warning", reason: "new contract" } }]]).fetch, { apiKey: "k" });
    expect((await warn.checkTransaction({ request: dappRequest({ origin: "wallet" }), decoded: decoded(), network: SEPOLIA, account: ME_EVM, recipients: [], counterparties: [] }))[0]!.level).toBe("caution");
    const ok = new BlockaidProvider(mockFetch([[/scan$/, { validation: { result_type: "Benign" } }]]).fetch, { apiKey: "k" });
    expect(await ok.checkTransaction({ request: dappRequest(), decoded: decoded(), network: SEPOLIA, account: ME_EVM, recipients: [], counterparties: [] })).toEqual([]);
    const down = new BlockaidProvider(mockFetch([[/scan$/, { error: "x" }, 500]]).fetch, { apiKey: "k" });
    expect(await down.checkTransaction({ request: dappRequest(), decoded: decoded(), network: SEPOLIA, account: ME_EVM, recipients: [], counterparties: [] })).toEqual([]);
    expect(down.status().unavailable?.message).toBe("Blockaid didn't answer the last check.");
  });

  it("site scan and Solana message scan", async () => {
    const m = mockFetch([
      [/\/v0\/site\/scan$/, { status: "hit", is_malicious: true, url: "https://x.example" }],
      [/\/v0\/solana\/message\/scan$/, { status: "SUCCESS", result: { validation: { result_type: "Malicious", reason: "drainer" } } }],
    ]);
    const b = new BlockaidProvider(m.fetch, { apiKey: "k" });
    expect((await b.checkSite("https://x.example"))[0]!.code).toBe("phishing-site");
    // A minimal legacy transaction: 1 signature slot + message bytes; normalize only needs base64 bytes.
    const tx = Buffer.from(new Uint8Array([1, ...new Uint8Array(64), 1, 0, 0, 0])).toString("base64");
    const req = dappRequest({ family: "solana", networkId: DEVNET.id, method: "solana:signAndSendTransaction", params: { inputs: [{ account: ME_SOL, transaction: tx, chain: "solana:devnet" }] } });
    const f = await b.checkTransaction({ request: req, decoded: decoded(), network: DEVNET, account: ME_SOL, recipients: [], counterparties: [] });
    expect(f[0]).toMatchObject({ code: "malicious-transaction", level: "danger" });
    const body = JSON.parse(m.calls[1]!.body!);
    expect(body).toMatchObject({ account_address: ME_SOL, encoding: "base64", chain: "devnet", metadata: { url: "https://app.example.org" } });
    expect(body.transactions).toEqual([tx]);
  });

  it("when enabled through ThreatIntel, it is the only thing that ever sees your address", async () => {
    const m = mockFetch([...LIST_ROUTES, [/api\.blockaid\.io/, { validation: { result_type: "Benign" } }]]);
    const host = fakeHost({ networks: [SEPOLIA], fetch: m.fetch });
    const t = new ThreatIntel(host, { blockaid: { apiKey: "k" } });
    await t.refresh(true);
    await t.assessRequest(dappRequest(), decoded([{ label: "To", value: ME_EVM }]), SEPOLIA, ME_EVM);
    const seen = m.calls.filter((c) => `${c.url}${c.body ?? ""}`.toLowerCase().includes(ME_EVM.slice(2)));
    expect(seen.map((c) => new URL(c.url).host)).toEqual(["api.blockaid.io"]);
  });
});
