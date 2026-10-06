/**
 * Response bodies read with a hard size limit (audit PLG-02): a declared Content-Length over the limit is refused
 * before reading, and a streamed body is read chunk by chunk and cancelled (with the request aborted) as soon as it
 * passes the limit, so a plugin endpoint or a tarball URL can't make the wallet download or buffer more than that.
 * Platforms whose fetch has no streaming body (React Native) fall back to the Content-Length check and a check of
 * what was read.
 */

/** Thrown when a body is (or says it is) larger than allowed. */
export class BodyTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`response body over ${limit} bytes`);
    this.name = "BodyTooLargeError";
  }
}

/**
 * The body as bytes, at most `maxBytes`. Throws BodyTooLargeError past the limit, after cancelling the stream and
 * calling `abort` (pass the AbortController's abort of the request, if it has one).
 */
export async function readBodyCapped(res: Response, maxBytes: number, abort?: () => void): Promise<Uint8Array> {
  const stop = (reader?: ReadableStreamDefaultReader<Uint8Array>): never => {
    try {
      abort?.();
    } catch {
      /* already settled */
    }
    void reader?.cancel().catch(() => {});
    if (!reader) void streamOf(res)?.cancel().catch(() => {});
    throw new BodyTooLargeError(maxBytes);
  };
  const declared = declaredLength(res);
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared) > maxBytes) stop();

  const body = streamOf(res);
  if (!body) {
    const all = new Uint8Array(await res.arrayBuffer());
    if (all.length > maxBytes) stop();
    return all;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > maxBytes) stop(reader);
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** The body as UTF-8 text, at most `maxBytes` bytes of it (see readBodyCapped). */
export async function readTextCapped(res: Response, maxBytes: number, abort?: () => void): Promise<string> {
  if (streamOf(res)) return new TextDecoder().decode(await readBodyCapped(res, maxBytes, abort));
  // No streaming body (React Native's fetch): the declared length first, then what arrived.
  const declared = declaredLength(res);
  const tooLarge = () => {
    try {
      abort?.();
    } catch {
      /* already settled */
    }
    return new BodyTooLargeError(maxBytes);
  };
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared) > maxBytes) throw tooLarge();
  const text = await res.text();
  if (text.length > maxBytes || new TextEncoder().encode(text).length > maxBytes) throw tooLarge();
  return text;
}

function declaredLength(res: Response): string | null {
  return typeof res.headers?.get === "function" ? res.headers.get("content-length") : null;
}

function streamOf(res: Response): ReadableStream<Uint8Array> | null {
  const body = (res as { body?: ReadableStream<Uint8Array> | null }).body;
  return body && typeof body.getReader === "function" ? body : null;
}
