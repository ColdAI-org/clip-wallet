/**
 * Page-side LinkClient over the wallet bus (LINK_REQUESTS from @clip-wallet/link, merged into shared/messages.ts).
 * New file from the r1/connect stream. Two things only a page can do happen here: asking for the optional
 * "nativeMessaging" permission from the click on "Use Clip Desktop", and reading the active tab for "Continue
 * this page on your phone" (activeTab, granted when the person opens the popup).
 */
import { createLinkClient, type LinkClient } from "@clip-wallet/ui";
import { browser } from "wxt/browser";
import { CHANGE_EVENT, Envelope } from "./messages";

class LinkBusError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly code: string,
  ) {
    super(`${code}: ${userMessage}`);
  }
}

export type LinkTransport = (msg: unknown) => Promise<unknown>;

export function createLinkBusClient(transport: LinkTransport = (m) => browser.runtime.sendMessage(m)): LinkClient {
  const call = async (msg: unknown) => {
    let raw: unknown;
    try {
      raw = await transport(msg);
    } catch {
      throw new LinkBusError("The wallet is waking up. Try again in a moment.", "bus/unavailable");
    }
    const env = Envelope.safeParse(raw);
    if (!env.success) throw new LinkBusError("Something went wrong. Please try again.", "bus/bad-reply");
    if (!env.data.ok) throw new LinkBusError(env.data.error.userMessage, env.data.error.code);
    return env.data.data;
  };
  const base = createLinkClient(call, {
    async currentPage() {
      try {
        const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
        const url = tab?.url;
        return url && url.startsWith("https://") ? { url, families: [] } : null;
      } catch {
        return null;
      }
    },
    openUrl(url) {
      if (url.startsWith("https://")) void browser.tabs.create({ url });
    },
    onChange(cb) {
      const l = (m: unknown) => {
        if (m && typeof m === "object" && (m as { event?: string }).event === CHANGE_EVENT) cb();
      };
      browser.runtime.onMessage.addListener(l);
      return () => browser.runtime.onMessage.removeListener(l);
    },
  });
  return {
    ...base,
    async desktopPair() {
      // Must run in the page, from the click (permissions.request needs a user gesture).
      try {
        await browser.permissions.request({ permissions: ["nativeMessaging"] as never });
      } catch {
        /* the background says plainly if it wasn't granted */
      }
      return base.desktopPair();
    },
  };
}
