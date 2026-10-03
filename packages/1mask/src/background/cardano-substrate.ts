/**
 * Router support for the Cardano (CIP-30) and Substrate (injectedWeb3) connectors. Kept in its own file so the
 * integration step only wires it into router.ts / methods.ts (see docs/phase2/integration/cardano-substrate.md).
 *
 * Rules: connect methods prompt once per origin; CIP-30 read methods need the permission but no approval;
 * signing needs the permission and an approval; every Substrate signing request must name a connected account
 * (compared by public key, so any SS58 prefix works).
 */
import type { DappRequest, Family, Network } from "@clip-wallet/core";
import { rpcError } from "../shared/errors.js";
import { METHOD_WS_STATE, type ExposedAccount } from "../shared/protocol.js";

export const CARDANO_METHODS_ALLOWED = {
  local: [METHOD_WS_STATE, "cardano_disconnect"],
  connect: ["cardano_enable"],
  /** Answered by the background without a prompt (CIP-30: read-only calls need no consent after enable()). */
  readOnly: [
    "cardano_getNetworkId",
    "cardano_getUtxos",
    "cardano_getCollateral",
    "cardano_getBalance",
    "cardano_getUsedAddresses",
    "cardano_getUnusedAddresses",
    "cardano_getChangeAddress",
    "cardano_getRewardAddresses",
    "cardano_submitTx",
  ],
  signing: ["cardano_signTx", "cardano_signData"],
} as const;

export const SUBSTRATE_METHODS_ALLOWED = {
  local: [METHOD_WS_STATE, "substrate_disconnect"],
  connect: ["substrate_enable"],
  signing: ["substrate_signPayload", "substrate_signRaw"],
} as const;

export function cardanoSubstrateAllowlist(family: Family): ReadonlySet<string> {
  if (family === "cardano") return new Set<string>(Object.values(CARDANO_METHODS_ALLOWED).flat());
  if (family === "substrate") return new Set<string>(Object.values(SUBSTRATE_METHODS_ALLOWED).flat());
  return new Set<string>();
}

/** The router internals the dispatcher needs (all exist inside createOneMaskRouter). */
export interface CardanoSubstrateRouterHelpers {
  permitted(origin: string, family: Family): Promise<boolean>;
  accounts(origin: string, family: Family): Promise<ExposedAccount[]>;
  connect(origin: string, family: Family, net: Network, method: string, params: unknown): Promise<ExposedAccount[]>;
  /** opts.handle behind the per-origin approval cap and approval timeout. */
  approve(req: DappRequest): Promise<unknown>;
  /** opts.handle with the read timeout and no approval (EVM read-only path). */
  read(req: DappRequest): Promise<unknown>;
  makeReq(origin: string, family: Family, net: Network, method: string, params: unknown): DappRequest;
  requireNetwork(family: Family, origin: string, chain: string | undefined): Network;
  requirePermission(origin: string, family: Family): Promise<void>;
  revoke(origin: string, family: Family): Promise<void>;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * SS58 → 32-byte public key hex (simple and full prefixes). The checksum is not verified here: this only matches
 * the request against connected accounts; the chain module re-validates the address before anything is signed.
 */
export function ss58PublicKey(address: string): string | null {
  if (/^0x[0-9a-fA-F]{64}$/.test(address)) return address.slice(2).toLowerCase();
  let n = 0n;
  for (const c of address) {
    const i = B58.indexOf(c);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const c of address) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  const prefixLen = bytes[0] !== undefined && bytes[0] & 0x40 ? 2 : 1;
  if (bytes.length !== prefixLen + 32 + 2) return null;
  return bytes
    .slice(prefixLen, prefixLen + 32)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function requireOwnSubstrate(h: CardanoSubstrateRouterHelpers, origin: string, address: unknown): Promise<void> {
  const want = typeof address === "string" ? ss58PublicKey(address) : null;
  const mine = (await h.accounts(origin, "substrate")).map((a) => a.publicKey?.replace(/^0x/, "").toLowerCase() ?? ss58PublicKey(a.address));
  if (!want || !mine.includes(want)) throw rpcError.unauthorized("That account is not connected to this site.");
}

export async function dispatchCardanoSubstrate(
  h: CardanoSubstrateRouterHelpers,
  origin: string,
  family: "cardano" | "substrate",
  method: string,
  params: unknown,
  chain: string | undefined,
): Promise<unknown> {
  switch (method) {
    case METHOD_WS_STATE:
      return (await h.permitted(origin, family)) ? h.accounts(origin, family) : [];
    case "cardano_disconnect":
    case "substrate_disconnect":
      await h.revoke(origin, family);
      return null;
    case "cardano_enable":
    case "substrate_enable":
      if (await h.permitted(origin, family)) return h.accounts(origin, family);
      return h.connect(origin, family, h.requireNetwork(family, origin, chain), method, params ?? {});
  }

  await h.requirePermission(origin, family);
  const net = h.requireNetwork(family, origin, chain);
  if (family === "cardano") {
    if ((CARDANO_METHODS_ALLOWED.readOnly as readonly string[]).includes(method)) return h.read(h.makeReq(origin, family, net, method, params ?? []));
    if (!Array.isArray(params) && (typeof params !== "object" || params === null)) throw rpcError.invalidParams("Invalid params.");
    return h.approve(h.makeReq(origin, family, net, method, params));
  }

  const p = (params ?? {}) as { address?: unknown; genesisHash?: unknown };
  if (typeof p !== "object") throw rpcError.invalidParams("Invalid params.");
  await requireOwnSubstrate(h, origin, p.address);
  return h.approve(h.makeReq(origin, family, net, method, params));
}
