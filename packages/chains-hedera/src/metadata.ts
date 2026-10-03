import { b64decode } from "./util.js";

/**
 * HIP-412 NFT metadata. On-chain NFT metadata is a URI (usually ipfs://CID or https://…) pointing at a JSON
 * document: { name, image, type, description, properties, attributes: [{ trait_type, value }] }.
 * Everything here is untrusted input from the internet.
 */

export interface Hip412 {
  name?: string;
  image?: string;
  attributes?: { trait: string; value: string }[];
}

export const DEFAULT_IPFS_GATEWAY = "https://ipfs.io/ipfs/";

/** Mirror nodes return NFT metadata base64-encoded. */
export function metadataUri(base64Metadata: string): string | null {
  if (!base64Metadata) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(b64decode(base64Metadata)).trim();
  } catch {
    return null;
  }
  return text || null;
}

/** ipfs://, ipfs/…, bare CIDs and http(s) → a fetchable URL. Anything else (data:, javascript:, hcs://) → null. */
export function resolveUri(uri: string, gateway = DEFAULT_IPFS_GATEWAY): string | null {
  const u = uri.trim();
  const gw = gateway.endsWith("/") ? gateway : `${gateway}/`;
  if (/^ipfs:\/\//i.test(u)) return gw + u.replace(/^ipfs:\/\/(ipfs\/)?/i, "");
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z2-7]{50,})(\/.*)?$/.test(u)) return gw + u;
  if (/^https?:\/\//i.test(u)) return u;
  return null;
}

export async function fetchHip412(
  uri: string,
  fetchImpl: typeof fetch,
  gateway = DEFAULT_IPFS_GATEWAY,
  timeoutMs = 8000,
): Promise<Hip412 | null> {
  const url = resolveUri(uri, gateway);
  if (!url) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    const out: Hip412 = {};
    if (typeof json.name === "string") out.name = json.name.slice(0, 200);
    if (typeof json.image === "string") {
      const img = resolveUri(json.image, gateway);
      if (img) out.image = img;
    }
    if (Array.isArray(json.attributes)) {
      out.attributes = json.attributes
        .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
        .map((a) => ({ trait: String(a.trait_type ?? a.trait ?? ""), value: String(a.value ?? "") }))
        .slice(0, 50);
    }
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
