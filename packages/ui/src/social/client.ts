/**
 * The social screens' door to the background (contacts, Clip handles, notifications, Discover). Implemented over
 * the extension bus (packages/extension-kit/src/shared/social-bus.ts) and the mobile engine; a fake in tests. Nothing here
 * carries key material: handle actions return the approval they queued on the normal approval path.
 *
 * View types come from @clip-wallet/social/views (type-only).
 */
import type { Family } from "@clip-wallet/core";
import type {
  AddressCheckView,
  ContactInput,
  ContactMatchView,
  ContactView,
  ContactsView,
  DiscoverFeed,
  HandleLookupView,
  HandleView,
  NotificationKind,
  NotificationSettings,
  PriceAlert,
  PriceAlertInput,
  QueuedApproval,
} from "@clip-wallet/social/views";

export type {
  AddressCheckView,
  ContactAddress,
  ContactInput,
  ContactMatchView,
  ContactView,
  ContactsView,
  DiscoverFeed,
  DiscoverPool,
  DiscoverToken,
  HandleLookupView,
  HandleView,
  NotificationKind,
  NotificationSettings,
  PriceAlert,
  PriceAlertInput,
  QueuedApproval,
} from "@clip-wallet/social/views";

export interface SocialClient {
  contacts(): Promise<ContactsView>;
  saveContact(p: { id?: string; input: ContactInput }): Promise<ContactView>;
  deleteContact(id: string): Promise<void>;
  searchContacts(p: { query: string; family?: Family }): Promise<ContactMatchView[]>;
  checkAddress(p: { address: string; family?: Family }): Promise<AddressCheckView>;
  detectFamily(address: string): Promise<Family[]>;

  handleStatus(): Promise<HandleView>;
  checkHandle(handle: string): Promise<{ valid: boolean; available: boolean }>;
  lookupHandle(input: string): Promise<HandleLookupView | null>;
  registerHandle(handle: string): Promise<QueuedApproval>;
  publishHandle(records: { family: Family; address: string }[]): Promise<QueuedApproval>;
  releaseHandle(): Promise<QueuedApproval>;
  setHandleReverse(enabled: boolean): Promise<QueuedApproval>;

  notificationSettings(): Promise<NotificationSettings>;
  setNotifications(p: { enabled?: boolean; kinds?: Partial<Record<NotificationKind, boolean>> }): Promise<NotificationSettings>;
  addPriceAlert(p: PriceAlertInput): Promise<PriceAlert>;
  armPriceAlert(id: string, armed: boolean): Promise<void>;
  removePriceAlert(id: string): Promise<void>;
  testNotification(): Promise<void>;
  /**
   * Ask the platform for permission to show notifications (chrome.permissions "notifications", iOS/Android
   * prompt). Resolves false when refused. Absent = no permission needed.
   */
  requestNotificationPermission?(): Promise<boolean>;

  discover(p?: { refresh?: boolean }): Promise<DiscoverFeed>;
}
