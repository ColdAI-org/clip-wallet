/**
 * The address book: people and the addresses they gave you, per network family. Every address is checked with
 * the family's own rules (ChainModule.isAddress) before it is saved. Used by Send (search), the approval screen
 * ("Send to Alex") and the security stream's address-poisoning check (ContactLookup).
 */
import { ClipError, FAMILIES, type Family } from "@clip-wallet/core";
import type { AddressValidators, Contact, ContactAddress, ContactInput, ContactLookup, ContactMatch, LookalikeMatch } from "./types.js";
import type { ContactStore } from "./store.js";

export const MAX_CONTACTS = 1000;
export const MAX_ADDRESSES_PER_CONTACT = 20;
export const MAX_NAME = 64;
export const MAX_NOTES = 500;
export const MAX_LABEL = 40;

/** Families whose addresses are case-insensitive (hex, bech32, Hedera ids). Base58/base64 ones are exact. */
const CASE_INSENSITIVE: ReadonlySet<Family> = new Set<Family>(["evm", "hedera", "bitcoin", "starknet", "near", "sui", "aptos"]);

/** Comparison key for an address: same key = same address. */
export function addressKey(family: Family, address: string): string {
  let a = address.trim();
  if (family === "hedera") a = a.replace(/^(0\.0\.\d+)-[a-z]{5}$/i, "$1"); // HIP-15 checksum
  if (family === "bitcoin" && !/^(bc1|tb1|bcrt1)/i.test(a)) return a; // base58 legacy addresses are case-sensitive
  return CASE_INSENSITIVE.has(family) ? a.toLowerCase() : a;
}

/** The letter for the avatar: first user-perceived character, uppercased where the script has case. */
export function initialOf(name: string): string {
  const s = name.trim();
  if (!s) return "?";
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: "grapheme" }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  const first = Seg ? ([...new Seg(undefined, { granularity: "grapheme" }).segment(s)][0]?.segment ?? s[0]!) : [...s][0]!;
  return first.toLocaleUpperCase();
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

function cleanText(s: string | undefined, max: number): string {
  return (s ?? "").replace(CONTROL, "").replace(/\s+/g, " ").trim().slice(0, max);
}

export interface ContactBookOptions {
  store: ContactStore;
  validators: AddressValidators;
  now?: () => number;
  randomId?: () => string;
}

export class ContactBook implements ContactLookup {
  private cache?: Contact[];
  private readonly now: () => number;
  private readonly randomId: () => string;

  constructor(private readonly opts: ContactBookOptions) {
    this.now = opts.now ?? Date.now;
    this.randomId = opts.randomId ?? (() => globalThis.crypto.randomUUID());
  }

  get encrypted(): boolean {
    return this.opts.store.encrypted;
  }

  /** Drop the decrypted copy (call on lock). */
  forget(): void {
    this.cache = undefined;
  }

