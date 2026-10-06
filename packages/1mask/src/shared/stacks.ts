import type { NetworkId } from "@clip-wallet/core";
import { METHOD_WS_STATE } from "./protocol.js";

/**
 * Stacks wire methods for 1Mask. The signing methods are SIP-030's own names (= chains-stacks STACKS_METHODS), so
 * the background hands them to the module unchanged. Sources:
 *  - SIP-030 (Recommended) https://github.com/stacksgov/sips/blob/main/sips/sip-030/sip-030-wallet-interface.md
 *  - @stacks/connect v8 `request()` / `MethodParams` https://github.com/stx-labs/connect/blob/main/packages/connect/src/methods.ts
 */
export const STACKS_INJECTED = {
  accounts: METHOD_WS_STATE,
  /** "Connect": SIP-030 stx_getAddresses (and @stacks/connect's getAddresses) prompt on first use. */
  connect: "stacks:connect",
  disconnect: "stacks:disconnect",
  /** SIP-030 stx_getNetworks (answered by the background, no prompt). */
  getNetworks: "stx_getNetworks",
  transferStx: "stx_transferStx",
  transferSip10Ft: "stx_transferSip10Ft",
  transferSip9Nft: "stx_transferSip9Nft",
  callContract: "stx_callContract",
  deployContract: "stx_deployContract",
  signTransaction: "stx_signTransaction",
  signMessage: "stx_signMessage",
  signStructuredMessage: "stx_signStructuredMessage",
} as const;

export const STACKS_SIGNING_METHODS: readonly string[] = [
  STACKS_INJECTED.transferStx,
  STACKS_INJECTED.transferSip10Ft,
  STACKS_INJECTED.transferSip9Nft,
  STACKS_INJECTED.callContract,
  STACKS_INJECTED.deployContract,
  STACKS_INJECTED.signTransaction,
  STACKS_INJECTED.signMessage,
  STACKS_INJECTED.signStructuredMessage,
];

/** ChainAgnostic stacks namespace (CAIP-2 = "stacks:" + chain id) ↔ SIP-030 network names. */
export const STACKS_CHAINS: Record<"mainnet" | "testnet", { caip2: NetworkId; chainId: number; transactionVersion: number }> = {
  mainnet: { caip2: "stacks:1", chainId: 1, transactionVersion: 0x00 },
  testnet: { caip2: "stacks:2147483648", chainId: 0x80000000, transactionVersion: 0x80 },
};

export function stacksNetworkName(networkId: NetworkId): "mainnet" | "testnet" | undefined {
  return networkId === STACKS_CHAINS.mainnet.caip2 ? "mainnet" : networkId === STACKS_CHAINS.testnet.caip2 ? "testnet" : undefined;
}

/** SIP-030 `network` param ("mainnet" | "testnet" | CAIP-2) → CAIP-2 chain hint; undefined for anything else. */
export function stacksChainHint(network: unknown): NetworkId | undefined {
  if (typeof network !== "string") return undefined;
  const n = network.trim().toLowerCase();
  if (n === "mainnet" || n === STACKS_CHAINS.mainnet.caip2) return STACKS_CHAINS.mainnet.caip2;
  if (n === "testnet" || n === STACKS_CHAINS.testnet.caip2) return STACKS_CHAINS.testnet.caip2;
  return undefined;
}

/* ------------------------------------------------------------------ c32check re-spelling (WebCrypto only) */

const C32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** Single-sig versions: 22 "SP" mainnet, 26 "ST" testnet; multisig 20 "SM" / 21 "SN". */
const SINGLE = { mainnet: 22, testnet: 26 } as const;
const MULTI = { mainnet: 20, testnet: 21 } as const;

function c32encode(data: Uint8Array): string {
  let n = 0n;
  for (const b of data) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = C32[Number(n & 31n)]! + out;
    n >>= 5n;
  }
  let zeros = 0;
  while (zeros < data.length && data[zeros] === 0) zeros++;
  return "0".repeat(zeros) + out;
}

function c32decode24(text: string): Uint8Array | undefined {
  let n = 0n;
  for (const ch of text) {
    const v = C32.indexOf(ch);
    if (v < 0) return undefined;
    n = (n << 5n) | BigInt(v);
  }
  const out = new Uint8Array(24);
  for (let i = 23; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return n === 0n ? out : undefined;
}

async function checksum(version: number, h: Uint8Array): Promise<Uint8Array> {
  const d1 = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array([version, ...h])));
  return new Uint8Array(await crypto.subtle.digest("SHA-256", d1)).subarray(0, 4);
}

/**
 * The same account's address spelled for `networkId` (Account.address is the mainnet "SP…" form; testnet is
 * "ST…": same hash160, version 26). Verifies the input's c32check checksum; undefined when it isn't a Stacks address.
 */
export async function stacksAddressOn(address: string, networkId: NetworkId): Promise<string | undefined> {
  const net = stacksNetworkName(networkId);
  const a = address.trim().toUpperCase();
  if (!net || !/^S[0-9A-Z]{39,41}$/.test(a)) return undefined;
  const version = C32.indexOf(a[1]!);
  const body = c32decode24(a.slice(2));
  if (!body || version < 0) return undefined;
  const h = body.subarray(0, 20);
  const sum = await checksum(version, h);
  if (sum.some((b, i) => b !== body[20 + i])) return undefined;
  const multi = version === MULTI.mainnet || version === MULTI.testnet;
  const target = multi ? MULTI[net] : SINGLE[net];
  if (!multi && version !== SINGLE.mainnet && version !== SINGLE.testnet) return undefined;
  return "S" + C32[target] + c32encode(new Uint8Array([...h, ...(await checksum(target, h))]));
}
