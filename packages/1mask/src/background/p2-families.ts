import type { DappRequest, Family, Network } from "@clip-wallet/core";
import { rpcError } from "../shared/errors.js";
import {
  ALGORAND_INJECTED,
  NEAR_INJECTED,
  STELLAR_INJECTED,
  TEZOS_INJECTED,
  stellarNetworkName,
  stellarPassphraseOf,
} from "../shared/p2-methods.js";
import type { ExposedAccount } from "../shared/protocol.js";

/**
 * Background side of the injected NEAR, Stellar, Tezos (Beacon relay) and Algorand providers.
 * The router keeps the policy (permissions, approvals, rate limits, timeouts); this file only knows each
 * family's method list and how its params name accounts and networks. Wired into router.ts by the
 * integration step (docs/phase2/integration/near-stellar-tezos-algorand.md).
 */

export type P2Family = "near" | "stellar" | "tezos" | "algorand";
export const P2_FAMILIES: ReadonlySet<Family> = new Set<Family>(["near", "stellar", "tezos", "algorand"]);

const ALLOW: Record<P2Family, { local: readonly string[]; connect: readonly string[]; signing: readonly string[] }> = {
  near: {
    local: [NEAR_INJECTED.accounts, NEAR_INJECTED.disconnect],
    connect: [NEAR_INJECTED.connect],
    signing: [NEAR_INJECTED.signAndSendTransaction, NEAR_INJECTED.signAndSendTransactions, NEAR_INJECTED.signMessage],
  },
  stellar: {
    local: [STELLAR_INJECTED.accounts, STELLAR_INJECTED.disconnect, STELLAR_INJECTED.getNetwork],
    connect: [STELLAR_INJECTED.connect],
    signing: [STELLAR_INJECTED.signXDR, STELLAR_INJECTED.signAndSubmitXDR, STELLAR_INJECTED.signAuthEntry, STELLAR_INJECTED.signMessage],
  },
  tezos: {
    local: [TEZOS_INJECTED.accounts, TEZOS_INJECTED.disconnect, TEZOS_INJECTED.getAccounts, TEZOS_INJECTED.beacon, TEZOS_INJECTED.beaconResult],
    connect: [TEZOS_INJECTED.connect],
    signing: [TEZOS_INJECTED.send, TEZOS_INJECTED.sign],
  },
  algorand: {
    local: [ALGORAND_INJECTED.accounts, ALGORAND_INJECTED.disconnect],
    connect: [ALGORAND_INJECTED.connect],
    signing: [ALGORAND_INJECTED.signTxn, ALGORAND_INJECTED.signAndPostTxn],
  },
};

export const P2_METHODS_ALLOWED = ALLOW;

/** For methods.ts `injectedAllowlist`. */
export function p2InjectedAllowlist(family: Family): ReadonlySet<string> {
  const a = ALLOW[family as P2Family];
  return a ? new Set<string>([...a.local, ...a.connect, ...a.signing]) : new Set<string>();
}

/** Router closures the dispatcher borrows (all exist inside createOneMaskRouter). */
export interface P2RouterInternals {
  permitted(origin: string, family: Family): Promise<boolean>;
  requirePermission(origin: string, family: Family): Promise<void>;
  accounts(origin: string, family: Family): Promise<ExposedAccount[]>;
  connect(origin: string, family: Family, net: Network, method: string, params: unknown): Promise<ExposedAccount[]>;
  approve(req: DappRequest): Promise<unknown>;
  makeReq(origin: string, family: Family, net: Network, method: string, params: unknown): DappRequest;
  requireNetwork(family: Family, origin: string, chain: string | undefined): Network;
  revoke(origin: string, family: Family): Promise<void>;
}

/**
 * The Beacon extension peer (kit-modules/tezos createBeaconExtensionPeer) as the router sees it. It calls
 * back into router.dispatch(origin, { family: "tezos", ... }) for permission/operation/sign requests, so
 * those go through the same permission + approval path as everything else.
 */
export interface BeaconRelay {
  receive(origin: string, message: { payload?: string; encryptedPayload?: string }): Promise<{ replies: { payload?: string; encryptedPayload?: string }[]; pending?: string }>;
  result(origin: string, pendingId: string): Promise<{ payload?: string; encryptedPayload?: string }[]>;
}

export interface P2DispatcherOptions {
  beacon?: BeaconRelay | (() => BeaconRelay | undefined);
}

const obj = (p: unknown): Record<string, unknown> => (p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {});

