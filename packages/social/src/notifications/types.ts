export type NotificationKind = "incoming" | "nft" | "confirmed" | "failed" | "price" | "approval";

export const NOTIFICATION_KINDS: readonly NotificationKind[] = ["incoming", "nft", "confirmed", "failed", "price", "approval"];

export interface PriceAlert {
  id: string;
  assetKey: string;
  symbol: string;
  direction: "above" | "below";
  /** Target price in `currency`. */
  price: number;
  currency: string;
  createdAt: number;
  /** One-shot: false after it fires, until the user turns it on again. */
  armed: boolean;
  firedAt?: number;
}

export interface NotificationSettings {
  /** Master switch. Off until the user turns notifications on (and grants the OS/browser permission). */
  enabled: boolean;
  kinds: Record<NotificationKind, boolean>;
  alerts: PriceAlert[];
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false,
  kinds: { incoming: true, nft: true, confirmed: true, failed: true, price: true, approval: true },
  alerts: [],
};

/** One notification to show. `route` is the wallet screen a click opens. */
export interface Notice {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  route?: string;
}

/** Shows notices: chrome.notifications in the extension, expo-notifications on the phone, a list in tests. */
export interface Notifier {
  show(notice: Notice): Promise<void>;
}

/** What the watcher compares between polls. All public data: no keys, no vault. */
export interface Snapshot {
  balances: { key: string; networkId: string; symbol: string; decimals: number; amount: string; spam?: boolean }[];
  /** Networks whose balances were read this time (a failed read must not look like money arriving later). */
  networksRead: string[];
  nfts: { id: string; name?: string; collection: string; spam?: boolean }[];
  /** null when the source couldn't read collectibles this time. */
  nftsRead: boolean;
  activity: { id: string; title: string; status: "done" | "pending" | "failed"; kind: string }[];
  approvals: { id: string; app: string; title: string }[];
  /** Price of an asset in a display currency, if known. */
  price(assetKey: string, currency: string): number | undefined;
}
