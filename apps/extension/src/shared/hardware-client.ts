/** Page-side hardware wallet client (Ledger, Keystone) over the wallet bus. */
import type { FullHardwareClient } from "@clip-wallet/ui";
import { browser } from "wxt/browser";
import { BusError } from "./bus";
import { Envelope, type Request, type RequestType, type ResponseMap } from "./messages";

async function call<T extends RequestType>(msg: Extract<Request, { type: T }>): Promise<ResponseMap[T]> {
  const env = Envelope.safeParse(await browser.runtime.sendMessage(msg).catch(() => undefined));
  if (!env.success) throw new BusError("The wallet is waking up. Try again in a moment.", "bus/unavailable");
  if (!env.data.ok) throw new BusError(env.data.error.userMessage, env.data.error.code);
  return env.data.data as ResponseMap[T];
}

export const hardwareClient: FullHardwareClient = {
  ledgerAccounts: (family, start, count, pathStyle) => call({ type: "hwLedgerAccounts", family, start, count, pathStyle }),
  keystoneImport: (ur) => call({ type: "hwKeystoneImport", ur }),
  keystoneAccounts: (family, start, count, pathStyle) => call({ type: "hwKeystoneAccounts", family, start, count, pathStyle }),
  addAccounts: (ids) => call({ type: "hwAddAccounts", ids }),
  listAccounts: () => call({ type: "hwListAccounts" }),
  renameAccount: (id, label) => call({ type: "hwRenameAccount", id, label }),
  forgetDevice: (kind, fingerprint) => call({ type: "hwForgetDevice", kind, fingerprint }),
  setActive: (family, accountId) => call({ type: "hwSetActive", family, accountId }),
  keystoneAnswer: (id, ur) => call({ type: "hwKeystoneAnswer", id, ur }),
  hardwareCancel: (id) => call({ type: "hwCancel", id }),
};
