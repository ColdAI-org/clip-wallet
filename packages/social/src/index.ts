/**
 * @clip-wallet/social — address book, Clip handles, notifications and Discover. Holds no keys.
 * Hosts build a SocialService (service.ts); screens use the views (./views) over the message bus (./messages).
 */
export { SocialService, type SocialHost } from "./service.js";
export * from "./contacts/index.js";
export * from "./notifications/index.js";
export * from "./discover/index.js";
export * from "./handles/index.js";
export { SOCIAL_REQUESTS, SocialRequest, isSocialRequest, type SocialRequestType, type SocialResponseMap } from "./messages.js";
export type * from "./views.js";
