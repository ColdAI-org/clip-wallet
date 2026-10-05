/**
 * @clip-wallet/link: one wallet on every platform.
 *   - settings sync (end-to-end encrypted, per-record LWW with vector clocks)       sync/
 *   - pairing with QR / one-time code + 6-digit SAS, encrypted sessions            pairing/
 *   - a phone or Clip Desktop as the signer for the extension                       remote/, relay/, native/
 *   - adding this wallet to another device                                           transfer/
 *   - continue a dapp on another device                                              handoff/
 * Holds no seed or private key: X25519 / Ed25519 run in @clip-wallet/vault (LinkVault). Threat model: README.md.
 */
export * from "./keys.js";
export { b64url, fromB64url } from "./bytes.js";
export * from "./sync/records.js";
export * from "./sync/protocol.js";
export * from "./sync/client.js";
export * from "./sync/sources.js";
export { handleSync, MemorySyncStore, SyncHttpError, type SyncStore, type SyncRequest, type SyncServerDeps } from "./sync/server.js";
export * from "./pairing/channel.js";
export * from "./pairing/pairing.js";
export * from "./pairing/session.js";
export * from "./relay/protocol.js";
export * from "./relay/client.js";
export * from "./remote/protocol.js";
export * from "./remote/client.js";
export * from "./remote/server.js";
export * from "./remote/host.js";
export * from "./transfer/transfer.js";
export * from "./handoff/handoff.js";
export * from "./native/index.js";
export * from "./service/messages.js";
export * from "./service/views.js";
export * from "./service/service.js";
