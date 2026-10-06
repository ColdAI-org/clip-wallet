import type { Network } from "@clip-wallet/core";
import type { CompatibilityModeConfig } from "./compat.js";
import { DEFAULT_CHANNEL } from "./protocol.js";

export type DataUriIcon = `data:image/${"svg+xml" | "webp" | "png" | "gif"};base64,${string}`;

/**
 * Who the wallet says it is. Kit-built wallets pass their own identity so they announce themselves,
 * not "Clip Wallet".
 */
export interface WalletIdentity {
  /** Human name shown in wallet pickers. */
  name: string;
  /** Data URI (EIP-6963 requires an RFC-2397 data URI; Wallet Standard requires base64 svg/webp/png/gif). */
  icon: DataUriIcon;
  /** Reverse-DNS id for EIP-6963, e.g. "org.coldai.clipwallet". */
  rdns: string;
}

/** The Clip Wallet mark (brand/clip-mark.svg). Kit-built wallets override it with their own icon. */
export const DEFAULT_ICON: DataUriIcon =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiB2aWV3Qm94PSIwIDAgMTI4IDEyOCI+CiAgPHRpdGxlPkNsaXAgV2FsbGV0PC90aXRsZT4KICA8cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgcng9IjMwIiBmaWxsPSIjRkYzQzAwIi8+CiAgPGcgZmlsbD0iI0ZGRkZGRiIgc3Ryb2tlPSIjRkZGRkZGIiBzdHJva2Utd2lkdGg9IjQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDY0IDY0KSBza2V3WCgtNikgdHJhbnNsYXRlKC02NCAtNjQpIj48cGF0aCBkPSJNNzIgMThDNDYgMzAgMzIgNTAgMzIgNzJjMCA3IDEgMTIgMyAxNmgzN3oiLz48cGF0aCBkPSJNODQgNDBjMTAgMTIgMTQgMjYgMTMgNDAtNCA0LTkgNy0xMyA4eiIvPjxwYXRoIGQ9Ik0yNCA5OWg4MmMtNiA3LTE1IDExLTI2IDExSDQ4Yy0xMSAwLTE5LTQtMjQtMTF6Ii8+PC9nPgo8L3N2Zz4K";

export const DEFAULT_IDENTITY: WalletIdentity = {
  name: "Clip Wallet",
  icon: DEFAULT_ICON,
  rdns: "org.coldai.clipwallet",
};

export interface InpageConfig {
  identity?: Partial<WalletIdentity>;
  /** postMessage channel shared with the content script. Use a per-build random value. */
  channel?: string;
  /** Public network registry (ids, names, chain ids). Never contains secrets. */
  networks: Network[];
  /** Also set window.ethereum (only if nothing else owns it). Default false: EIP-6963 only. */
  claimWindowEthereum?: boolean;
  /** Which providers to install. Default: all. */
  providers?: {
    evm?: boolean;
    solana?: boolean;
    bitcoin?: boolean;
    sui?: boolean;
    aptos?: boolean;
    near?: boolean;
    stellar?: boolean;
    tezos?: boolean;
    algorand?: boolean;
    /** networks87: Cosmos SDK (Keplr-compatible), TRON (TIP-1193/TIP-6963), Stacks (SIP-030/WBIP-004), Fuel (FuelConnector). */
    cosmos?: boolean;
    tron?: boolean;
    stacks?: boolean;
    fuel?: boolean;
    xrpl?: boolean;
    cardano?: boolean;
    substrate?: boolean;
    starknet?: boolean;
    ton?: boolean;
    /** Hedera extension discovery for @hashgraph/hedera-wallet-connect's DAppConnector (inpage/hedera.ts). */
    hedera?: boolean;
  };
  /** Also set legacy window.starknet (only if nothing owns it). Default false: window.starknet_<id> only. */
  claimWindowStarknet?: boolean;
  /**
   * TON Connect JS bridge: window[key].tonconnect. `appName` and `key` must equal the wallets-list entry's
   * app_name / bridge key (docs/listings/ton-connect.md). `features` = chains-ton `createTonModule().features`.
   */
  tonConnect?: {
    key: string;
    appName: string;
    appVersion: string;
    features: import("../inpage/ton.js").TonFeature[];
    walletInfo?: import("../inpage/ton.js").TonWalletInfo;
  };
  /** Global the NEAR/Stellar/Algorand providers hang off (window[globalKey].<family>). Default "clipwallet". */
  globalKey?: string;
  /**
   * The browser extension id (chrome.runtime.id). Beacon's wallet list and Hedera's DAppConnector address the wallet
   * by it. Default: identity.rdns.
   */
  beaconExtensionId?: string;
  /** Per-site compatibility mode. Typed stub, NOT implemented in v1. */
  compatibility?: CompatibilityModeConfig;
  /** Per-request timeout in the page, ms. Default 10 minutes (approvals can take a while). */
  requestTimeoutMs?: number;
}

const DATA_URI_RE = /^data:image\/(svg\+xml|webp|png|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const RDNS_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

export function resolveIdentity(partial?: Partial<WalletIdentity>): WalletIdentity {
  const id: WalletIdentity = { ...DEFAULT_IDENTITY, ...partial } as WalletIdentity;
  if (!id.name.trim()) throw new Error("1Mask: identity.name must not be empty");
  if (!DATA_URI_RE.test(id.icon)) throw new Error("1Mask: identity.icon must be a base64 data URI (svg/webp/png/gif)");
  if (!RDNS_RE.test(id.rdns)) throw new Error("1Mask: identity.rdns must be reverse-DNS, e.g. org.example.wallet");
  return id;
}

export function resolveChannel(channel?: string): string {
  return channel && channel.length > 0 ? channel : DEFAULT_CHANNEL;
}
