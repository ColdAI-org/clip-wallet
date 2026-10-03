/**
 * The device half of hardware wallets, in the page. Ledger (WebHID) and Keystone (camera, QR) need a page
 * anyway, so their libraries (~1.5 MB) load here, in their own chunk, the first time a hardware account
 * is connected or signs; the service worker never contains them.
 */
import type { KeystoneBridge, KeystoneSigner, LedgerSigner } from "@clip-wallet/hardware";
import type { HardwareKind, HardwareSigner, HardwareStorage, PendingExchangeView } from "@clip-wallet/hardware/core";
import { browser } from "wxt/browser";
import { AreaKV } from "../../shared/storage";

/** Same as the background's vault: Bitcoin testnet (a mainnet build would configure both). */
const BITCOIN_NETWORK = "testnet" as const;

let mod: Promise<typeof import("@clip-wallet/hardware")> | undefined;
export const loadHardware = () => (mod ??= import("@clip-wallet/hardware"));

/** Public data only (Keystone's synced public keys), in the same chrome.storage.local keys as before. */
const kv = new AreaKV(browser.storage.local);
const storage: HardwareStorage = { get: (k) => kv.get<string>(k), set: (k, v) => kv.set(k, v) };

const listeners = new Set<() => void>();
/** Fires when a Keystone exchange opens or closes in this page. */
export function onDeviceChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const emit = () => listeners.forEach((cb) => cb());

let ledgerP: Promise<LedgerSigner> | undefined;
let keystoneP: Promise<{ signer: KeystoneSigner; bridge: KeystoneBridge }> | undefined;
let keystoneNow: { signer: KeystoneSigner; bridge: KeystoneBridge } | undefined;

export const ledger = (): Promise<LedgerSigner> => (ledgerP ??= loadHardware().then((m) => new m.LedgerSigner({ bitcoinNetwork: BITCOIN_NETWORK })));

export const keystone = (): Promise<{ signer: KeystoneSigner; bridge: KeystoneBridge }> =>
  (keystoneP ??= loadHardware().then((m) => {
    const bridge = new m.KeystoneBridge(emit);
    return (keystoneNow = { bridge, signer: new m.KeystoneSigner({ channel: bridge, storage, bitcoinNetwork: BITCOIN_NETWORK }) });
  }));

export async function deviceSigner(kind: HardwareKind): Promise<HardwareSigner> {
  return kind === "ledger" ? ledger() : (await keystone()).signer;
}

/** The Keystone QR exchange open in this page for an approval, if any. */
export const keystoneExchange = (approvalId: string): PendingExchangeView | undefined => keystoneNow?.bridge.current(approvalId);

/** Stops a device step in this page: a pending Ledger exchange is aborted, a Keystone QR exchange cancelled. */
export async function cancelDevice(approvalId: string): Promise<void> {
  keystoneNow?.bridge.cancel(approvalId);
  // Nothing to close if the Ledger code never loaded.
  if (ledgerP) await (await ledgerP).close();
}
