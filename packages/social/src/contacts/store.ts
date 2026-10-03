/**
 * Where the address book lives. Preferred: sealed by the vault (ClipVault.sealAppData("contacts"), a seed-derived
 * XChaCha20-Poly1305 key) in ordinary storage, so a copied profile/backup doesn't reveal who the user pays.
 * Fallback for hosts without that vault API: plain JSON in extension/app storage (names and public addresses
 * only, never secrets).
 */
import type { Contact } from "./types.js";

export interface KVLike {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove?(key: string): Promise<void>;
}

/** The vault's app-data sealing, bound to one namespace by the host. */
export interface AppDataCipher {
  seal(plaintext: string): Promise<{ nonce: string; ct: string }>;
  open(box: { nonce: string; ct: string }): Promise<string>;
}

export interface ContactStore {
  readonly encrypted: boolean;
  read(): Promise<Contact[]>;
  write(list: Contact[]): Promise<void>;
}

export const CONTACTS_KEY = "clip/social/contacts";

interface SealedRecord {
  v: 1;
  box: { nonce: string; ct: string };
}
interface PlainRecord {
  v: 1;
  contacts: Contact[];
}

export function encryptedContactStore(kv: KVLike, cipher: AppDataCipher, key = CONTACTS_KEY): ContactStore {
  return {
    encrypted: true,
    async read() {
      const rec = await kv.get<SealedRecord | PlainRecord>(key);
      if (!rec) return [];
      // A plain list from before encryption was available: read it; the next write seals it.
      if ("contacts" in rec) return Array.isArray(rec.contacts) ? rec.contacts : [];
      const json = await cipher.open(rec.box);
      const parsed = JSON.parse(json) as unknown;
      return Array.isArray(parsed) ? (parsed as Contact[]) : [];
    },
    async write(list) {
      await kv.set<SealedRecord>(key, { v: 1, box: await cipher.seal(JSON.stringify(list)) });
    },
  };
}

export function plainContactStore(kv: KVLike, key = CONTACTS_KEY): ContactStore {
  return {
    encrypted: false,
    async read() {
      const rec = await kv.get<PlainRecord | SealedRecord>(key);
      if (!rec || !("contacts" in rec) || !Array.isArray(rec.contacts)) return [];
      return rec.contacts;
    },
    async write(list) {
      await kv.set<PlainRecord>(key, { v: 1, contacts: list });
    },
  };
}
