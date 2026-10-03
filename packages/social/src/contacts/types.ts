import type { Family } from "@clip-wallet/core";

export interface ContactAddress {
  family: Family;
  address: string;
  /** Optional words for this address ("Exchange deposit", "Ledger"). */
  label?: string;
}

export interface Contact {
  id: string;
  name: string;
  addresses: ContactAddress[];
  notes?: string;
  /** Their Clip handle ("alex", no "@"), if the user saved one. Addresses stay pinned: a handle is a hint, not a source. */
  handle?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ContactInput {
  name: string;
  addresses: ContactAddress[];
  notes?: string;
  handle?: string;
}

/** Per-family address checks: the wallet's ChainModule.isAddress for each family it has. */
export type AddressValidators = Partial<Record<Family, (address: string) => boolean>>;

export interface ContactMatch {
  contact: Contact;
  entry: ContactAddress;
}

export interface LookalikeMatch extends ContactMatch {
  /** Leading characters the two addresses share (after "0x"). */
  samePrefix: number;
  /** Trailing characters they share. */
  sameSuffix: number;
}

/**
 * What the security stream's address-poisoning check (and the approval screen) needs from the address book.
 * Implemented by ContactBook; a host without contacts can pass `EMPTY_CONTACT_LOOKUP`.
 */
export interface ContactLookup {
  /** The contact that saved exactly this address (case rules per family), or null. */
  byAddress(address: string, family?: Family): Promise<ContactMatch | null>;
  /**
   * Saved addresses that look like `address` at a glance (same start and end, as wallets shorten them) but are
   * different: the shape of an address-poisoning attack. Empty when `address` itself is saved.
   */
  lookalikes(address: string, family?: Family): Promise<LookalikeMatch[]>;
}

export const EMPTY_CONTACT_LOOKUP: ContactLookup = {
  byAddress: async () => null,
  lookalikes: async () => [],
};
