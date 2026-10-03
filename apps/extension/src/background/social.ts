/**
 * Social stream in the service worker: builds the SocialService (@clip-wallet/engine/social), shows its
 * notices with chrome.notifications, and polls on an alarm. New file from the "social" stream; main.ts calls
 * startSocial() (docs/phase25/integration/social.md).
 *
 * chrome.notifications: https://developer.chrome.com/docs/extensions/reference/api/notifications ("basic"
 * type; needs the "notifications" permission, requested at runtime as an optional permission when the user
 * turns notifications on). Polling: chrome.alarms, whose minimum period is 30 s since Chrome 120
 * (https://developer.chrome.com/docs/extensions/reference/api/alarms).
 */
import { browser } from "wxt/browser";
import { createSocial, type SocialHostDeps } from "@clip-wallet/engine/social";
import type { Notice, Notifier } from "@clip-wallet/social";

export const SOCIAL_POLL_ALARM = "clip-social-poll";
/** One poll a minute while the browser runs: balances, collectibles, activity, approvals and price alerts. */
const POLL_MINUTES = 1;

/** The slice of chrome.notifications / browser.notifications used here (present only once permission is granted). */
interface NotificationsApi {
  create(id: string, options: { type: "basic"; iconUrl: string; title: string; message: string; priority?: number }): Promise<string> | void;
  clear(id: string): Promise<boolean> | void;
  onClicked: { addListener(cb: (id: string) => void): void };
}

/** chrome.notifications, only once the user granted the optional permission. Clicking opens the wallet there. */
export function chromeNotifier(iconUrl: string): Notifier {
  const routes = new Map<string, string>();
  const api = () => (browser as unknown as { notifications?: NotificationsApi }).notifications;
  browser.permissions?.onAdded?.addListener(() => attachClick());
  let clickAttached = false;
  function attachClick() {
    const n = api();
    if (!n || clickAttached) return;
    clickAttached = true;
    n.onClicked.addListener((id: string) => {
      const route = routes.get(id) ?? "/";
      void browser.tabs.create({ url: browser.runtime.getURL(`/tab.html#${route}`) });
      void n.clear(id);
    });
  }
  attachClick();
  return {
    async show(notice: Notice) {
      const n = api();
      if (!n) return; // permission not granted (or revoked): stay silent
      attachClick();
      routes.set(notice.id, notice.route ?? "/");
      if (routes.size > 100) routes.delete(routes.keys().next().value!);
      await n.create(notice.id, { type: "basic", iconUrl, title: notice.title, message: notice.body, priority: notice.kind === "approval" ? 2 : 0 });
    },
  };
}

export function startSocial(deps: Omit<SocialHostDeps, "notifier" | "deviceLanguages"> & { iconUrl: string }) {
  const social = createSocial({
    ...deps,
    notifier: chromeNotifier(deps.iconUrl),
    deviceLanguages: () => (navigator.languages?.length ? navigator.languages : [navigator.language]),
  });
  void browser.alarms.create(SOCIAL_POLL_ALARM, { periodInMinutes: POLL_MINUTES, delayInMinutes: POLL_MINUTES });
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === SOCIAL_POLL_ALARM) void social.poll().catch(() => undefined);
  });
  return social;
}
