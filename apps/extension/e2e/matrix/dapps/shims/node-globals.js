// Node globals some dapp libraries still expect in the browser (as a dapp's bundler polyfills them).
import { Buffer } from "buffer";
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
if (!globalThis.process) globalThis.process = { env: {}, browser: true, version: "", versions: {}, nextTick: (f, ...a) => Promise.resolve().then(() => f(...a)) };
export { Buffer };
