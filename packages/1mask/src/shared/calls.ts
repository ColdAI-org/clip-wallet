/**
 * EIP-5792 (Wallet Call API, status Final) and ERC-7682 (auxiliaryFunds capability, Draft): the wire shapes 1Mask
 * accepts and answers, and the validation of `wallet_sendCalls` params. Sources, read 2026-10-05:
 *   https://eips.ethereum.org/EIPS/eip-5792   (ethereum/EIPS master, EIPS/eip-5792.md)
 *   https://eips.ethereum.org/EIPS/eip-7682   (ethereum/ERCs master, ERCS/erc-7682.md)
 *   https://docs.walletconnect.com/wallets/web/eip5792.md (capabilities in CAIP-25 sessionProperties/scopedProperties)
 *
 * Clip Wallet accounts are EOAs, so the `atomic` capability is `unsupported` on every chain: a batch runs as one
 * approval and then call by call, in order; `atomicRequired: true` is refused with 5760 as the spec says.
 */
import type { NetworkId } from "@clip-wallet/core";
import { ProviderRpcError, rpcError } from "./errors.js";

export const CALLS_METHODS = ["wallet_getCapabilities", "wallet_sendCalls", "wallet_getCallsStatus", "wallet_showCallsStatus"] as const;
export type CallsMethod = (typeof CALLS_METHODS)[number];
export const isCallsMethod = (m: string): m is CallsMethod => (CALLS_METHODS as readonly string[]).includes(m);

/** EIP-5792 and ERC-7682 error codes. */
export const CallsErrorCode = {
  UnsupportedCapability: 5700,
  UnsupportedChain: 5710,
  DuplicateId: 5720,
  UnknownBundle: 5730,
  BundleTooLarge: 5740,
  AtomicUpgradeRejected: 5750,
  AtomicityNotSupported: 5760,
  /** ERC-7682 */
  AuxiliaryFundsFailed: 5770,
  AuxiliaryAssetNotSupported: 5771,
  AuxiliaryFundsNotAvailable: 5772,
  InvalidRequiredAssets: 5773,
} as const;

export const callsError = (code: number, message: string) => new ProviderRpcError(code, message);

/** EIP-7528 native-asset placeholder, as ERC-7682 requires in `assets`. */
export const NATIVE_ASSET_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/** Highest batch Clip Wallet takes in one approval (5740 above it). */
export const MAX_CALLS = 10;
/** EIP-5792: ids are unique strings up to 4096 bytes (8194 characters with the 0x). */
export const MAX_ID_LENGTH = 8194;

export type Hex = `0x${string}`;

export interface SendCallsCall {
  to?: Hex;
  data: Hex;
  /** Hex quantity, "0x0" when absent. */
  value: Hex;
}

export interface RequiredAsset {
  address: Hex;
  /** Hex amount in the asset's smallest unit. */
  amount: Hex;
  standard: "erc20" | "erc721" | "erc1155";
  tokenId?: Hex;
}

/** `wallet_sendCalls` params after validation: what reaches the wallet host as DappRequest.params[0]. */
export interface SendCallsParams {
  version: string;
  /** App-provided id (unique per sender per app), if any. */
  id?: string;
  from: Hex;
  chainId: Hex;
  atomicRequired: boolean;
  calls: SendCallsCall[];
  /** ERC-7682 metadata from `capabilities.auxiliaryFunds`, when the app sent it. */
  auxiliaryFunds?: { optional: boolean; requiredAssets: RequiredAsset[] };
}

export interface SendCallsResult {
  id: string;
  capabilities?: Record<string, unknown>;
}

export interface CallsReceipt {
  logs: { address: Hex; data: Hex; topics: Hex[] }[];
  status: Hex;
  blockHash: Hex;
  blockNumber: Hex;
  gasUsed: Hex;
  transactionHash: Hex;
}

