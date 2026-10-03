/** Helpers shared by the dApp-side modules (browser only; no Node Buffer). */

/** Placeholder mark (same as 1Mask's DEFAULT_ICON). Pass your brand icon in each module's options. */
export const CLIP_ICON =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9IiMxMTEiLz48dGV4dCB4PSIzMiIgeT0iNDQiIGZvbnQtc2l6ZT0iMzYiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmaWxsPSIjZmZmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5DPC90ZXh0Pjwvc3ZnPg==";

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
