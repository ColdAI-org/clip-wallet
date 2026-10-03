import { describe, expect, it } from "vitest";
import type { Account, ChainModule, Network } from "@clip-wallet/core";
import { NotificationWatcher, publicSnapshot, type Notice, type Snapshot } from "../src/index.js";
import { MapKV } from "./helpers.js";

const BASE = "eip155:84532";
const SOLD = "solana:devnet";

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    balances: [
      { key: "eth", networkId: BASE, symbol: "ETH", decimals: 18, amount: "1000000000000000000" },
      { key: "sol", networkId: SOLD, symbol: "SOL", decimals: 9, amount: "0" },
    ],
    networksRead: [BASE, SOLD],
    nfts: [{ id: "n1", collection: "Punks", name: "Punk #1" }],
    nftsRead: true,
    activity: [{ id: "a1", title: "Sent 1 ETH to alex", status: "pending", kind: "send" }],
    approvals: [],
    price: () => 2000,
    ...over,
  };
}

function setup(locale: "en" | "de" = "en") {
  const kv = new MapKV();
  const shown: Notice[] = [];
  const w = new NotificationWatcher({ kv, notifier: { show: async (n) => void shown.push(n) }, locale: () => locale, now: () => 5000 });
  return { kv, shown, w };
}

describe("NotificationWatcher", () => {
  it("does nothing until turned on; the first poll is only a baseline", async () => {
    const { w, shown } = setup();
    expect(await w.poll(async () => snap())).toEqual([]);
    await w.setSettings({ enabled: true });
    expect(await w.poll(async () => snap())).toEqual([]);
    expect(shown).toEqual([]);
  });

  it("incoming funds, new collectibles, finished transactions and waiting approvals", async () => {
    const { w, shown } = setup();
    await w.setSettings({ enabled: true });
    await w.poll(async () => snap());
    const next = snap({
      balances: [
        { key: "eth", networkId: BASE, symbol: "ETH", decimals: 18, amount: "1500000000000000000" },
        { key: "sol", networkId: SOLD, symbol: "SOL", decimals: 9, amount: "2000000000" },
        { key: "scam", networkId: BASE, symbol: "USDC-CLAIM", decimals: 6, amount: "1000000", spam: true },
      ],
      nfts: [
        { id: "n1", collection: "Punks", name: "Punk #1" },
        { id: "n2", collection: "Apes", name: "Ape #7" },
        { id: "n3", collection: "Free mint", spam: true },
      ],
      activity: [
        { id: "a1", title: "Sent 1 ETH to alex", status: "done", kind: "send" },
        { id: "a2", title: "Swap 5 USDC for SOL", status: "failed", kind: "swap" },
      ],
      approvals: [{ id: "ap1", app: "Uniswap", title: "Swap 10 USDC for ETH" }],
    });
    const out = await w.poll(async () => next);
    expect(out.map((n) => `${n.kind}|${n.title}|${n.body}`)).toEqual([
      "incoming|Money received|You received 0.5 ETH.",
      "incoming|Money received|You received 2 SOL.",
      "nft|New collectible|Ape #7 arrived in your wallet.",
      "confirmed|Done|Sent 1 ETH to alex",
      "failed|Didn't go through|Swap 5 USDC for SOL didn't go through. Open Activity for the details.",
      "approval|Uniswap is waiting for you|Swap 10 USDC for ETH",
    ]);
    expect(shown).toHaveLength(6);
    expect(out[0]!.route).toBe("/asset/eth");
    expect(out[5]!.route).toBe("/approval/ap1");
    // Nothing new on the next poll.
    expect(await w.poll(async () => next)).toEqual([]);
  });

  it("a network that failed to read isn't mistaken for money arriving later", async () => {
    const { w } = setup();
    await w.setSettings({ enabled: true });
    await w.poll(async () => snap());
    await w.poll(async () => snap({ balances: [], networksRead: [], nftsRead: false, nfts: [] }));
    expect(await w.poll(async () => snap())).toEqual([]);
  });

  it("respects per-kind switches and collapses floods", async () => {
    const { w } = setup();
    await w.setSettings({ enabled: true, kinds: { nft: false } });
    await w.poll(async () => snap());
    const many = snap({
      balances: ["a", "b", "c", "d", "e"].map((k) => ({ key: k, networkId: BASE, symbol: k.toUpperCase(), decimals: 0, amount: "1" })),
      nfts: [...snap().nfts, { id: "n9", collection: "X" }],
    });
    const out = await w.poll(async () => many);
    expect(out.map((n) => n.body)).toEqual(["You received 5 assets. Open the wallet to see them."]);
  });

  it("price alerts fire once when crossed, then wait to be re-armed", async () => {
    const { w } = setup();
    await w.setSettings({ enabled: true });
    const a = await w.addAlert({ assetKey: "eth", symbol: "ETH", direction: "above", price: 2500, currency: "USD" }, "al1");
    let price = 2400;
    const read = async () => snap({ price: () => price });
    expect(await w.poll(read)).toEqual([]);
    price = 2600;
    const out = await w.poll(read);
    expect(out.map((n) => `${n.title} / ${n.body}`)).toEqual(["ETH is above $2,500.00 / ETH is now $2,600.00."]);
    expect(await w.poll(read)).toEqual([]);
    expect((await w.settings()).alerts[0]).toMatchObject({ id: a.id, armed: false, firedAt: 5000 });
    await w.setAlertArmed(a.id, true);
    expect(await w.poll(read)).toHaveLength(1);
    await w.removeAlert(a.id);
    expect((await w.settings()).alerts).toEqual([]);
    await expect(w.addAlert({ assetKey: "eth", symbol: "ETH", direction: "below", price: 0, currency: "USD" }, "x")).rejects.toThrow();
  });

  it("speaks the user's language (English until translations land, numbers already localized)", async () => {
    const { w } = setup("de");
    await w.setSettings({ enabled: true });
    await w.poll(async () => snap());
    const out = await w.poll(async () => snap({ balances: [{ key: "eth", networkId: BASE, symbol: "ETH", decimals: 18, amount: "2500000000000000000" }] }));
    expect(out[0]!.body).toMatch(/1,5 ETH/);
  });

  it("turning notifications back on starts a fresh baseline", async () => {
    const { w } = setup();
    await w.setSettings({ enabled: true });
    await w.poll(async () => snap());
    await w.setSettings({ enabled: false });
    await w.setSettings({ enabled: true });
    expect(await w.poll(async () => snap({ balances: [{ key: "eth", networkId: BASE, symbol: "ETH", decimals: 18, amount: "9000000000000000000" }] }))).toEqual([]);
  });
});

