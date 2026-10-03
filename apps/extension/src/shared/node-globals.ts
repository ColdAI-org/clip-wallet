/**
 * Node globals some wallet libraries expect. Import first in every entry point.
 *  - Buffer: Ledger and Keystone libraries.
 *  - process: readable-stream v2 (pulled in by the hardware libraries) reads process.browser/version/nextTick
 *    when it loads; a service worker has no `process`, so the background would die before main().
 */
import { Buffer } from "buffer";

const g = globalThis as { Buffer?: unknown; process?: unknown };
g.Buffer ??= Buffer;
g.process ??= {
  browser: true,
  env: {},
  version: "",
  versions: {},
  nextTick: (fn: (...a: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => fn(...args)),
};