/** EIP-5792 `wallet_getCallsStatus` result. 100 pending, 200 confirmed, 400 off-chain failure, 500/600 reverted. */
export interface CallsStatus {
  version: string;
  id: string;
  chainId: Hex;
  status: 100 | 200 | 400 | 500 | 600;
  atomic: boolean;
  receipts?: CallsReceipt[];
  capabilities?: Record<string, unknown>;
}

/** ERC-7682 capability object. */
export interface AuxiliaryFundsCapability {
  supported: boolean;
  assets?: Hex[];
}

export interface ChainCapabilities {
  atomic: { status: "supported" | "ready" | "unsupported" };
  auxiliaryFunds?: AuxiliaryFundsCapability;
}

/** What the wallet host answers for the Wallet Call API (the extension background / mobile engine). */
export interface CallsHost {
  /** False = the methods answer 4200 for now (e.g. another device is signing for this wallet). Default true. */
  enabled?(): boolean;
  /** ERC-7682 per network: where Clip can bring in money from the user's other balances. Static, never balances. */
  auxiliaryFunds(networkIds: NetworkId[]): Record<NetworkId, AuxiliaryFundsCapability | undefined> | Promise<Record<NetworkId, AuxiliaryFundsCapability | undefined>>;
  /** Status of a batch this origin sent; undefined = unknown id (5730). Other origins' ids are unknown too. */
  status(origin: string, id: string): Promise<CallsStatus | undefined>;
  /** Show the batch in the wallet; false = unknown id. */
  show(origin: string, id: string): Promise<boolean>;
}

const HEX = /^0x[0-9a-fA-F]*$/;
const QUANTITY = /^0x[0-9a-fA-F]+$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Capabilities a request may carry that Clip Wallet understands. Anything else must be `optional: true` (else 5700). */
const KNOWN_REQUEST_CAPABILITIES = new Set(["auxiliaryFunds"]);

function checkCapabilities(caps: unknown, where: string): Record<string, Record<string, unknown>> {
  if (caps === undefined) return {};
  if (!caps || typeof caps !== "object" || Array.isArray(caps)) throw rpcError.invalidParams(`${where} capabilities must be an object.`);
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, value] of Object.entries(caps as Record<string, unknown>)) {
    const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    if (!KNOWN_REQUEST_CAPABILITIES.has(name) && v.optional !== true) {
      throw callsError(CallsErrorCode.UnsupportedCapability, `Clip Wallet doesn't support the ${name.slice(0, 64)} capability.`);
    }
    out[name] = v;
  }
  return out;
}

function parseRequiredAssets(raw: unknown): RequiredAsset[] {
  if (raw === undefined) return [];
  const bad = () => callsError(CallsErrorCode.InvalidRequiredAssets, "Invalid requiredAssets.");
  if (!Array.isArray(raw) || raw.length > MAX_CALLS * 4) throw bad();
  return raw.map((a) => {
    if (!a || typeof a !== "object") throw bad();
    const { address, amount, standard, tokenId } = a as Record<string, unknown>;
    if (typeof address !== "string" || !ADDRESS.test(address)) throw bad();
    if (typeof amount !== "string" || !QUANTITY.test(amount)) throw bad();
    if (standard !== "erc20" && standard !== "erc721" && standard !== "erc1155") throw bad();
    if (standard !== "erc20" && (typeof tokenId !== "string" || !QUANTITY.test(tokenId))) throw bad();
    return { address: address as Hex, amount: amount as Hex, standard, ...(typeof tokenId === "string" ? { tokenId: tokenId as Hex } : {}) };
  });
}

/**
 * Validates `wallet_sendCalls` params[0]. Throws EIP-1193/EIP-5792 errors: -32602 malformed, 5700 unknown required
 * capability, 5740 too many calls, 5773 bad requiredAssets. `from` and the chain are checked by the router.
 */
