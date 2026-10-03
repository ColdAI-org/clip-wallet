import type { KVLike } from "../src/index.js";

export class MapKV implements KVLike {
  readonly data = new Map<string, unknown>();
  async get<T>(k: string) {
    const v = this.data.get(k);
    return v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as T);
  }
  async set<T>(k: string, v: T) {
    this.data.set(k, JSON.parse(JSON.stringify(v)));
  }
  async remove(k: string) {
    this.data.delete(k);
  }
}

/** Fetch stub: the first route whose key is contained in the URL answers. Records every URL. */
export function routes(map: Record<string, unknown | ((url: string) => unknown)>, status: Record<string, number> = {}) {
  const urls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    for (const [k, body] of Object.entries(map)) {
      if (!url.includes(k)) continue;
      const s = Object.entries(status).find(([sk]) => url.includes(sk))?.[1] ?? 200;
      return new Response(JSON.stringify(typeof body === "function" ? (body as (u: string) => unknown)(url) : body), { status: s });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { f, urls };
}
