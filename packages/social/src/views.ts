/**
 * What the social screens see. Plain JSON data (it crosses the extension bus). Type-only module: packages/ui
 * imports it as "@clip-wallet/social/views" without pulling in SDKs.
 *
 * @module
 */
import type { Family } from "@clip-wallet/core";
import type { ContactAddress, ContactInput } from "./contacts/types.js";
import type { DiscoverFeed, DiscoverPool, DiscoverToken } from "./discover/service.js";
import type { NotificationKind, NotificationSettings, PriceAlert } from "./notifications/types.js";

export type { ContactAddress, ContactInput, DiscoverFeed, DiscoverPool, DiscoverToken, NotificationKind, NotificationSettings, PriceAlert };

export interface ContactView {
  id: string;
  name: string;
  /** Avatar letter. */
  initial: string;
  addresses: ContactAddress[];
  notes?: string;
  handle?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ContactsView {
  contacts: ContactView[];
  /** True when the address book is sealed by the vault; false = plain storage (no secrets, but readable). */
  encrypted: boolean;
}

export interface ContactMatchView {
  contact: ContactView;
  entry: ContactAddress;
}

export interface AddressCheckView {
  /** The contact that saved exactly this address. */
  contact?: ContactMatchView;
  /** Saved addresses that look like this one but aren't (possible address poisoning). */
  lookalikes: (ContactMatchView & { samePrefix: number; sameSuffix: number })[];
}

export interface HandleView {
  /** False until a ClipHandles contract is configured: the screen says handles aren't on yet. */
  enabled: boolean;
  /** The user's own handle, if they have one. */
  mine?: {
    handle: string;
    records: { family: Family; address: string }[];
    reverse: boolean;
    registeredAt: number;
  };
  /** The wallet's addresses the user could publish, one per family. */
  publishable: { family: Family; address: string }[];
  /** Publishing needs a Hedera account that exists (it pays the fee). */
  hederaReady: boolean;
}

export interface HandleLookupView {
  handle: string;
  byFamily: Partial<Record<Family, string>>;
  recentlyRegistered: boolean;
}

export interface QueuedApproval {
  approvalId: string;
}

/** Fields of a price-alert form. */
export interface PriceAlertInput {
  assetKey: string;
  direction: "above" | "below";
  price: number;
  currency: string;
}
