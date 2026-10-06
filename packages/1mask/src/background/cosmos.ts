import type { DappRequest, Family, Network } from "@clip-wallet/core";
import { rpcError } from "../shared/errors.js";
import { COSMOS_FAMILIES, COSMOS_INJECTED, type CosmosKeyWire, cosmosChainOf } from "../shared/cosmos.js";
import { bech32Decode, bech32Encode, bytesOfHex, hexOf } from "../shared/cosmos-bech32.js";
import type { ExposedAccount } from "../shared/protocol.js";

/**
 * Background side of the Keplr-compatible provider (inpage/cosmos.ts) for the four Cosmos key families: "cosmos"
 * (coin 118: Osmosis, dYdX, ZIGChain), "provenance" (505), "thorchain" (931), "initia" (60, ethsecp256k1).
 * The router keeps the policy (rate limits, approvals, timeouts); this file knows the method list, which account a
 * request names, and how an account is spelled on each chain. Wiring (router.ts / methods.ts, by the coordinator):
 *
 *   const cosmos = createCosmosDispatcher({ permitted, requirePermission, accounts, connect, approve, makeReq,
 *     requireNetwork, revoke, read: (req) => withTimeout(opts.handle(req), readMs, req.id) });
 *   if (COSMOS_DISPATCH_FAMILIES.has(family)) return cosmos.dispatch(origin, family, method, params, chain);
 *   injectedAllowlist(family) ∪= cosmosInjectedAllowlist(family)
 *
 * and the engine/service answers `cosmos_sendTx` / `cosmos_verifyArbitrary` through chains-cosmos `read()` without
 * an approval, like Cardano's read methods.
 */

export const COSMOS_DISPATCH_FAMILIES: ReadonlySet<Family> = new Set<Family>(COSMOS_FAMILIES);

export const COSMOS_METHODS_ALLOWED = {
  /** Silent account read and disconnect. */
  local: [COSMOS_INJECTED.accounts, COSMOS_INJECTED.disable],
  connect: [COSMOS_INJECTED.enable],
  /** Permission needed, no approval. */
  permitted: [COSMOS_INJECTED.getKey],
  /** Permission needed, answered by the chain module's read() (no approval). */
  readOnly: [COSMOS_INJECTED.sendTx, COSMOS_INJECTED.verifyArbitrary],
  signing: [COSMOS_INJECTED.signDirect, COSMOS_INJECTED.signAmino, COSMOS_INJECTED.signArbitrary],
} as const;

export function cosmosInjectedAllowlist(family: Family): ReadonlySet<string> {
  return COSMOS_DISPATCH_FAMILIES.has(family) ? new Set<string>(Object.values(COSMOS_METHODS_ALLOWED).flat()) : new Set<string>();
}

export interface CosmosRouterInternals {
  permitted(origin: string, family: Family): Promise<boolean>;
  requirePermission(origin: string, family: Family): Promise<void>;
  accounts(origin: string, family: Family): Promise<ExposedAccount[]>;
  connect(origin: string, family: Family, net: Network, method: string, params: unknown): Promise<ExposedAccount[]>;
  approve(req: DappRequest): Promise<unknown>;
  makeReq(origin: string, family: Family, net: Network, method: string, params: unknown): DappRequest;
  requireNetwork(family: Family, origin: string, chain: string | undefined): Network;
  revoke(origin: string, family: Family): Promise<void>;
  /** opts.handle with the read timeout and no approval. Absent: sendTx / verifyArbitrary answer 4200. */
  read?(req: DappRequest): Promise<unknown>;
}

const obj = (p: unknown): Record<string, unknown> => (p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {});

/** The account's 20 address bytes, from its address (any bech32 spelling) or, failing that, nothing. */
function addressBytesOf(a: ExposedAccount): Uint8Array | null {
  const d = bech32Decode(a.address);
  return d && d.data.length === 20 ? d.data : null;
}

/** Keplr Key for `chainId`, as JSON (bytes hex; the page turns them into Uint8Arrays). */
export function cosmosKeyFor(account: ExposedAccount, chainId: string): CosmosKeyWire {
  const chain = cosmosChainOf(chainId);
  const bytes = addressBytesOf(account);
  if (!chain || !bytes || !account.publicKey) throw rpcError.internal("This account can't be used on that chain.");
  return {
    algo: chain.algo,
    pubKey: account.publicKey,
    address: hexOf(bytes),
    bech32Address: bech32Encode(chain.prefix, bytes),
    // Lower-case hex (a valid EIP-55 spelling). Keplr checksums it; that needs keccak, which the page bundle doesn't carry.
    ethereumHexAddress: `0x${hexOf(bytes)}`,
  };
}