export function parseSendCalls(raw: unknown, opts: { auxiliaryFunds: boolean; maxCalls?: number }): Omit<SendCallsParams, "from"> & { from?: Hex } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw rpcError.invalidParams("wallet_sendCalls expects [{ version, chainId, calls, ... }].");
  const p = raw as Record<string, unknown>;
  const version = typeof p.version === "string" && p.version.length <= 32 ? p.version : undefined;
  if (!version) throw rpcError.invalidParams("version must be a string.");
  if (typeof p.chainId !== "string" || !QUANTITY.test(p.chainId)) throw rpcError.invalidParams("chainId must be a hex string like 0x1.");
  if (p.from !== undefined && (typeof p.from !== "string" || !ADDRESS.test(p.from))) throw rpcError.invalidParams("from must be an address.");
  if (p.id !== undefined && (typeof p.id !== "string" || p.id.length === 0 || p.id.length > MAX_ID_LENGTH)) {
    throw rpcError.invalidParams("id must be a string of at most 4096 bytes.");
  }
  // EIP-5792 2.0 makes atomicRequired required; 1.0 requests (no field) are treated as "not required".
  if (p.atomicRequired !== undefined && typeof p.atomicRequired !== "boolean") throw rpcError.invalidParams("atomicRequired must be a boolean.");
  if (!Array.isArray(p.calls) || p.calls.length === 0) throw rpcError.invalidParams("calls must be a non-empty array.");
  const max = opts.maxCalls ?? MAX_CALLS;
  if (p.calls.length > max) throw callsError(CallsErrorCode.BundleTooLarge, `Clip Wallet takes at most ${max} calls in one request.`);

  const top = checkCapabilities(p.capabilities, "Request");
  const calls: SendCallsCall[] = p.calls.map((c, i) => {
    if (!c || typeof c !== "object" || Array.isArray(c)) throw rpcError.invalidParams(`calls[${i}] must be an object.`);
    const { to, data, value, capabilities } = c as Record<string, unknown>;
    if (to !== undefined && (typeof to !== "string" || !ADDRESS.test(to))) throw rpcError.invalidParams(`calls[${i}].to must be an address.`);
    if (data !== undefined && (typeof data !== "string" || !HEX.test(data) || data.length % 2 !== 0)) throw rpcError.invalidParams(`calls[${i}].data must be hex.`);
    if (value !== undefined && (typeof value !== "string" || !QUANTITY.test(value))) throw rpcError.invalidParams(`calls[${i}].value must be a hex quantity.`);
    if (to === undefined && (data === undefined || data === "0x")) throw rpcError.invalidParams(`calls[${i}] needs a to or data.`);
    const perCall = checkCapabilities(capabilities, `calls[${i}]`);
    if (perCall.auxiliaryFunds && !opts.auxiliaryFunds && perCall.auxiliaryFunds.optional !== true) {
      throw callsError(CallsErrorCode.UnsupportedCapability, "Clip Wallet can't bring in money for this request.");
    }
    return { ...(to ? { to: to as Hex } : {}), data: (data ?? "0x") as Hex, value: (value ?? "0x0") as Hex };
  });

  const out: Omit<SendCallsParams, "from"> & { from?: Hex } = {
    version,
    chainId: p.chainId as Hex,
    atomicRequired: p.atomicRequired === true,
    calls,
    ...(p.id !== undefined ? { id: p.id as string } : {}),
    ...(p.from !== undefined ? { from: p.from as Hex } : {}),
  };
  const aux = top.auxiliaryFunds;
  if (aux) {
    const optional = aux.optional === true;
    const requiredAssets = parseRequiredAssets(aux.requiredAssets);
    if (!opts.auxiliaryFunds) {
      // Not offered on this chain: fine when optional (EIP-5792), else 5772 (ERC-7682).
      if (!optional) throw callsError(CallsErrorCode.AuxiliaryFundsNotAvailable, "Clip Wallet can't bring in money on this network.");
    } else {
      out.auxiliaryFunds = { optional, requiredAssets };
    }
  }
  return out;
}

/** wallet_getCapabilities for one chain. */
export function chainCapabilities(aux: AuxiliaryFundsCapability | undefined): ChainCapabilities {
  return { atomic: { status: "unsupported" }, ...(aux?.supported ? { auxiliaryFunds: aux } : {}) };
}
