/**
 * Settings → Linked devices' door to the background (LinkService in @clip-wallet/link). Implemented over the
 * extension bus and in-process on mobile; a plain fake in tests. Nothing here carries key material: pairing
 * codes are public, passwords go straight to the vault for one transfer. Views are type-only imports.
 */
import type { HandoffView, LinkStatusView, PairingView } from "@clip-wallet/link/views";

export type { HandoffView, LinkStatusView, LinkedDeviceView, PairingView, PairingState, SignerModeView, SyncStatusView, WaitingRequestView } from "@clip-wallet/link/views";

export interface LinkClient {
  status(): Promise<LinkStatusView>;
  pairStart(p: { purpose: "signer" | "device-add"; direction?: "send" | "receive" }): Promise<PairingView>;
  pairScan(p: { uri: string; direction?: "send" | "receive" }): Promise<PairingView>;
  desktopPair(): Promise<PairingView>;
  pairConfirm(p: { id: string; match: boolean }): Promise<PairingView>;
  pairCancel(p: { id: string }): Promise<void>;
  transferSend(p: { id: string; password: string }): Promise<PairingView>;
  transferReceive(p: { id: string; password: string }): Promise<PairingView>;
  deviceRemove(p: { id: string }): Promise<void>;
  useSigner(p: { deviceId: string | null }): Promise<void>;
  syncSet(p: { enabled: boolean }): Promise<void>;
  syncNow(): Promise<void>;
  syncDelete(): Promise<void>;
  handoffCreate(p: { url: string; families: string[] }): Promise<{ link: string }>;
  handoffAccept(p: { id: string }): Promise<{ url: string }>;
  handoffDismiss(p: { id: string }): Promise<void>;
  /** The page the person is on (extension: the active tab), to offer "Continue this page on your phone". */
  currentPage?(): Promise<{ url: string; families: string[] } | null>;
  /** Opens a URL (a continued page). */
  openUrl?(url: string): void;
  /** Re-fetch when the background says something changed. */
  onChange?(cb: () => void): () => void;
}

/** Builds a LinkClient from a request function (the bus or an in-process LinkService.handle). */
export function createLinkClient(call: (msg: { type: string } & Record<string, unknown>) => Promise<unknown>, extra: Pick<LinkClient, "currentPage" | "openUrl" | "onChange"> = {}): LinkClient {
  const c = <T,>(type: string, p: Record<string, unknown> = {}) => call({ type, ...p }) as Promise<T>;
  return {
    status: () => c("linkStatus"),
    pairStart: (p) => c("linkPairStart", p),
    pairScan: (p) => c("linkPairScan", p),
    desktopPair: () => c("linkDesktopPair"),
    pairConfirm: (p) => c("linkPairConfirm", p),
    pairCancel: (p) => c("linkPairCancel", p),
    transferSend: (p) => c("linkTransferSend", p),
    transferReceive: (p) => c("linkTransferReceive", p),
    deviceRemove: (p) => c("linkDeviceRemove", p),
    useSigner: (p) => c("linkUseSigner", p),
    syncSet: (p) => c("linkSyncSet", p),
    syncNow: () => c("linkSyncNow"),
    syncDelete: () => c("linkSyncDelete"),
    handoffCreate: (p) => c("linkHandoffCreate", p),
    handoffAccept: (p) => c("linkHandoffAccept", p),
    handoffDismiss: (p) => c("linkHandoffDismiss", p),
    ...extra,
  };
}

export type { HandoffView as LinkHandoffView };
