/**
 * Ordinals guard. Display-only support: we never build or sign anything that spends an inscribed
 * UTXO when an ord index is configured. Without an index we can't tell, so we warn instead.
 *
 * Index API: an `ord` server (`GET {url}/output/{txid}:{vout}` with Accept: application/json returns
 * `{ inscriptions: string[], ... }`).
 */

export type InscriptionCheck = "inscribed" | "clean" | "unknown";

export async function checkOutpoint(f: typeof fetch, indexUrl: string | undefined, txid: string, vout: number): Promise<InscriptionCheck> {
  if (!indexUrl) return "unknown";
  try {
    const res = await f(`${indexUrl.replace(/\/$/, "")}/output/${txid}:${vout}`, { headers: { accept: "application/json" } });
    if (res.status === 404) return "clean";
    if (!res.ok) return "unknown";
    const body = (await res.json()) as { inscriptions?: unknown[]; runes?: Record<string, unknown> | unknown[] };
    const runes = body.runes && (Array.isArray(body.runes) ? body.runes.length : Object.keys(body.runes).length);
    return (body.inscriptions?.length ?? 0) > 0 || (runes ?? 0) > 0 ? "inscribed" : "clean";
  } catch {
    return "unknown";
  }
}

export async function addressInscriptions(f: typeof fetch, indexUrl: string, address: string): Promise<string[]> {
  try {
    const res = await f(`${indexUrl.replace(/\/$/, "")}/address/${address}`, { headers: { accept: "application/json" } });
    if (!res.ok) return [];
    const body = (await res.json()) as { inscriptions?: string[] };
    return body.inscriptions ?? [];
  } catch {
    return [];
  }
}

/** Without an index, UTXOs at or below this value are used last (inscriptions usually sit on small outputs). */
export const SMALL_UTXO_SATS = 10_000;
