import { describe, expect, it } from "vitest";
import { CoinGeckoPriceFeed } from "../src/prices/coingecko.js";
import { COINGECKO_IDS } from "../src/prices/ids.js";
import { json } from "./helpers.js";

const BODY = {
  "usd-coin": { usd: 1, eur: 0.9, gbp: 0.75 },
  "hedera-hashgraph": { usd: 0.25, eur: 0.225 },
  solana: { usd: 180, eur: 162 },
  ethereum: { usd: 4000, eur: 3600 },
  bitcoin: { usd: 100000, eur: 90000 },
};

function feed(responses: (Response | Error)[], t = { now: 1_000_000 }) {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  const f = (async (u: string, init?: RequestInit) => {
    urls.push(u);
    headers.push((init?.headers ?? {}) as Record<string, string>);
    const r = responses.shift();
    if (!r) return json(BODY);
    if (r instanceof Error) throw r;
    return r;
  }) as typeof fetch;
  const store = new Map<string, unknown>();
  const kv = { get: async <T,>(k: string) => store.get(k) as T, set: async <T,>(k: string, v: T) => void store.set(k, v) };
  const pf = new CoinGeckoPriceFeed({ fetch: f, now: () => t.now, store: kv });
  return { pf, urls, headers, t, store, kv };
}

describe("CoinGeckoPriceFeed", () => {
  it("maps asset keys to verified CoinGecko ids", () => {
    expect(COINGECKO_IDS.hbar).toBe("hedera-hashgraph");
    expect(COINGECKO_IDS.ton).toBe("the-open-network");
    expect(COINGECKO_IDS.pol).toBe("polygon-ecosystem-token");
  });

  it("fetches every id in one /simple/price call, then answers synchronously", async () => {
    const { pf, urls, headers } = feed([json(BODY)]);
    expect(pf.usd("hbar")).toBeUndefined(); // nothing yet; triggers a refresh
    await pf.refresh();
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/^https:\/\/api\.coingecko\.com\/api\/v3\/simple\/price\?ids=/);
    expect(decodeURIComponent(urls[0]!)).toContain("hedera-hashgraph");
    expect(urls[0]).toContain("vs_currencies=usd,eur");
    expect(headers[0]!["x-cg-demo-api-key"]).toBeUndefined();
    expect(pf.usd("hbar")).toBe(0.25);
    expect(pf.usd("sol")).toBe(180);
    expect(pf.usd("usdc-testnet")).toBe(1); // testnet alias for display
    expect(pf.usd("usdc.e")).toBe(1);
    expect(pf.usd("unknown-token")).toBeUndefined();
    expect(pf.fx("EUR")).toBeCloseTo(0.9);
    expect(pf.fx("USD")).toBe(1);
    expect(pf.fx("XYZ")).toBe(1);
  });

  it("rate-limits: no second request inside the TTL or the minimum interval", async () => {
    const { pf, urls, t } = feed([json(BODY), json(BODY)]);
    await pf.refresh();
    t.now += 5_000;
    await pf.refresh();
    pf.usd("hbar");
    expect(urls).toHaveLength(1);
    t.now += 61_000;
    await pf.refresh();
    expect(urls).toHaveLength(2);
  });

  it("keeps the last known prices when the API fails or rate-limits, and backs off on 429", async () => {
    const { pf, urls, t } = feed([json(BODY), json({}, 429), new Error("offline")]);
    await pf.refresh();
    t.now += 61_000;
    await pf.refresh(); // 429
    expect(pf.usd("eth")).toBe(4000);
    t.now += 16_000; // within doubled backoff (30 s)
    await pf.refresh();
    expect(urls).toHaveLength(2);
    t.now += 20_000;
    await pf.refresh(); // offline
    expect(urls).toHaveLength(3);
    expect(pf.usd("eth")).toBe(4000);
  });

  it("persists the snapshot and loads it after a restart", async () => {
    const a = feed([json(BODY)]);
    await a.pf.refresh();
    const b = new CoinGeckoPriceFeed({ fetch: (async () => json({}, 500)) as typeof fetch, store: a.kv, now: () => a.t.now });
    await b.load();
    expect(b.usd("btc")).toBe(100000);
  });

  it("sends the optional demo key as a header, never in the URL", async () => {
    const urls: string[] = [];
    const hs: Record<string, string>[] = [];
    const pf = new CoinGeckoPriceFeed({
      fetch: (async (u: string, i?: RequestInit) => {
        urls.push(u);
        hs.push(i?.headers as Record<string, string>);
        return json(BODY);
      }) as typeof fetch,
      demoApiKey: "demo-key-for-test",
    });
    await pf.refresh();
    expect(hs[0]!["x-cg-demo-api-key"]).toBe("demo-key-for-test");
    expect(urls[0]).not.toContain("demo-key-for-test");
  });
});
