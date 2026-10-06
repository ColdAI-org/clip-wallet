/**
 * @clip-wallet/plugins — Clip Plugins: small, sandboxed extensions (the MetaMask Snaps idea, narrower).
 *
 * v1 capabilities: transaction insights, name resolution, rate-limited notifications (+ optional network to
 * exact origins). A plugin can never sign, never see the recovery phrase, keys, the vault, storage or chrome.*;
 * everything it says is labelled "from <plugin>". Off by default; only in Advanced mode. See README.md.
 *
 * @module
 */
export * from "./manifest.js";
export * from "./messages.js";
export * from "./npm.js";
export * from "./host.js";
export * from "./registry.js";
export * from "./service.js";
export { SANDBOX_CSP, SANDBOX_MANIFEST, SANDBOX_PAGE, iframeChannelFactory, type Channel, type ChannelFactory } from "./sandbox.js";
export { createSandboxRuntime, type RuntimeEnv, type SesApi } from "./runtime.js";
export { BodyTooLargeError, readBodyCapped, readTextCapped } from "./body.js";
