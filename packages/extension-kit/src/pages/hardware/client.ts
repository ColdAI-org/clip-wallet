/**
 * Page-side hardware wallet client (Ledger, Keystone). Device I/O runs here, in the page: listing accounts
 * on "Connect a hardware wallet", the Keystone QR answers, cancelling a device step. The background stores
 * the accounts the user picks and verifies every signature (hardware-host.ts).
 */
import { HardwareErrors, type HardwareAccount } from "@clip-wallet/hardware/core";
import type { FullHardwareClient, HardwareAccountView } from "@clip-wallet/ui";
import { browser } from "wxt/browser";
import { BusError } from "../../shared/bus";
import { hardwareAccountView } from "../../shared/hardware-job";
import { Envelope, type Request, type RequestType, type ResponseMap } from "../../shared/messages";
import { cancelDevice, keystone, ledger, loadHardware } from "./devices";

export async function call<T extends RequestType>(msg: Extract<Request, { type: T }>): Promise<ResponseMap[T]> {
  const env = Envelope.safeParse(await browser.runtime.sendMessage(msg).catch(() => undefined));
  if (!env.success) throw new BusError("The wallet is waking up. Try again in a moment.", "bus/unavailable");
  if (!env.data.ok) throw new BusError(env.data.error.userMessage, env.data.error.code);
  return env.data.data as ResponseMap[T];
}

/** Accounts the user was just shown on "Connect a hardware wallet"; addAccounts sends these. */
const seen = new Map<string, HardwareAccount>();
function shown(list: HardwareAccount[]): HardwareAccountView[] {
  for (const a of list) seen.set(a.id, a);
  return list.map(hardwareAccountView);
}

const KEYSTONE_PREFIX = { evm: "m/44'/60'", solana: "m/44'/501'", bitcoin: "m/84'" } as const;

export const hardwareClient: FullHardwareClient = {
  ledgerAccounts: async (family, start, count, pathStyle) => shown(await (await ledger()).listAccounts(family, start, count, { pathStyle })),
  keystoneImport: async (ur) => {
    const [{ urFromJson }, { signer }] = await Promise.all([loadHardware(), keystone()]);
    const sync = await signer.importSync(urFromJson(ur));
    const families = (["evm", "solana", "bitcoin"] as const).filter((f) => sync.keys.some((k) => k.path.startsWith(KEYSTONE_PREFIX[f])));
    return { fingerprint: sync.fingerprint, families };
  },
  keystoneAccounts: async (family, start, count, pathStyle) => shown(await (await keystone()).signer.listAccounts(family, start, count, { pathStyle })),
  addAccounts: async (ids) => {
    const accounts = ids.map((x) => seen.get(x)).filter((a): a is HardwareAccount => !!a);
    if (accounts.length !== ids.length) throw HardwareErrors.unknownAccount();
    await call({ type: "hwAddAccounts", accounts: accounts as Extract<Request, { type: "hwAddAccounts" }>["accounts"] });
  },
  listAccounts: () => call({ type: "hwListAccounts" }),
  renameAccount: (id, label) => call({ type: "hwRenameAccount", id, label }),
  forgetDevice: async (kind, fingerprint) => {
    await call({ type: "hwForgetDevice", kind, fingerprint });
    if (kind === "keystone") await (await keystone()).signer.forget(fingerprint);
  },
  setActive: (family, accountId) => call({ type: "hwSetActive", family, accountId }),
  keystoneAnswer: async (id, ur) => {
    const { bridge } = await keystone();
    bridge.answer(id, ur);
  },
  hardwareCancel: async (id) => {
    await cancelDevice(id);
    await call({ type: "hwCancel", id });
  },
};
