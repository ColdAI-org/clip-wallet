/**
 * Page-side SocialClient over the wallet bus (messages are SOCIAL_REQUESTS from @clip-wallet/social, merged into
 * shared/messages.ts). New file from the "social" stream.
 */
import { createSocialClient, type SocialClient } from "@clip-wallet/ui";
import { browser } from "wxt/browser";
import { Envelope } from "./messages";

class SocialBusError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly code: string,
  ) {
    super(`${code}: ${userMessage}`);
  }
}

export type SocialTransport = (msg: unknown) => Promise<unknown>;

const runtimeTransport: SocialTransport = (msg) => browser.runtime.sendMessage(msg);

/** Asks for the optional "notifications" permission (must run in a page, from a click). */
async function requestNotificationPermission(): Promise<boolean> {
  try {
    return await browser.permissions.request({ permissions: ["notifications"] });
  } catch {
    return false;
  }
}

export function createSocialBusClient(transport: SocialTransport = runtimeTransport): SocialClient {
  return createSocialClient(
    async (msg) => {
      let raw: unknown;
      try {
        raw = await transport(msg);
      } catch {
        throw new SocialBusError("The wallet is waking up. Try again in a moment.", "bus/unavailable");
      }
      const env = Envelope.safeParse(raw);
      if (!env.success) throw new SocialBusError("Something went wrong. Please try again.", "bus/bad-reply");
      if (!env.data.ok) throw new SocialBusError(env.data.error.userMessage, env.data.error.code);
      return env.data.data;
    },
    { requestNotificationPermission },
  );
}
