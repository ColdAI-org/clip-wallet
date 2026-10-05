// Ledger's transport and Keystone's UR libraries expect Node's Buffer (same shim as the extension's node-globals).
import { Buffer } from "buffer";

const g = globalThis as { Buffer?: typeof Buffer; global?: typeof globalThis };
g.Buffer ??= Buffer;
g.global ??= globalThis;
