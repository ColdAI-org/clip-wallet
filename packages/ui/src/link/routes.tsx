import type { ReactElement } from "react";
import { LinkedDevices, Pairing } from "./LinkedDevices";

/**
 * Linked-devices screens for a path, or null (App.tsx calls it inside "settings" when a link client is present):
 *   /settings/devices, /settings/devices/pair/<id>
 */
export function linkRoute(seg: string[]): ReactElement | null {
  if (seg[0] !== "settings" || seg[1] !== "devices") return null;
  if (seg[2] === "pair" && seg[3]) return <Pairing id={decodeURIComponent(seg[3])} />;
  return <LinkedDevices />;
}
