/** What the Linked devices screens see (plain data, no secrets). Type-only import for packages/ui and apps/mobile. */

export type LinkPlatform = "extension" | "desktop" | "mobile";
export type LinkPurpose = "signer" | "device-add" | "desktop";

export interface LinkedDeviceView {
  id: string;
  name: string;
  platform: LinkPlatform | string;
  /** "signer": this pairing lets one device sign for the other; "desktop": the local Clip Desktop link. */
  purpose: LinkPurpose;
  /** True when THIS device holds the keys for the pairing (desktop app, phone). */
  servesRequests: boolean;
  pairedAt: number;
  lastSeenAt?: number;
  online: boolean;
}

export type PairingState = "waiting" | "connecting" | "compare" | "confirming" | "password" | "transferring" | "done" | "failed";

export interface PairingView {
  id: string;
  purpose: LinkPurpose;
  /** Present on the device that shows the QR. */
  uri?: string;
  state: PairingState;
  /** "123456" (shown as "123 456"), once both keys are in. */
  sas?: string;
  peerName?: string;
  /** device-add: which side this is. */
  direction?: "send" | "receive";
  error?: { code: string; userMessage: string };
}

export interface WaitingRequestView {
  id: string;
  origin: string;
  kind: "connect" | "request";
  title?: string;
  lines?: { label: string; value: string }[];
  blind?: boolean;
  since: number;
}

export interface SyncStatusView {
  available: boolean;
  enabled: boolean;
  lastSyncAt?: number;
  error?: string;
}

export interface SignerModeView {
  /** "local": this device's vault signs. Otherwise the id of the device that signs. */
  deviceId: string | null;
  deviceName?: string;
  online: boolean;
  waiting: WaitingRequestView[];
}

export interface HandoffView {
  id: string;
  url: string;
  origin: string;
  /** Made by a device with this same wallet (the token opened). */
  verified: boolean;
  families: string[];
  from?: string;
  at: number;
}

export interface LinkStatusView {
  platform: LinkPlatform;
  devices: LinkedDeviceView[];
  sync: SyncStatusView;
  signer: SignerModeView;
  pairings: PairingView[];
  handoffs: HandoffView[];
  capabilities: {
    /** The relay is configured (phone pairing, moving a wallet). */
    relay: boolean;
    /** This build can talk to Clip Desktop (extension with native messaging; desktop app). */
    desktop: boolean;
    sync: boolean;
  };
}
