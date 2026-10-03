import { z } from "zod";
import { FAMILIES, type Family } from "@clip-wallet/core";
import type { DiscoverFeed } from "./discover/service.js";
import type { NotificationSettings, PriceAlert } from "./notifications/types.js";
import type { AddressCheckView, ContactMatchView, ContactView, ContactsView, HandleLookupView, HandleView, QueuedApproval } from "./views.js";

/**
 * Bus messages for the social screens, zod-validated in the background like every other page message. The
 * integration step spreads SOCIAL_REQUESTS into the extension's `Request` union (and the engine's) and merges
 * SocialResponseMap into `ResponseMap` (docs/phase25/integration/social.md).
 */
const family = z.enum(FAMILIES as unknown as [string, ...string[]]);
const id = z.string().min(1).max(200);
const address = z.string().trim().min(1).max(200);
const contactInput = z
  .object({
    name: z.string().max(200),
    addresses: z.array(z.object({ family, address, label: z.string().max(100).optional() }).strict()).max(20),
    notes: z.string().max(1000).optional(),
    handle: z.string().max(40).optional(),
  })
  .strict();
const handle = z.string().trim().min(1).max(40);

export const SOCIAL_REQUESTS = [
  z.object({ type: z.literal("socContacts") }),
  z.object({ type: z.literal("socContactSave"), id: id.optional(), input: contactInput }),
  z.object({ type: z.literal("socContactDelete"), id }),
  z.object({ type: z.literal("socContactSearch"), query: z.string().max(200), family: family.optional() }),
  z.object({ type: z.literal("socAddressCheck"), address, family: family.optional() }),
  z.object({ type: z.literal("socDetectFamily"), address }),
  z.object({ type: z.literal("socHandleStatus") }),
  z.object({ type: z.literal("socHandleCheck"), handle }),
  z.object({ type: z.literal("socHandleLookup"), input: handle }),
  z.object({ type: z.literal("socHandleRegister"), handle }),
  z.object({ type: z.literal("socHandlePublish"), records: z.array(z.object({ family, address: z.string().max(200) }).strict()).min(1).max(16) }),
  z.object({ type: z.literal("socHandleRelease") }),
  z.object({ type: z.literal("socHandleReverse"), enabled: z.boolean() }),
  z.object({ type: z.literal("socNotifySettings") }),
  z.object({
    type: z.literal("socNotifySet"),
    enabled: z.boolean().optional(),
    kinds: z.partialRecord(z.enum(["incoming", "nft", "confirmed", "failed", "price", "approval"]), z.boolean()).optional(),
  }),
  z.object({
    type: z.literal("socAlertAdd"),
    assetKey: z.string().min(1).max(100),
    direction: z.enum(["above", "below"]),
    price: z.number().positive().max(1e12),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  z.object({ type: z.literal("socAlertArm"), id, armed: z.boolean() }),
  z.object({ type: z.literal("socAlertRemove"), id }),
  z.object({ type: z.literal("socNotifyTest") }),
  z.object({ type: z.literal("socDiscover"), refresh: z.boolean().optional() }),
] as const;

export const SocialRequest = z.discriminatedUnion("type", SOCIAL_REQUESTS);
export type SocialRequest = z.infer<typeof SocialRequest>;
export type SocialRequestType = SocialRequest["type"];

export function isSocialRequest(m: { type: string }): m is SocialRequest {
  return m.type.startsWith("soc");
}

export interface SocialResponseMap {
  socContacts: ContactsView;
  socContactSave: ContactView;
  socContactDelete: void;
  socContactSearch: ContactMatchView[];
  socAddressCheck: AddressCheckView;
  /** Families whose address rules accept this address (several for 0x addresses). */
  socDetectFamily: Family[];
  socHandleStatus: HandleView;
  socHandleCheck: { valid: boolean; available: boolean };
  socHandleLookup: HandleLookupView | null;
  socHandleRegister: QueuedApproval;
  socHandlePublish: QueuedApproval;
  socHandleRelease: QueuedApproval;
  socHandleReverse: QueuedApproval;
  socNotifySettings: NotificationSettings;
  socNotifySet: NotificationSettings;
  socAlertAdd: PriceAlert;
  socAlertArm: void;
  socAlertRemove: void;
  socNotifyTest: void;
  socDiscover: DiscoverFeed;
}
