/**
 * @clip-wallet/hardware/qr — the browser-side half of Keystone support (camera + animated UR), with no
 * Ledger or Keystone SDK code, so UI pages can import it without pulling in device libraries.
 *
 * @module
 */
export { AnimatedUr, UrCollector, WrongUrType, UR, DEFAULT_FRAGMENT, decodeSingle, urFromJson, urToJson, type ScanProgress, type UrJson } from "../keystone/ur.js";
export { startQrScanner, decodeImageData, type QrScanner, type ScanOptions } from "./scanner.js";
export { requestLedgerAccess, LEDGER_USB_VENDOR_ID } from "./webhid.js";
