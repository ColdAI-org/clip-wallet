import type { ReactElement } from "react";
import { Cleanup, Permissions, Protection, SecurityHome } from "./Security";

/**
 * Security screens for a path, or null. App.tsx calls this inside its "settings" case when a security client
 * is present (docs/phase25/integration/security.md):
 *   /settings/security, /settings/security/permissions, /settings/security/cleanup, /settings/security/protection
 */
export function securityRoute(seg: string[]): ReactElement | null {
  if (seg[0] !== "settings" || seg[1] !== "security") return null;
  switch (seg[2]) {
    case undefined:
      return <SecurityHome />;
    case "permissions":
      return <Permissions />;
    case "cleanup":
      return <Cleanup />;
    case "protection":
      return <Protection />;
    default:
      return <SecurityHome />;
  }
}
