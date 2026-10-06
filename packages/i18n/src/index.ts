/**
 * @clip-wallet/i18n — the wallet's translation layer. Zero dependencies: messages are a small ICU subset
 * (message.ts) and everything locale-specific (plurals, numbers, currencies, relative time) comes from the
 * platform's Intl. React bindings: "@clip-wallet/i18n/react".
 *
 * @module
 */
export * from "./locales.js";
export { formatMessage, parseMessage, messageArguments, messageTags, MessageSyntaxError, type MessageValues } from "./message.js";
export * from "./numbers.js";
export * from "./translator.js";
export { formatMsg, type MsgLike } from "./msg.js";
