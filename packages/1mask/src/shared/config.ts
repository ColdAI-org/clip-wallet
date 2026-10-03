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

/** Plain placeholder mark: a rounded square with a "C". Override with the real brand icon. */
export const DEFAULT_ICON: DataUriIcon =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9IiMxMTEiLz48dGV4dCB4PSIzMiIgeT0iNDQiIGZvbnQtc2l6ZT0iMzYiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmaWxsPSIjZmZmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5DPC90ZXh0Pjwvc3ZnPg==";

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
  providers?: { evm?: boolean; solana?: boolean; bitcoin?: boolean; sui?: boolean; aptos?: boolean };
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
