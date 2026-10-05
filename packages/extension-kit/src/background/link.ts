/**
 * Linked devices in the service worker (new file, r1/connect stream): the LinkService from @clip-wallet/link with
 *   - the phone as signer over the Clip Link relay (config.services.linkRelayUrl),
 *   - Clip Desktop as signer over native messaging (runtime.connectNative; the optional "nativeMessaging"
 *     permission is asked for from the page, when the person taps "Use Clip Desktop"),
 *   - settings sync against services/backup (config.services.backupUrl), every 5 minutes while unlocked,
 *   - "continue elsewhere" handoffs, with a notification when the phone sends a page here.
 * main.ts calls startLink() and wraps deps.dapps with withRemoteSigner() (docs/r1/integration/connect.md).
 *
 * MV3 lifetime: a WebSocket that exchanges a message at least every 30 s keeps the worker alive (Chrome 116+,
 * https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets), and so does an open native
 * messaging port (Chrome 105+). The relay channel sends a keep-alive every 20 s while a phone session is open.
 */
import { browser } from "wxt/browser";
import type { Family } from "@clip-wallet/core";
import { LinkService, NativePortChannel, contactsSource, nativeHostName, walletSources, type LinkVault, type NativePortLike } from "@clip-wallet/link";
import type { LinkRequest } from "@clip-wallet/link/messages";
import { CONTACTS_KEY, encryptedContactStore } from "@clip-wallet/social/contacts";
import type { Notifier } from "@clip-wallet/social";
import type { KV } from "../shared/storage";

export const LINK_SYNC_ALARM = "clip-link-sync";
const SYNC_MINUTES = 5;

interface Permission {
  origin: string;
  family: Family;
}

/** "Chrome on Mac", "Firefox on Windows": a name the phone shows for this browser. */
export function browserName(ua = navigator.userAgent): string {
  const b = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Brave/.test(ua) ? "Brave" : /Chrome\//.test(ua) ? "Chrome" : "Browser";
  const os = /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "computer";
  return `${b} on ${os}`;
}

export function startLink(d: {
  kv: KV;
  vault: LinkVault & { sealAppData?(ns: string, p: string): Promise<{ nonce: string; ct: string }>; openAppData?(ns: string, b: { nonce: string; ct: string }): Promise<string> };
  rdns: string;
  relayUrl?: string;
  syncUrl?: string;
  /** The wallet's own permission store (the incoming-handoff "Continue" restores a connection through it). */
  grant(origin: string, family: Family): Promise<void>;
  notifier: Notifier;
  broadcast(): void;
}): LinkService {
  const hostName = nativeHostName(d.rdns);
  const contacts =
    d.vault.sealAppData && d.vault.openAppData
      ? encryptedContactStore(d.kv, { seal: (p) => d.vault.sealAppData!("contacts", p), open: (b) => d.vault.openAppData!("contacts", b) }, CONTACTS_KEY)
      : undefined;
  const link = new LinkService({
    platform: "extension",
    deviceName: () => browserName(),
    kv: d.kv,
    vault: d.vault,
    fetch: (...a) => fetch(...a),
    WebSocket: globalThis.WebSocket as never,
    ...(d.relayUrl ? { relayUrl: d.relayUrl } : {}),
    ...(d.syncUrl ? { syncUrl: d.syncUrl } : {}),
    sources: () => [...walletSources(d.kv), ...(contacts ? [contactsSource(contacts as never)] : [])],
    native: {
      connect: () => {
        const rt = browser.runtime as unknown as { connectNative?(name: string): NativePortLike };
        if (!rt.connectNative) throw new Error("native messaging unavailable");
        return new NativePortChannel(rt.connectNative(hostName));
      },
      // The page asked for the permission from the click; here we only check it was granted.
      requestPermission: async () => {
        try {
          return await browser.permissions.contains({ permissions: ["nativeMessaging"] });
        } catch {
          return false;
        }
      },
    },
    async grantOrigin(origin, families) {
      for (const f of families) await d.grant(origin, f);
    },
    onChange: () => d.broadcast(),
    onIncomingHandoff: (h) =>
      void d.notifier.show({ id: `handoff-${h.id}`, kind: "approval", title: new URL(h.origin).hostname, body: h.from ? `${h.from}` : h.url, route: "/settings/devices" }),
  });
  void link.init();
  void browser.alarms.create(LINK_SYNC_ALARM, { periodInMinutes: SYNC_MINUTES, delayInMinutes: 1 });
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === LINK_SYNC_ALARM) void link.syncNow().catch(() => undefined);
  });
  return link;
}

/** Bus handler: fills in which families the page's site is connected with before making a handoff link. */
export async function handleLink(link: LinkService, kv: KV, m: LinkRequest): Promise<unknown> {
  if (m.type === "linkHandoffCreate") {
    const origin = new URL(m.url).origin;
    const perms = (await kv.get<Permission[]>("clip/permissions")) ?? [];
    const families = [...new Set(perms.filter((p) => p.origin === origin).map((p) => p.family))];
    return link.handle({ ...m, families });
  }
  return link.handle(m);
}