export function createCosmosDispatcher(r: CosmosRouterInternals) {
  /** The connected account (first) for the family, or 4100. */
  const mine = async (origin: string, family: Family): Promise<ExposedAccount> => {
    const list = await r.accounts(origin, family);
    const a = list[0];
    if (!a) throw rpcError.unauthorized();
    return a;
  };

  /** The signer the page named must be one of this site's accounts, spelled with this chain's prefix. */
  const requireOwnSigner = async (origin: string, family: Family, chainId: string, signer: unknown) => {
    const chain = cosmosChainOf(chainId);
    const d = typeof signer === "string" ? bech32Decode(signer) : null;
    if (!chain || !d || d.prefix !== chain.prefix) throw rpcError.unauthorized("Signer mismatched");
    const list = await r.accounts(origin, family);
    if (!list.some((a) => {
      const b = addressBytesOf(a);
      return !!b && hexOf(b) === hexOf(d.data);
    })) {
      throw rpcError.unauthorized("Signer mismatched");
    }
  };

  async function dispatch(origin: string, family: Family, method: string, params: unknown, chain: string | undefined): Promise<unknown> {
    if (!COSMOS_DISPATCH_FAMILIES.has(family)) throw rpcError.unsupportedMethod(method);

    if (method === COSMOS_INJECTED.accounts) return (await r.permitted(origin, family)) ? r.accounts(origin, family) : [];
    if (method === COSMOS_INJECTED.disable) {
      await r.revoke(origin, family);
      return null;
    }

    const net = r.requireNetwork(family, origin, chain);
    if (net.family !== family || !net.id.startsWith("cosmos:")) throw rpcError.chainDisconnected();
    const chainId = net.id.slice("cosmos:".length);
    if (!cosmosChainOf(chainId)) throw rpcError.chainDisconnected();

    if (method === COSMOS_INJECTED.enable) {
      if (await r.permitted(origin, family)) return r.accounts(origin, family);
      const ids = obj(params).chainIds;
      return r.connect(origin, family, net, method, { chainIds: Array.isArray(ids) ? ids.filter((x) => typeof x === "string").slice(0, 32) : [chainId] });
    }

    if (method === COSMOS_INJECTED.getKey) {
      await r.requirePermission(origin, family);
      return cosmosKeyFor(await mine(origin, family), chainId);
    }

    if ((COSMOS_METHODS_ALLOWED.readOnly as readonly string[]).includes(method)) {
      await r.requirePermission(origin, family);
      if (!r.read) throw rpcError.unsupportedMethod(method);
      if (method === COSMOS_INJECTED.sendTx) {
        const p = obj(params);
        if (typeof p.tx !== "string" || !p.tx) throw rpcError.invalidParams("Expected { tx: base64, mode }.");
        if (p.mode !== "sync" && p.mode !== "async" && p.mode !== "block") throw rpcError.invalidParams("mode must be sync, async or block.");
      }
      return r.read(r.makeReq(origin, family, net, method, params));
    }

    if ((COSMOS_METHODS_ALLOWED.signing as readonly string[]).includes(method)) {
      await r.requirePermission(origin, family);
      const p = obj(params);
      await requireOwnSigner(origin, family, chainId, method === COSMOS_INJECTED.signArbitrary ? p.signer : p.signerAddress);
      if (method === COSMOS_INJECTED.signDirect) {
        const doc = obj(p.signDoc);
        if (typeof doc.bodyBytes !== "string" || typeof doc.authInfoBytes !== "string" || typeof doc.chainId !== "string") {
          throw rpcError.invalidParams("Expected { signerAddress, signDoc: { bodyBytes, authInfoBytes, chainId, accountNumber } }.");
        }
        if (doc.chainId !== chainId) throw rpcError.invalidParams("Unmatched chain id with the sign doc");
      }
      if (method === COSMOS_INJECTED.signAmino) {
        const doc = obj(p.signDoc);
        // An ADR-36 doc (chain_id "") is a message signature, allowed on any chain; otherwise the doc names this chain.
        if (typeof doc.chain_id !== "string" || (doc.chain_id !== "" && doc.chain_id !== chainId)) throw rpcError.invalidParams("Unmatched chain id with the sign doc");
      }
      if (method === COSMOS_INJECTED.signArbitrary && (typeof p.data !== "string" || !p.data)) throw rpcError.invalidParams("Expected { signer, data: base64 }.");
      return r.approve(r.makeReq(origin, family, net, method, params));
    }

    throw rpcError.unsupportedMethod(method);
  }

  return { dispatch };
}

export { bytesOfHex };
