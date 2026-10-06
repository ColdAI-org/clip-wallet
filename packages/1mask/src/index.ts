/**
 * @clip-wallet/1mask — shared types and helpers. Entry points: ./inpage, ./content, ./background, ./walletconnect.
 *
 * @module
 */
export * from "./shared/errors.js";
export * from "./shared/config.js";
export * from "./shared/compat.js";
export * from "./shared/networks.js";
export {
  DEFAULT_CHANNEL,
  PORT_NAME,
  METHOD_PROVIDER_STATE,
  METHOD_WS_STATE,
  MAX_MESSAGE_BYTES,
  type ExposedAccount,
  type EvmProviderState,
  type OneMaskEvent,
  type PageRequest,
  type PortRequest,
  type PortResponse,
  type PortEvent,
} from "./shared/protocol.js";
export * from "./shared/calls.js";
