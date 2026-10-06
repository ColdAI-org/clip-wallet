/**
 * Linked-devices requests on the wallet bus (merged into the extension's shared/messages.ts and the engine's
 * EngineRequest by the integration step; docs/r1/integration/connect.md). Zod-validated before LinkService sees them.
 *
 * @module
 */
import { z } from "zod";
import type { HandoffView, LinkStatusView, PairingView } from "./views.js";

const id = z.string().min(1).max(100);
const password = z.string().min(1).max(1024);

export const LINK_REQUESTS = [
  z.object({ type: z.literal("linkStatus") }),
  z.object({ type: z.literal("linkPairStart"), purpose: z.enum(["signer", "device-add"]), direction: z.enum(["send", "receive"]).optional() }),
  z.object({ type: z.literal("linkPairScan"), uri: z.string().min(1).max(1000), direction: z.enum(["send", "receive"]).optional() }),
  z.object({ type: z.literal("linkDesktopPair") }),
  z.object({ type: z.literal("linkPairConfirm"), id, match: z.boolean() }),
  z.object({ type: z.literal("linkPairCancel"), id }),
  z.object({ type: z.literal("linkTransferSend"), id, password }),
  z.object({ type: z.literal("linkTransferReceive"), id, password }),
  z.object({ type: z.literal("linkDeviceRemove"), id }),
  z.object({ type: z.literal("linkDeviceRename"), id, name: z.string().min(1).max(60) }),
  z.object({ type: z.literal("linkUseSigner"), deviceId: id.nullable() }),
  z.object({ type: z.literal("linkSyncSet"), enabled: z.boolean() }),
  z.object({ type: z.literal("linkSyncNow") }),
  z.object({ type: z.literal("linkSyncDelete") }),
  z.object({ type: z.literal("linkHandoffCreate"), url: z.string().url().max(2000).startsWith("https://"), families: z.array(z.string().max(20)).max(20) }),
  z.object({ type: z.literal("linkHandoffSend"), deviceId: id, url: z.string().url().max(2000).startsWith("https://"), families: z.array(z.string().max(20)).max(20) }),
  z.object({ type: z.literal("linkHandoffOpen"), link: z.string().min(1).max(5000) }),
  z.object({ type: z.literal("linkHandoffAccept"), id }),
  z.object({ type: z.literal("linkHandoffDismiss"), id }),
] as const;

export const LinkRequest = z.discriminatedUnion("type", LINK_REQUESTS);
export type LinkRequest = z.infer<typeof LinkRequest>;
export type LinkRequestType = LinkRequest["type"];

/** Every link request type starts with "link" (no other bus message does). */
export function isLinkRequest(m: { type: string }): m is LinkRequest {
  return m.type.startsWith("link");
}

export interface LinkResponseMap {
  linkStatus: LinkStatusView;
  linkPairStart: PairingView;
  linkPairScan: PairingView;
  linkDesktopPair: PairingView;
  linkPairConfirm: PairingView;
  linkPairCancel: void;
  linkTransferSend: PairingView;
  linkTransferReceive: PairingView;
  linkDeviceRemove: void;
  linkDeviceRename: void;
  linkUseSigner: void;
  linkSyncSet: void;
  linkSyncNow: void;
  linkSyncDelete: void;
  linkHandoffCreate: { link: string };
  linkHandoffSend: void;
  linkHandoffOpen: HandoffView;
  linkHandoffAccept: { url: string };
  linkHandoffDismiss: void;
}

/** Requests that work while the wallet is locked or empty (pairing a new device, receiving a wallet). */
export const LINK_LOCKED_OK: ReadonlySet<string> = new Set(["linkStatus", "linkPairStart", "linkPairScan", "linkPairConfirm", "linkPairCancel", "linkTransferReceive", "linkDesktopPair", "linkUseSigner", "linkDeviceRemove", "linkHandoffOpen", "linkHandoffDismiss"]);
