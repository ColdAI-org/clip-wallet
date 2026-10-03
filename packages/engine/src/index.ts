export { WalletEngine, DEFAULT_PREFS, KV_KEYS, APPROVAL_TTL_MS } from "./engine.js";
export { createEngineClient, createEngineFeaturesClient } from "./client.js";
export { PlatformService, PLATFORM_KEYS, BACKUP_PRF_INPUT, type PlatformDeps, type PlatformRequest, type CeremonyRunner } from "./platform.js";
// Feature service construction pulls in every swap/staking provider: import it from "@clip-wallet/engine/features".
export { MemoryKV, JsonKV, type KV, type StringStore } from "./kv.js";
export { EngineRequest, PrefsPatch, Envelope, type EngineResponseMap, type EngineRequestType } from "./messages.js";
export { PasskeyCeremonies, b64url, fromB64url, type CeremonyMeta } from "./passkey-ceremonies.js";
export {
  OneMaskConnector,
  WalletConnectAdapter,
  RoutePlannerAdapter,
  ReferencePriceFeed,
  NoNameResolver,
  KnownDappRegistry,
  type WalletConnectAdapterOptions,
} from "./adapters.js";
export { publicNetworks } from "./public-networks.js";
// Chain-package wiring (catalog, real modules) lives at "@clip-wallet/engine/wiring" so light hosts/tests skip it.
export type * from "./types.js";
