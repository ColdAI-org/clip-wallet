/**
 * A Snapshot from public data only, so notifications keep working while the wallet is locked: the accounts
 * the wallet cached after the last unlock (public keys and addresses, KV "clip/accounts"), each family's
 * ChainModule.getBalances/getNfts (the same indexers the portfolio uses), the stored activity list and the
 * approval queue. Nothing here touches the vault.
 */
import type { Account, ChainModule, Family, Network } from "@clip-wallet/core";
import type { Snapshot } from "./types.js";

export interface PublicSnapshotDeps {
  networks: Network[];
  chains: Partial<Record<Family, ChainModule>>;
  /** The wallet's cached public accounts (engine/service KV_KEYS.accounts). */
  accounts(): Promise<Account[] | undefined>;
  activity(): Promise<Snapshot["activity"] | undefined>;
  approvals(): Promise<Snapshot["approvals"]>;
  /** USD price of an asset key and the FX rate for a currency (the wallet's price feed). */
  usd(assetKey: string): number | undefined;
  fx(currency: string): number;
  fetch: typeof fetch;
  /** Per-network read timeout (default 10 s). */
  timeoutMs?: number;
  /** Read collectibles too (more requests; default true). */
  nfts?: boolean;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<T>((_, rej) => (t = setTimeout(() => rej(new Error("timeout")), ms)))]).finally(() => clearTimeout(t));
}

/** Null when there are no cached accounts yet (wallet never unlocked on this device). */
export async function publicSnapshot(d: PublicSnapshotDeps): Promise<Snapshot | null> {
  const accounts = await d.accounts();
  if (!accounts?.length) return null;
  const byFamily = new Map<Family, Account>();
  for (const a of accounts) if (!byFamily.has(a.family)) byFamily.set(a.family, a);
  const ms = d.timeoutMs ?? 10_000;
  const balances: Snapshot["balances"] = [];
  const networksRead: string[] = [];
  const nfts: Snapshot["nfts"] = [];
  let nftsRead = d.nfts !== false;

  await Promise.all(
    d.networks.map(async (network) => {
      const account = byFamily.get(network.family);
      const mod = d.chains[network.family];
      if (!account || !mod) return;
      const ctx = { network, account, fetch: d.fetch };
      try {
        const list = await withTimeout(mod.getBalances(ctx), ms);
        for (const b of list) balances.push({ key: b.asset.key, networkId: network.id, symbol: b.asset.symbol, decimals: b.asset.decimals, amount: b.amount, ...(b.asset.spam ? { spam: true } : {}) });
        networksRead.push(network.id);
      } catch {
        /* not read this time: the watcher keeps its last known balances for this network */
      }
      if (d.nfts === false) return;
      try {
        for (const n of await withTimeout(mod.getNfts(ctx), ms))
          nfts.push({ id: `${n.networkId}:${n.collection.address}:${n.tokenId}`, collection: n.collection.name, ...(n.name ? { name: n.name } : {}), ...(n.spam ? { spam: true } : {}) });
      } catch {
        nftsRead = false; // a partial list would look like new arrivals next time
      }
    }),
  );

  return {
    balances,
    networksRead,
    nfts,
    nftsRead,
    activity: (await d.activity()) ?? [],
    approvals: await d.approvals(),
    price: (key, currency) => {
      const usd = d.usd(key);
      return usd === undefined ? undefined : usd * d.fx(currency);
    },
  };
}
