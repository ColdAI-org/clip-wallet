import { b64url } from "@clip-wallet/backup-client/protocol";

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function hmacHex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
  return [...sig].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string compare (both sides are hashes of the same length in practice). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

/** Reads a JSON body of at most `max` bytes. */
export async function readJson<T>(req: Request, max = 8192): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > max) throw new HttpError(413, "too-large", "Request body too large.");
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, "too-large", "Request body too large.");
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return v as T;
  } catch {
    throw new HttpError(400, "bad-request", "Expected a JSON object.");
  }
}
