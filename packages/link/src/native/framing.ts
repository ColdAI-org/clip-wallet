/**
 * Native-messaging framing: "Each message is serialized using JSON, UTF-8 encoded and is preceded with 32-bit
 * message length in native byte order" (https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging;
 * Firefox and Edge use the same). Messages from the host to the browser may be at most 1 MB. Native byte order is
 * little-endian on every platform Clip Desktop ships (x64, arm64). The desktop IPC socket reuses the same framing.
 */
export const MAX_TO_BROWSER = 1024 * 1024;
/** We never need big messages from the browser either; refuse anything absurd before allocating it. */
export const MAX_FROM_BROWSER = 8 * 1024 * 1024;

export function encodeFrame(value: unknown, max = MAX_TO_BROWSER): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(value));
  if (body.length > max) throw new RangeError(`native message too large (${body.length} bytes)`);
  const out = new Uint8Array(4 + body.length);
  new DataView(out.buffer).setUint32(0, body.length, true);
  out.set(body, 4);
  return out;
}

/** Incremental decoder for a byte stream (stdin, a socket). Throws on an oversized or non-JSON frame. */
export class FrameDecoder {
  private buf = new Uint8Array(0);
  constructor(private readonly max = MAX_FROM_BROWSER) {}

  push(chunk: Uint8Array): unknown[] {
    const next = new Uint8Array(this.buf.length + chunk.length);
    next.set(this.buf);
    next.set(chunk, this.buf.length);
    this.buf = next;
    const out: unknown[] = [];
    while (this.buf.length >= 4) {
      const len = new DataView(this.buf.buffer, this.buf.byteOffset, 4).getUint32(0, true);
      if (len > this.max) throw new RangeError("native message too large");
      if (this.buf.length < 4 + len) break;
      const body = this.buf.subarray(4, 4 + len);
      out.push(JSON.parse(new TextDecoder().decode(body)));
      this.buf = this.buf.slice(4 + len);
    }
    return out;
  }
}
