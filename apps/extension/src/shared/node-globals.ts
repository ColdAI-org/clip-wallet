/** Ledger and Keystone libraries expect Node's Buffer as a global. Import first in every entry point. */
import { Buffer } from "buffer";
(globalThis as { Buffer?: unknown }).Buffer ??= Buffer;
