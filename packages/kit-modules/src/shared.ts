/** Helpers shared by the dApp-side modules (browser only; no Node Buffer). */

/** The Clip Wallet mark (same as 1Mask's DEFAULT_ICON, brand/clip-mark.svg). Pass your brand icon in each module's options. */
export const CLIP_ICON =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiB2aWV3Qm94PSIwIDAgMTI4IDEyOCI+CiAgPHRpdGxlPkNsaXAgV2FsbGV0PC90aXRsZT4KICA8cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgcng9IjMwIiBmaWxsPSIjRkYzQzAwIi8+CiAgPGcgZmlsbD0iI0ZGRkZGRiIgc3Ryb2tlPSIjRkZGRkZGIiBzdHJva2Utd2lkdGg9IjQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDY0IDY0KSBza2V3WCgtNikgdHJhbnNsYXRlKC02NCAtNjQpIj48cGF0aCBkPSJNNzIgMThDNDYgMzAgMzIgNTAgMzIgNzJjMCA3IDEgMTIgMyAxNmgzN3oiLz48cGF0aCBkPSJNODQgNDBjMTAgMTIgMTQgMjYgMTMgNDAtNCA0LTkgNy0xMyA4eiIvPjxwYXRoIGQ9Ik0yNCA5OWg4MmMtNiA3LTE1IDExLTI2IDExSDQ4Yy0xMSAwLTE5LTQtMjQtMTF6Ii8+PC9nPgo8L3N2Zz4K";

export function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Reads `window[globalKey][family]` if it is a Clip provider. */
export function injected<T>(globalKey: string, family: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  const p = (window as unknown as Record<string, Record<string, unknown> | undefined>)[globalKey]?.[family] as { isClipWallet?: boolean } | undefined;
  return p && p.isClipWallet ? (p as T) : undefined;
}
