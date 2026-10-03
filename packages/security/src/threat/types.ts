import type { DappRequest, DecodedRequest, Network, Warning } from "@clip-wallet/core";
import type { Unavailable } from "../views.js";

/** The Warning codes threat intel may raise (existing and Phase 2.5 additive ones). */
export type ThreatCode = Extract<Warning["code"], "phishing-site" | "malicious-transaction" | "address-poisoning" | "known-scam" | "new-recipient">;

export interface ThreatFinding {
  level: Warning["level"];
  code: ThreatCode;
  message: string;
  /** Provider id ("metamask", "blockaid", "local"…). Kept for Advanced mode and tests; not shown by default. */
  source: string;
}

export interface TxCheckInput {
  request: DappRequest;
  decoded: DecodedRequest;
  network: Network;
  /** Your address on this network (only the Blockaid provider ever sends it anywhere, and only when enabled). */
  account: string;
  /** Where value goes (the "To" of a send). */
  recipients: string[];
  /** Every address the request touches: recipients, spenders, the contract called. */
  counterparties: string[];
}

export interface ProviderStatus {
  enabled: boolean;
  updatedAt?: number;
  entries?: number;
  unavailable?: Unavailable;
}

/**
 * A source of scam intelligence, consulted on connect (sites) and on decode (transactions).
 *
 * Privacy contract: a provider with `sendsUserData: false` must never send your addresses, the request or
 * the site you visit anywhere. List providers only DOWNLOAD whole lists and match on the device.
 */
export interface ThreatIntelProvider {
  readonly id: string;
  readonly name: string;
  /** One plain sentence for Settings → Security. */
  readonly privacy: string;
  readonly sendsUserData: boolean;
  status(): ProviderStatus;
  /** Load the last cached copy (fast, no network). */
  load?(): Promise<void>;
  /** Fetch a fresh copy if the cached one is stale (or always, with force). Keeps the last copy on failure. */
  refresh?(force?: boolean): Promise<void>;
  /** Synchronous lookups against what's loaded (for WalletConnect's isKnownScam and the revoker). */
  checkSiteSync?(host: string): ThreatFinding[];
  checkAddressSync?(address: string): ThreatFinding[];
  checkSite?(origin: string): Promise<ThreatFinding[]>;
  checkTransaction?(input: TxCheckInput): Promise<ThreatFinding[]>;
}
