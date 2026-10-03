import { ClipError } from "@clip-wallet/core";

export const DEFAULT_TIMEOUT_MS = 6000;

/** GET JSON with a timeout. 404 → null (name not found); other failures → ClipError (service down). */
export async function getJson<T>(f: typeof fetch, url: string, service: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{ status: number; body: T | null }> {
  let res: Response;
  try {
    res = await f(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new ClipError(`We couldn't look up that name right now. Paste their address instead, or try again.`, `names/${service}-unreachable`, e);
  }
  if (res.status === 404) return { status: 404, body: null };
  if (res.status >= 500) throw new ClipError(`We couldn't look up that name right now. Paste their address instead, or try again.`, `names/${service}-unavailable`);
  let body: T | null = null;
  try {
    body = (await res.json()) as T;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}
