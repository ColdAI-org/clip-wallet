/**
 * One Ledger connection at a time, one command at a time. WebHID by default
 * (@ledgerhq/hw-transport-webhid); tests inject a replay transport (@ledgerhq/hw-transport-mocker).
 */
import type Transport from "@ledgerhq/hw-transport";
import { HardwareErrors, ledgerError, type LedgerAppName } from "../errors.js";

export type TransportFactory = () => Promise<Transport>;

/**
 * Pairing needs a click (navigator.hid.requestDevice), so `create()` must run from a page the user
 * clicked in. Later sessions (background service worker, Chrome 117+) reopen an already-granted
 * device with `openConnected()`. Imported lazily so nothing touches navigator.hid until it is used.
 */
export const webHidTransport: TransportFactory = async () => {
  const nav = (globalThis as { navigator?: { hid?: unknown } }).navigator;
  if (!nav?.hid) throw HardwareErrors.noWebHid();
  const { default: TransportWebHID } = await import("@ledgerhq/hw-transport-webhid");
  const reopened = await TransportWebHID.openConnected().catch(() => null);
  return reopened ?? (await TransportWebHID.create());
};

/** The app open on the device, from the dashboard-level GET_APP_AND_VERSION (CLA 0xB0, INS 0x01). */
export async function appAndVersion(transport: Transport): Promise<{ name: string; version: string }> {
  const r = await transport.send(0xb0, 0x01, 0x00, 0x00);
  let i = 0;
  if (r[i++] !== 0x01) throw new Error("bad GET_APP_AND_VERSION format");
  const nameLen = r[i++]!;
  const name = r.subarray(i, i + nameLen).toString("ascii");
  i += nameLen;
  const verLen = r[i++]!;
  const version = r.subarray(i, i + verLen).toString("ascii");
  return { name, version };
}

/** Device app names (as GET_APP_AND_VERSION reports them) accepted for each app we use. */
export const APP_NAMES: Record<LedgerAppName, string[]> = {
  Ethereum: ["Ethereum"],
  Solana: ["Solana"],
  Bitcoin: ["Bitcoin"],
  "Bitcoin Test": ["Bitcoin Test"],
  Hedera: ["Hedera"],
};

export class LedgerConnection {
  private transport: Transport | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly factory: TransportFactory = webHidTransport) {}

  /** Runs `fn` with the right app open, serialised, mapping every failure to plain words. */
  run<T>(app: LedgerAppName, fn: (t: Transport) => Promise<T>): Promise<T> {
    const next = this.queue.then(
      () => this.exec(app, fn),
      () => this.exec(app, fn),
    );
    this.queue = next.catch(() => undefined);
    return next;
  }

  async close(): Promise<void> {
    const t = this.transport;
    this.transport = null;
    await t?.close().catch(() => undefined);
  }

  private async exec<T>(app: LedgerAppName, fn: (t: Transport) => Promise<T>): Promise<T> {
    let t: Transport;
    try {
      t = this.transport ??= await this.factory();
    } catch (e) {
      this.transport = null;
      throw ledgerError(e, app);
    }
    try {
      const open = await appAndVersion(t);
      if (open.name === "BOLOS") throw HardwareErrors.openApp(app);
      if (!APP_NAMES[app].includes(open.name)) throw HardwareErrors.openApp(app);
      return await fn(t);
    } catch (e) {
      const err = ledgerError(e, app);
      if (err.code === "hw/disconnected") await this.close();
      throw err;
    }
  }
}