/** ed25519 public key (hex) → Tezos "edpk…" (base58check, prefix 0d0f25d9). WebCrypto only. */
export async function tezosEdpk(publicKeyHex: string): Promise<string | undefined> {
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex)) return undefined;
  const body = new Uint8Array([13, 15, 37, 217, ...publicKeyHex.match(/../g)!.map((h) => parseInt(h, 16))]);
  const d1 = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
  const d2 = new Uint8Array(await crypto.subtle.digest("SHA-256", d1));
  const full = new Uint8Array([...body, ...d2.slice(0, 4)]);
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const b of full) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)]! + out;
    n /= 58n;
  }
  return out;
}

export function createP2Dispatcher(r: P2RouterInternals, opts: P2DispatcherOptions = {}) {
  const beacon = (): BeaconRelay => {
    const b = typeof opts.beacon === "function" ? opts.beacon() : opts.beacon;
    if (!b) throw rpcError.unsupportedMethod("Beacon");
    return b;
  };

  const own = async (origin: string, family: Family, addrs: unknown[]) => {
    const list = await r.accounts(origin, family);
    for (const a of addrs) {
      if (a === undefined || a === null) continue;
      if (typeof a !== "string" || !list.some((x) => x.address === a)) throw rpcError.unauthorized("That account is not connected to this site.");
    }
  };

  /** Account fields each family's params use to name the signer. */
  const signersOf = (family: P2Family, method: string, params: unknown): unknown[] => {
    const p = obj(params);
    switch (family) {
      case "near":
        if (method === NEAR_INJECTED.signAndSendTransactions) {
          if (!Array.isArray(p.transactions) || !p.transactions.length) throw rpcError.invalidParams("Expected { transactions: [...] }.");
          return p.transactions.map((t) => obj(t).signerId);
        }
        return [p.signerId];
      case "stellar":
        return [p.address];
      case "tezos":
        return [p.account];
      case "algorand":
        // Signers live inside the msgpack; chains-algorand checks them. ARC-1 `signers` may name ours.
        return [];
    }
  };

  async function dispatch(origin: string, family: Family, method: string, params: unknown, chain: string | undefined): Promise<unknown> {
    const f = family as P2Family;
    if (!ALLOW[f]) throw rpcError.unsupportedMethod(method);

    // Silent account read (no prompt).
    if (method === ALLOW[f].local[0]) return (await r.permitted(origin, family)) ? r.accounts(origin, family) : [];

    if (method === `${f}:disconnect`) {
      await r.revoke(origin, family);
      return null;
    }

    if (ALLOW[f].connect.includes(method)) {
      if (await r.permitted(origin, family)) return r.accounts(origin, family);
      return r.connect(origin, family, r.requireNetwork(family, origin, chain), method, params ?? {});
    }

    if (method === STELLAR_INJECTED.getNetwork) {
      const net = r.requireNetwork(family, origin, chain);
      const networkPassphrase = stellarPassphraseOf(net.id);
      if (!networkPassphrase) throw rpcError.chainDisconnected();
      return { network: stellarNetworkName(net.id), networkPassphrase };
    }

    if (method === TEZOS_INJECTED.beacon) {
      const m = obj(obj(params).message);
      const message: { payload?: string; encryptedPayload?: string } = {};
      if (typeof m.payload === "string") message.payload = m.payload;
      if (typeof m.encryptedPayload === "string") message.encryptedPayload = m.encryptedPayload;
      if (!message.payload && !message.encryptedPayload) throw rpcError.invalidParams("Expected a Beacon message.");
      return beacon().receive(origin, message);
    }
    if (method === TEZOS_INJECTED.beaconResult) {
      const id = obj(params).id;
      if (typeof id !== "string") throw rpcError.invalidParams("Expected { id }.");
      return beacon().result(origin, id);
    }

    if (method === TEZOS_INJECTED.getAccounts) {
      await r.requirePermission(origin, family);
      const list = await r.accounts(origin, family);
      return Promise.all(list.map(async (a) => ({ algo: "ed25519", address: a.address, pubkey: (a.publicKey && (await tezosEdpk(a.publicKey))) ?? "" })));
    }

    if (ALLOW[f].signing.includes(method)) {
      await r.requirePermission(origin, family);
      await own(origin, family, signersOf(f, method, params));
      const net = r.requireNetwork(family, origin, chain);
      return r.approve(r.makeReq(origin, family, net, method, params));
    }

    throw rpcError.unsupportedMethod(method);
  }

  return { dispatch };
}
