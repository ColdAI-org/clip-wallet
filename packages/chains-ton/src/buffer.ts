/**
 * @ton/core and @ton/ton use Node's global `Buffer`. Browsers and MV3 service workers don't have one, so this
 * installs the `buffer` package's implementation when (and only when) it is missing. Imported first by index.ts.
 */
import { Buffer as BufferPolyfill } from "buffer";

const g = globalThis as { Buffer?: unknown };
if (typeof g.Buffer === "undefined") g.Buffer = BufferPolyfill;
