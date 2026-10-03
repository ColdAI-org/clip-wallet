import type { SocialClient } from "./client";

/**
 * A SocialClient over any request/response transport (the extension bus, the mobile engine in-process).
 * Message shapes are @clip-wallet/social's SOCIAL_REQUESTS; the host validates them with zod.
 */
export function createSocialClient(
  call: (msg: { type: string } & Record<string, unknown>) => Promise<unknown>,
  extras: { requestNotificationPermission?: () => Promise<boolean> } = {},
): SocialClient {
  const c = <T>(msg: { type: string } & Record<string, unknown>) => call(msg) as Promise<T>;
  return {
    contacts: () => c({ type: "socContacts" }),
    saveContact: (p) => c({ type: "socContactSave", ...(p.id ? { id: p.id } : {}), input: p.input as unknown as Record<string, unknown> }),
    deleteContact: (id) => c({ type: "socContactDelete", id }),
    searchContacts: (p) => c({ type: "socContactSearch", query: p.query, ...(p.family ? { family: p.family } : {}) }),
    checkAddress: (p) => c({ type: "socAddressCheck", address: p.address, ...(p.family ? { family: p.family } : {}) }),
    detectFamily: (address) => c({ type: "socDetectFamily", address }),
    handleStatus: () => c({ type: "socHandleStatus" }),
    checkHandle: (handle) => c({ type: "socHandleCheck", handle }),
    lookupHandle: (input) => c({ type: "socHandleLookup", input }),
    registerHandle: (handle) => c({ type: "socHandleRegister", handle }),
    publishHandle: (records) => c({ type: "socHandlePublish", records }),
    releaseHandle: () => c({ type: "socHandleRelease" }),
    setHandleReverse: (enabled) => c({ type: "socHandleReverse", enabled }),
    notificationSettings: () => c({ type: "socNotifySettings" }),
    setNotifications: (p) => c({ type: "socNotifySet", ...(p.enabled !== undefined ? { enabled: p.enabled } : {}), ...(p.kinds ? { kinds: p.kinds } : {}) }),
    addPriceAlert: (p) => c({ type: "socAlertAdd", ...p }),
    armPriceAlert: (id, armed) => c({ type: "socAlertArm", id, armed }),
    removePriceAlert: (id) => c({ type: "socAlertRemove", id }),
    testNotification: () => c({ type: "socNotifyTest" }),
    discover: (p) => c({ type: "socDiscover", ...(p?.refresh ? { refresh: true } : {}) }),
    ...(extras.requestNotificationPermission ? { requestNotificationPermission: extras.requestNotificationPermission } : {}),
  };
}