  async list(): Promise<Contact[]> {
    if (!this.cache) {
      try {
        this.cache = (await this.opts.store.read()).map((c) => this.sanitize(c)).filter((c): c is Contact => !!c);
      } catch (e) {
        if (e instanceof ClipError) throw e;
        throw new ClipError("Your contacts couldn't be opened. Try unlocking the wallet again.", "contacts/unreadable", e);
      }
    }
    return [...this.cache].sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<Contact | null> {
    return (await this.list()).find((c) => c.id === id) ?? null;
  }

  async add(input: ContactInput): Promise<Contact> {
    const list = await this.list();
    if (list.length >= MAX_CONTACTS) throw new ClipError(`You can save up to ${MAX_CONTACTS} contacts.`, "contacts/full");
    const t = this.now();
    const contact: Contact = { id: this.randomId(), ...this.validate(input, list), createdAt: t, updatedAt: t };
    await this.save([...list, contact]);
    return contact;
  }

  async update(id: string, input: ContactInput): Promise<Contact> {
    const list = await this.list();
    const old = list.find((c) => c.id === id);
    if (!old) throw new ClipError("That contact isn't in your address book any more.", "contacts/not-found");
    const next: Contact = { ...old, ...this.validate(input, list.filter((c) => c.id !== id)), updatedAt: this.now() };
    if (!input.notes) delete next.notes;
    if (!input.handle) delete next.handle;
    await this.save(list.map((c) => (c.id === id ? next : c)));
    return next;
  }

  async remove(id: string): Promise<void> {
    const list = await this.list();
    await this.save(list.filter((c) => c.id !== id));
  }

  /**
   * Contacts matching a query: name (any word, accent- and case-insensitive), handle, or the start/end of an
   * address. With `family`, only contacts that have an address for it, and only those addresses.
   */
  async search(query: string, family?: Family, limit = 8): Promise<ContactMatch[]> {
    const q = fold(query.trim().replace(/^@/, ""));
    const out: ContactMatch[] = [];
    for (const c of await this.list()) {
      const entries = family ? c.addresses.filter((a) => a.family === family) : c.addresses;
      if (!entries.length) continue;
      const nameHit = !q || fold(c.name).split(" ").some((w) => w.startsWith(q)) || fold(c.name).startsWith(q) || (c.handle && c.handle.startsWith(q));
      if (nameHit) {
        out.push({ contact: c, entry: entries[0]! });
        continue;
      }
      const byAddr = q.length >= 3 && entries.find((a) => addressKey(a.family, a.address).startsWith(addressKey(a.family, query.trim())) || fold(a.address).endsWith(q));
      if (byAddr) out.push({ contact: c, entry: byAddr });
    }
    return out.slice(0, limit);
  }

  async byAddress(address: string, family?: Family): Promise<ContactMatch | null> {
    for (const c of await this.list()) {
      for (const a of c.addresses) {
        if (family && a.family !== family) continue;
        if (addressKey(a.family, a.address) === addressKey(a.family, address)) return { contact: c, entry: a };
      }
    }
    return null;
  }

  async lookalikes(address: string, family?: Family): Promise<LookalikeMatch[]> {
    if (await this.byAddress(address, family)) return [];
    const out: LookalikeMatch[] = [];
    for (const c of await this.list()) {
      for (const a of c.addresses) {
        if (family && a.family !== family) continue;
        if (/^0\.0\.\d+$/.test(a.address) || /^0\.0\.\d+$/.test(address)) continue; // Hedera ids are short and sequential
        const m = similarity(addressKey(a.family, a.address), addressKey(a.family, address));
        if (m && looksAlike(m.samePrefix, m.sameSuffix)) out.push({ contact: c, entry: a, ...m });
      }
    }
    return out.sort((x, y) => y.samePrefix + y.sameSuffix - (x.samePrefix + x.sameSuffix));
  }

  /* ------------------------------------------------------------------ internals */

  private async save(list: Contact[]): Promise<void> {
    await this.opts.store.write(list);
    this.cache = list;
  }

  private validate(input: ContactInput, others: Contact[]): Omit<Contact, "id" | "createdAt" | "updatedAt"> {
    const name = cleanText(input.name, MAX_NAME);
    if (!name) throw new ClipError("Give this contact a name.", "contacts/name");
    if (others.some((c) => c.name.toLocaleLowerCase() === name.toLocaleLowerCase()))
      throw new ClipError(`You already have a contact called ${name}.`, "contacts/duplicate-name");
    if (!input.addresses.length) throw new ClipError("Add at least one address.", "contacts/no-address");
    if (input.addresses.length > MAX_ADDRESSES_PER_CONTACT) throw new ClipError(`A contact can have up to ${MAX_ADDRESSES_PER_CONTACT} addresses.`, "contacts/too-many");
    const seen = new Set<string>();
    const addresses: ContactAddress[] = [];
    for (const raw of input.addresses) {
      const family = raw.family;
      const address = raw.address.trim();
      const check = this.opts.validators[family];
      if (!(FAMILIES as readonly string[]).includes(family) || !check) throw new ClipError("This wallet can't save addresses of that kind yet.", "contacts/family");
      if (!check(address)) throw new ClipError(`That doesn't look like a valid address: ${short(address)}`, "contacts/bad-address");
      const key = `${family}|${addressKey(family, address)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const clash = others.find((c) => c.addresses.some((a) => a.family === family && addressKey(family, a.address) === addressKey(family, address)));
      if (clash) throw new ClipError(`${short(address)} is already saved for ${clash.name}.`, "contacts/address-taken");
      const label = cleanText(raw.label, MAX_LABEL);
      addresses.push(label ? { family, address, label } : { family, address });
    }
    const notes = cleanText(input.notes, MAX_NOTES);
    const handle = input.handle?.trim().replace(/^@/, "").toLowerCase();
    return {
      name,
      addresses,
      ...(notes ? { notes } : {}),
      ...(handle && /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,31}$/.test(handle) ? { handle } : {}),
    };
  }

  /** Storage is untrusted input too: drop anything malformed rather than crash. */
  private sanitize(c: Contact): Contact | null {
    if (!c || typeof c !== "object" || typeof c.id !== "string" || typeof c.name !== "string" || !Array.isArray(c.addresses)) return null;
    const addresses = c.addresses.filter((a) => a && typeof a.address === "string" && (FAMILIES as readonly string[]).includes(a.family));
    if (!addresses.length) return null;
    return { ...c, name: cleanText(c.name, MAX_NAME) || "?", addresses };
  }
}

function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase();
}

function short(a: string): string {
  return a.length > 14 ? `${a.slice(0, a.startsWith("0x") ? 6 : 4)}…${a.slice(-4)}` : a;
}

function similarity(a: string, b: string): { samePrefix: number; sameSuffix: number } | null {
  if (a === b) return null;
  // Compare what differs between addresses, not the fixed prefix every address of that kind starts with.
  const fixed = /^(0x|(?:bc|tb|bcrt)1[qp]|addr(?:_test)?1|stake(?:_test)?1)/i;
  const x = a.replace(fixed, "");
  const y = b.replace(fixed, "");
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p++;
  let s = 0;
  while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
  return { samePrefix: p, sameSuffix: s };
}

/**
 * Wallets show "0x1234…abcd": a poisoner grinds an address matching the first and last few characters. Flag
 * when both ends match at least 3 characters, or the two ends together match 7 or more.
 */
export function looksAlike(samePrefix: number, sameSuffix: number): boolean {
  return (samePrefix >= 3 && sameSuffix >= 3) || samePrefix + sameSuffix >= 7;
}
