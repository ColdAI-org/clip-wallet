/**
 * Encrypted vault metadata: which account indexes the user added per family, their labels, and which
 * Bitcoin change addresses were handed out. Public-ish data, but it links addresses together, so it is
 * sealed with a key derived from the seed (available only while unlocked) and stored next to the record.
 *
 *   metaKey = HKDF-SHA256(ikm = BIP-39 seed, salt = "clip-wallet/vault/meta", info = "clip-wallet/vault/meta-key/v1")
 *   box     = XChaCha20-Poly1305(metaKey, JSON(meta), aad = "clip-vault/v1/meta")
 *
 * Tied to the seed, not the password, so changePassword and passkeys leave it alone.
 */
import { FAMILIES, type Family } from "@clip-wallet/core";
import { fromUtf8, utf8, wipe } from "./bytes.js";
import { hkdf32, open, seal, type SealedBox } from "./crypto.js";

export const AAD_META = "clip-vault/v1/meta";

export interface AccountEntry {
  index: number;
  label?: string;
}

export interface ChangeLedger {
  /** Next unused change index on this chain (never reused, even across vault accounts). */
  next: number;
  /** accountIndex -> change indexes handed out to it. */
  owners: Record<string, number[]>;
}

export interface VaultMeta {
  v: 1;
  accounts: Partial<Record<Family, AccountEntry[]>>;
  /** Keyed by "bitcoin:<mainnet|testnet>:<p2wpkh|p2tr>". */
  change: Record<string, ChangeLedger>;
}

export const emptyMeta = (): VaultMeta => ({ v: 1, accounts: {}, change: {} });

export function metaKey(seed: Uint8Array): Uint8Array {
  return hkdf32(seed, utf8("clip-wallet/vault/meta"), "clip-wallet/vault/meta-key/v1");
}

export function sealMeta(seed: Uint8Array, meta: VaultMeta): SealedBox {
  const k = metaKey(seed);
  try {
    return seal(k, utf8(JSON.stringify(meta)), AAD_META);
  } finally {
    wipe(k);
  }
}

/** Throws on a wrong seed or tampering. Unknown families and malformed entries are dropped. */
export function openMeta(seed: Uint8Array, box: SealedBox): VaultMeta {
  const k = metaKey(seed);
  let raw: Uint8Array | undefined;
  try {
    raw = open(k, box, AAD_META);
    return sanitize(JSON.parse(fromUtf8(raw)));
  } finally {
    wipe(k, raw);
  }
}

const isIndex = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 0x7fffffff;

function sanitize(x: unknown): VaultMeta {
  const out = emptyMeta();
  if (!x || typeof x !== "object") return out;
  const o = x as Record<string, unknown>;
  const accounts = (o.accounts ?? {}) as Record<string, unknown>;
  for (const f of FAMILIES) {
    const list = accounts[f];
    if (!Array.isArray(list)) continue;
    const seen = new Set<number>();
    const entries: AccountEntry[] = [];
    for (const e of list) {
      const idx = (e as AccountEntry)?.index;
      if (!isIndex(idx) || seen.has(idx)) continue;
      seen.add(idx);
      const label = (e as AccountEntry).label;
      entries.push(typeof label === "string" ? { index: idx, label: label.slice(0, 64) } : { index: idx });
    }
    out.accounts[f] = entries.sort((a, b) => a.index - b.index);
  }
  const change = (o.change ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(change)) {
    if (!/^bitcoin:(mainnet|testnet):(p2wpkh|p2tr)$/.test(k) || !v || typeof v !== "object") continue;
    const led = v as ChangeLedger;
    const owners: Record<string, number[]> = {};
    for (const [acct, list] of Object.entries(led.owners ?? {})) {
      if (!/^\d{1,10}$/.test(acct) || !Array.isArray(list)) continue;
      owners[acct] = list.filter(isIndex);
    }
    const maxUsed = Math.max(-1, ...Object.values(owners).flat());
    out.change[k] = { next: Math.max(isIndex(led.next) ? led.next : 0, maxUsed + 1), owners };
  }
  return out;
}
