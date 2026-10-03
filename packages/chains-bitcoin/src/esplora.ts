/** Esplora / mempool.space REST client over the context's fetch, failing over across Network.rpcUrls. */
import { ClipError, type Network } from "@clip-wallet/core";

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

async function request(network: Network, f: typeof fetch, path: string, init?: RequestInit): Promise<Response> {
  let lastErr: unknown;
  for (const base of network.rpcUrls) {
    let res: Response;
    try {
      res = await f(`${base}${path}`, init);
    } catch (e) {
      lastErr = e;
      continue;
    }
    if (res.status >= 500) {
      lastErr = new HttpError(res.status, await res.text().catch(() => ""));
      continue;
    }
    if (!res.ok) throw new HttpError(res.status, await res.text().catch(() => ""));
    return res;
  }
  throw new ClipError("We couldn't reach the Bitcoin network. Check your connection and try again.", "esplora-unreachable", lastErr);
}

export const esploraJson = async <T>(network: Network, f: typeof fetch, path: string): Promise<T> =>
  (await (await request(network, f, path)).json()) as T;

export const esploraText = async (network: Network, f: typeof fetch, path: string, init?: RequestInit): Promise<string> =>
  (await request(network, f, path, init)).text();

export interface EsploraUtxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean; block_height?: number };
}

export interface EsploraAddress {
  chain_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count?: number };
  mempool_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count?: number };
}

/** sat/vB for ~30 minutes (target 3 blocks), falling back to 6, then 1. Never below 1. */
export async function feeRate(network: Network, f: typeof fetch): Promise<number> {
  const est = await esploraJson<Record<string, number>>(network, f, "/fee-estimates");
  const r = est["3"] ?? est["6"] ?? est["1"] ?? 1;
  return Math.max(1, Math.ceil(r * 100) / 100);
}

/** Broadcast raw tx hex; returns the txid. */
export async function broadcast(network: Network, f: typeof fetch, txHex: string): Promise<string> {
  try {
    return (await esploraText(network, f, "/tx", { method: "POST", body: txHex, headers: { "content-type": "text/plain" } })).trim();
  } catch (e) {
    if (e instanceof HttpError) {
      if (/insufficient fee|min relay fee|mempool min fee/i.test(e.body)) throw new ClipError("The network fee is too low right now. Try again with a higher fee.", "fee-too-low", e);
      if (/missing|spent|conflict/i.test(e.body)) throw new ClipError("Some of these coins were already spent. Refresh and try again.", "inputs-spent", e);
      throw new ClipError("The network rejected this. Nothing was sent.", "broadcast-rejected", e);
    }
    throw e;
  }
}