describe("publicSnapshot", () => {
  const net = (id: string, family: Network["family"]) => ({ id, family, name: id, nativeAsset: { key: "x", symbol: "X", name: "X", decimals: 18, networkId: id }, testnet: true, rpcUrls: [], explorerUrl: "" }) as Network;
  const acct = (family: Account["family"], address: string) => ({ id: `${family}:0`, family, index: 0, address, publicKey: "00", derivationPath: "m" }) as unknown as Account;

  it("reads balances and collectibles from cached public accounts, without the vault", async () => {
    const evm = {
      getBalances: async (ctx: { account: Account }) => [{ asset: { key: "eth", symbol: "ETH", name: "Ether", decimals: 18, networkId: BASE }, amount: ctx.account.address === "0xme" ? "7" : "0" }],
      getNfts: async () => [{ networkId: BASE, standard: "erc721", collection: { address: "0xc", name: "C" }, tokenId: "1", name: "C #1" }],
    } as unknown as ChainModule;
    const sol = { getBalances: async () => Promise.reject(new Error("down")), getNfts: async () => [] } as unknown as ChainModule;
    const s = await publicSnapshot({
      networks: [net(BASE, "evm"), net(SOLD, "solana")],
      chains: { evm, solana: sol },
      accounts: async () => [acct("evm", "0xme"), acct("solana", "So1")],
      activity: async () => undefined,
      approvals: async () => [],
      usd: (k) => (k === "eth" ? 2000 : undefined),
      fx: (c) => (c === "EUR" ? 0.9 : 1),
      fetch: globalThis.fetch,
    });
    expect(s!.balances).toEqual([{ key: "eth", networkId: BASE, symbol: "ETH", decimals: 18, amount: "7" }]);
    expect(s!.networksRead).toEqual([BASE]);
    expect(s!.nfts.map((n) => n.id)).toEqual([`${BASE}:0xc:1`]);
    expect(s!.price("eth", "EUR")).toBe(1800);
    expect(s!.price("doge", "USD")).toBeUndefined();
  });

  it("no cached accounts (never unlocked here) → no snapshot", async () => {
    expect(await publicSnapshot({ networks: [], chains: {}, accounts: async () => undefined, activity: async () => [], approvals: async () => [], usd: () => undefined, fx: () => 1, fetch: globalThis.fetch })).toBeNull();
  });
});
