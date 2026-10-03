/**
 * Ledger USB permission, from a page. `navigator.hid.requestDevice()` needs a user click and is not
 * available in the extension service worker; once granted, the background reopens the device with
 * `getDevices()`. https://developer.chrome.com/docs/extensions/how-to/web-platform/webhid
 */
import { HardwareErrors } from "../errors.js";

/** Ledger's USB vendor id (@ledgerhq/devices `ledgerUSBVendorId`). */
export const LEDGER_USB_VENDOR_ID = 0x2c97;

interface HidLike {
  getDevices(): Promise<{ vendorId: number }[]>;
  requestDevice(o: { filters: { vendorId: number }[] }): Promise<{ vendorId: number }[]>;
}

/**
 * Call from a click handler. Resolves once a Ledger is granted; no chooser if one already is (the
 * click's transient activation outlives the quick getDevices() check).
 */
export async function requestLedgerAccess(hid: HidLike | undefined = (globalThis.navigator as unknown as { hid?: HidLike } | undefined)?.hid): Promise<void> {
  if (!hid) throw HardwareErrors.noWebHid();
  const granted = await hid.getDevices().catch(() => []);
  if (granted.some((d) => d.vendorId === LEDGER_USB_VENDOR_ID)) return;
  const picked = await hid.requestDevice({ filters: [{ vendorId: LEDGER_USB_VENDOR_ID }] }).catch((e: unknown) => {
    throw HardwareErrors.notPicked(e);
  });
  if (!picked.length) throw HardwareErrors.notPicked();
}
