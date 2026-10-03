import type { ReactElement } from "react";
import type { Family } from "@clip-wallet/core";
import { ContactEdit } from "./ContactEdit";
import { Contacts } from "./Contacts";
import { HandleScreen } from "./Handle";
import { NotificationSettingsScreen } from "./Notifications";

/** Top-level paths the social screens own. */
export const SOCIAL_PATHS = ["contacts", "handle"] as const;

/**
 * Social screens for a path, or null. App.tsx calls this before its own switch (like featureRoute):
 *   /contacts, /contacts/new?address=…&family=…&name=…, /contacts/<id>, /handle, /settings/notifications
 */
export function socialRoute(seg: string[], query: URLSearchParams): ReactElement | null {
  switch (seg[0]) {
    case "contacts": {
      if (!seg[1]) return <Contacts />;
      if (seg[1] === "new") {
        const address = query.get("address") ?? undefined;
        const family = (query.get("family") as Family | null) ?? undefined;
        const name = query.get("name") ?? undefined;
        return <ContactEdit prefill={{ ...(address ? { address } : {}), ...(family ? { family } : {}), ...(name ? { name } : {}) }} />;
      }
      return <ContactEdit id={decodeURIComponent(seg[1])} />;
    }
    case "handle":
      return <HandleScreen />;
    case "settings":
      return seg[1] === "notifications" ? <NotificationSettingsScreen /> : null;
    default:
      return null;
  }
}
