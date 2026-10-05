import type { DappRequest, Family, Network, Warning } from "@clip-wallet/core";
import { randomId } from "../shared/bytes.js";
import { RpcErrorCode, toRpcErrorShape } from "../shared/errors.js";
import { parseChainId, toHexChainId } from "../shared/networks.js";
import {
  WC_NAMESPACE_FAMILY,
  WC_SUPPORTED_METHODS,
  isServedMethod,
  mapProposalNamespaces,
  namespaceOf,
  type NamespaceMapping,
  type ProposalNamespace,
  type SessionNamespace,
  type UnsupportedReport,
  type WcNamespaceKey,
} from "./namespaces.js";
import { assessVerify, type Verification, type VerifyContextLike } from "./verify.js";

/* ------------------------------------------------------------------ SDK error codes */

/** WalletConnect SDK errors (@walletconnect/utils getSdkError), values verified against v2.25.0. */
export const WC_ERRORS = {
  USER_REJECTED: { code: 5000, message: "User rejected." },
  UNSUPPORTED_CHAINS: { code: 5100, message: "Unsupported chains." },
  UNSUPPORTED_METHODS: { code: 5101, message: "Unsupported methods." },
  UNSUPPORTED_ACCOUNTS: { code: 5103, message: "Unsupported accounts." },
  UNSUPPORTED_NAMESPACE_KEY: { code: 5104, message: "Unsupported namespace key." },
  UNAUTHORIZED_METHOD: { code: 3001, message: "Unauthorized method." },
  USER_DISCONNECTED: { code: 6000, message: "User disconnected." },
} as const;

/** Map an EIP-1193 / internal error to the code we send over WalletConnect. */
export function toWcError(err: unknown): { code: number; message: string } {
  const e = toRpcErrorShape(err);
  switch (e.code) {
    case RpcErrorCode.UserRejected:
      return { code: WC_ERRORS.USER_REJECTED.code, message: e.message };
    case RpcErrorCode.UnsupportedMethod:
      return { code: WC_ERRORS.UNSUPPORTED_METHODS.code, message: e.message };
    case RpcErrorCode.Unauthorized:
      return { code: WC_ERRORS.UNAUTHORIZED_METHOD.code, message: e.message };
    case RpcErrorCode.ChainDisconnected:
    case RpcErrorCode.UnrecognizedChain:
      return { code: WC_ERRORS.UNSUPPORTED_CHAINS.code, message: e.message };
    default:
      return { code: e.code, message: e.message };
  }
}

/* ------------------------------------------------------------------ WalletKit surface we use */

export interface WcMetadata {
  name: string;
  description: string;
  url: string;
  icons: string[];
}

export interface WcSessionLike {
  topic: string;
  expiry: number;
  peer: { metadata: WcMetadata };
  namespaces: Record<string, SessionNamespace>;
}

export interface WcProposalEvent {
  id: number;
  params: {
    id: number;
    proposer: { metadata: WcMetadata };
    requiredNamespaces: Record<string, ProposalNamespace>;
    optionalNamespaces: Record<string, ProposalNamespace>;
  };
  verifyContext?: VerifyContextLike;
}

export interface WcRequestEvent {
  id: number;
  topic: string;
  params: { request: { method: string; params: unknown }; chainId: string };
  verifyContext?: VerifyContextLike;
}

export interface WcAuthenticateEvent {
  id: number;
  topic: string;
  params: {
    requester: { metadata: WcMetadata };
    authPayload: { chains: string[]; domain: string; aud: string; nonce: string; [k: string]: unknown };
  };
  verifyContext?: VerifyContextLike;
}

type JsonRpcResponse =
  | { id: number; jsonrpc: "2.0"; result: unknown }
  | { id: number; jsonrpc: "2.0"; error: { code: number; message: string } };

/** The subset of Reown WalletKit (@reown/walletkit) 1Mask uses. Tests inject a fake. */
export interface WalletKitLike {
  pair(p: { uri: string }): Promise<void>;
  approveSession(p: { id: number; namespaces: Record<string, SessionNamespace> }): Promise<{ topic: string }>;
  rejectSession(p: { id: number; reason: { code: number; message: string } }): Promise<void>;
  respondSessionRequest(p: { topic: string; response: JsonRpcResponse }): Promise<void>;
  disconnectSession(p: { topic: string; reason: { code: number; message: string } }): Promise<void>;
  getActiveSessions(): Record<string, WcSessionLike>;
  emitSessionEvent(p: { topic: string; event: { name: string; data: unknown }; chainId: string }): Promise<void>;
  updateSession(p: { topic: string; namespaces: Record<string, SessionNamespace> }): Promise<unknown>;
  approveSessionAuthenticate(p: { id: number; auths: unknown[] }): Promise<unknown>;
  rejectSessionAuthenticate(p: { id: number; reason: { code: number; message: string } }): Promise<void>;
  formatAuthMessage(p: { request: unknown; iss: string }): string;
  on(event: string, listener: (args: any) => void): unknown;
  off(event: string, listener: (args: any) => void): unknown;
}

/** CAIP-122 helpers from @walletconnect/utils (injectable so unit tests stay offline and light). */
export interface AuthUtils {
  populateAuthPayload(p: { authPayload: any; chains: string[]; methods: string[] }): any;
  buildAuthObject(payload: any, signature: { t: "eip191"; s: string }, iss: string): unknown;
}

/* ------------------------------------------------------------------ options */

export interface WcRequestContext {
  /** Verify API result for the approval screen. Merge into DecodedRequest.warnings. */
  warnings: Warning[];
  verification: Verification;
  peer: WcMetadata;
  topic?: string;
}

export interface WcProposalSummary {
  id: number;
  peer: WcMetadata;
  origin: string;
  verification: Verification;
  warnings: Warning[];
  /** Networks that will be shared, by CAIP-2 id. */
  approvedChains: string[];
  namespaces: Record<string, SessionNamespace>;
  /** What the app asked for that Clip will not provide. */
  unsupported: UnsupportedReport;
}

export interface WalletConnectWalletOptions {
  /** Reown Cloud project id. Required; read from the extension's build config, never hardcoded here. */
  projectId: string;
  metadata: WcMetadata;
  networks: Network[];
  /** Addresses on a chain (Hedera: account ids "0.0.x"). */
  addressesFor(chainId: string, family: Family): string[];
  /** Ask the user to approve a session; resolve true to connect. */
  approveProposal(summary: WcProposalSummary): Promise<boolean>;
  /** Decode, ask, sign, reply — same contract as the router's `handle`, plus WC context. */
  handle(req: DappRequest, ctx: WcRequestContext): Promise<unknown>;
  /** See router `familyForNetwork`. Default: eip155 → evm, solana, bip122 → bitcoin, hedera. */
  familyForChain?(chainId: string): Family;
  /** Local blocklist on top of Verify's isScam. */
  isKnownScam?(origin: string): boolean;
  /** Request expired on the relay: close the approval window. */
  cancel?(requestId: string): void;
  /** Extra @walletconnect/core options (relayUrl, storage, customStoragePrefix...). */
  coreOptions?: Record<string, unknown>;
  /** Test seam: build the WalletKit client. Default: Core + WalletKit.init. */
  walletKitFactory?(o: { projectId: string; metadata: WcMetadata; coreOptions?: Record<string, unknown> }): Promise<WalletKitLike>;
  /** Test seam: CAIP-122 helpers. Default: @walletconnect/utils. */
  authUtils?: AuthUtils;
  newId?(): string;
}

export interface WalletConnectWallet {
  kit: WalletKitLike;
  pair(uri: string): Promise<void>;
  sessions(): { topic: string; peer: WcMetadata; expiry: number; chains: string[] }[];
  disconnect(topic: string): Promise<void>;
  /** After the user switches accounts: update every session's accounts and emit accountsChanged. */
  notifyAccountsChanged(): Promise<void>;
  /** For tests and the UI: the mapping a proposal would get. */
  mapProposal(p: { requiredNamespaces?: Record<string, ProposalNamespace>; optionalNamespaces?: Record<string, ProposalNamespace> }): NamespaceMapping;
  destroy(): void;
}

export async function defaultWalletKitFactory(o: {
  projectId: string;
  metadata: WcMetadata;
  coreOptions?: Record<string, unknown>;
}): Promise<WalletKitLike> {
  const [{ Core }, { WalletKit }] = await Promise.all([import("@walletconnect/core"), import("@reown/walletkit")]);
  const core = new Core({ ...o.coreOptions, projectId: o.projectId });
  return (await WalletKit.init({ core, metadata: o.metadata })) as unknown as WalletKitLike;
}

async function defaultAuthUtils(): Promise<AuthUtils> {
  const u = await import("@walletconnect/utils");
  return { populateAuthPayload: u.populateAuthPayload, buildAuthObject: u.buildAuthObject };
}

const defaultFamilyForChain = (chainId: string): Family => {
  const ns = namespaceOf(chainId);
  return (WC_NAMESPACE_FAMILY as Record<string, Family>)[ns] ?? "evm";
};

/* ------------------------------------------------------------------ wallet */

export async function createWalletConnectWallet(opts: WalletConnectWalletOptions): Promise<WalletConnectWallet> {
  if (!opts.projectId || typeof opts.projectId !== "string") {
    throw new Error("1Mask WalletConnect: projectId is required (pass it from the build config)");
  }
  const factory = opts.walletKitFactory ?? defaultWalletKitFactory;
  const kit = await factory({
    projectId: opts.projectId,
    metadata: opts.metadata,
    ...(opts.coreOptions ? { coreOptions: opts.coreOptions } : {}),
  });
  const familyFor = opts.familyForChain ?? defaultFamilyForChain;
  const newId = opts.newId ?? randomId;
  const registry = new Set(opts.networks.map((n) => n.id));
  const inflight = new Map<number, string>();

  const mapProposal: WalletConnectWallet["mapProposal"] = (p) =>
    mapProposalNamespaces(p, {
      networks: opts.networks,
      addressesFor: (chain) => opts.addressesFor(chain, familyFor(chain)),
    });

  /* -------------------------------------------------------------- session_proposal */
  const onProposal = async (ev: WcProposalEvent) => {
    const { id, params } = ev;
    try {
      const peer = params.proposer.metadata;
      const verify = assessVerify(ev.verifyContext, peer.url, opts.isKnownScam);
      const mapping = mapProposal(params);
      if (!mapping.ok) {
        await kit.rejectSession({ id, reason: { code: WC_ERRORS[mapping.reason].code, message: mapping.message } });
        return;
      }
      const approvedChains = Object.values(mapping.namespaces).flatMap((n) => n.chains);
      // Audit WC-04: the connect screen names one network and address; say plainly when the app also gets the
      // user's addresses of other kinds of account (other namespaces have other addresses).
      const names = [...new Set(approvedChains.map((c) => opts.networks.find((n) => n.id === c)?.name ?? c))];
      const shared: Warning[] =
        Object.keys(mapping.namespaces).length > 1
          ? [{ level: "info", code: "network-matters", message: `This app gets your addresses on ${names.length} networks: ${names.join(", ")}.` }]
          : [];
      const approved = await opts.approveProposal({
        id,
        peer,
        origin: verify.origin,
        verification: verify.verification,
        warnings: [...verify.warnings, ...shared],
        approvedChains,
        namespaces: mapping.namespaces,
        unsupported: mapping.unsupported,
      });
      if (!approved) {
        await kit.rejectSession({ id, reason: WC_ERRORS.USER_REJECTED });
        return;
      }
      await kit.approveSession({ id, namespaces: mapping.namespaces });
    } catch {
      await kit.rejectSession({ id, reason: WC_ERRORS.USER_REJECTED }).catch(() => {});
    }
  };

  /* -------------------------------------------------------------- session_request */
  const respond = (topic: string, id: number, body: { result: unknown } | { error: { code: number; message: string } }) =>
    kit.respondSessionRequest({ topic, response: { id, jsonrpc: "2.0", ...body } as JsonRpcResponse });

  const sessionAccounts = (session: WcSessionLike, chainId: string): string[] => {
    const ns = session.namespaces[namespaceOf(chainId)];
    return (ns?.accounts ?? []).filter((a) => a.startsWith(`${chainId}:`)).map((a) => a.slice(chainId.length + 1));
  };

  /** Requests answered without a prompt (session state). Returns undefined if not local. */
  const answerLocally = async (session: WcSessionLike, chainId: string, method: string, params: unknown): Promise<{ result: unknown } | undefined> => {
    if (namespaceOf(chainId) === "eip155") {
      switch (method) {
        case "eth_accounts":
        case "eth_requestAccounts":
          return { result: sessionAccounts(session, chainId) };
        case "eth_chainId": {
          const n = parseChainId(chainId.slice("eip155:".length));
          return { result: n ? toHexChainId(n) : null };
        }
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain": {
          const raw = Array.isArray(params) ? (params[0] as { chainId?: unknown } | undefined)?.chainId : undefined;
          const n = parseChainId(raw);
          const target = n ? `eip155:${n}` : undefined;
          const inSession = target && session.namespaces.eip155?.chains.includes(target);
          if (!target || !registry.has(target) || !inSession) {
            throw method === "wallet_addEthereumChain"
              ? { code: RpcErrorCode.UserRejected, message: "Clip Wallet only connects to the networks it ships with." }
              : { code: RpcErrorCode.UnrecognizedChain, message: `Clip Wallet does not support chain ${String(raw)}.` };
          }
          await kit.emitSessionEvent({ topic: session.topic, event: { name: "chainChanged", data: n }, chainId: target });
          return { result: null };
        }
      }
    }
    if (namespaceOf(chainId) === "solana" && (method === "solana_getAccounts" || method === "solana_requestAccounts")) {
      return { result: sessionAccounts(session, chainId).map((pubkey) => ({ pubkey })) };
    }
    if (namespaceOf(chainId) === "near" && method === "near_getAccounts") {
      return { result: sessionAccounts(session, chainId).map((accountId) => ({ accountId })) };
    }
    return undefined;
  };

  const onRequest = async (ev: WcRequestEvent) => {
    const { id, topic, params } = ev;
    const { chainId, request } = params;
    try {
      const session = kit.getActiveSessions()[topic];
      if (!session) throw { code: RpcErrorCode.Unauthorized, message: "Unknown session." };
      const nsKey = namespaceOf(chainId);
      const ns = session.namespaces[nsKey];
      if (!ns || !ns.chains.includes(chainId) || !registry.has(chainId)) {
        throw { code: RpcErrorCode.ChainDisconnected, message: `Clip Wallet is not connected to ${chainId}.` };
      }
      if (!ns.methods.includes(request.method)) {
        throw { code: RpcErrorCode.Unauthorized, message: `${request.method} was not approved for this session.` };
      }
      if (!isServedMethod(nsKey, request.method)) {
        // Listed only so the session conformed to the app's required namespaces (e.g. eth_sign).
        throw { code: RpcErrorCode.UnsupportedMethod, message: `Clip Wallet does not support ${request.method}.` };
      }
      const local = await answerLocally(session, chainId, request.method, request.params);
      if (local) return void (await respond(topic, id, local));

      const peer = session.peer.metadata;
      const verify = assessVerify(ev.verifyContext, peer.url, opts.isKnownScam);
      const req: DappRequest = {
        id: newId(),
        origin: verify.origin,
        via: "walletconnect",
        family: familyFor(chainId),
        networkId: chainId,
        method: request.method,
        params: request.params,
      };
      inflight.set(id, req.id);
      try {
        const result = await opts.handle(req, { warnings: verify.warnings, verification: verify.verification, peer, topic });
        await respond(topic, id, { result: result === undefined ? null : result });
      } finally {
        inflight.delete(id);
      }
    } catch (err) {
      await respond(topic, id, { error: toWcError(err) }).catch(() => {});
    }
  };

  const onRequestExpire = (ev: { id: number }) => {
    const reqId = inflight.get(ev.id);
    if (reqId) opts.cancel?.(reqId);
  };

  /* -------------------------------------------------------------- session_authenticate (one-click auth, CAIP-122 / SIWE) */
  let authUtils: AuthUtils | undefined = opts.authUtils;
  const onAuthenticate = async (ev: WcAuthenticateEvent) => {
    const { id, params } = ev;
    try {
      const peer = params.requester.metadata;
      const verify = assessVerify(ev.verifyContext, peer.url, opts.isKnownScam);
      const supported = params.authPayload.chains.filter(
        (c) => namespaceOf(c) === "eip155" && registry.has(c) && opts.addressesFor(c, familyFor(c)).length > 0,
      );
      if (supported.length === 0) {
        await kit.rejectSessionAuthenticate({ id, reason: WC_ERRORS.UNSUPPORTED_CHAINS });
        return;
      }
      authUtils ??= await defaultAuthUtils();
      const payload = authUtils.populateAuthPayload({
        authPayload: params.authPayload,
        chains: supported,
        methods: [...WC_SUPPORTED_METHODS.eip155],
      });
      const chainId: string = payload.chains[0];
      const address = opts.addressesFor(chainId, familyFor(chainId))[0]!;
      const iss = `did:pkh:${chainId}:${address}`;
      const message = kit.formatAuthMessage({ request: payload, iss });
      // One approval, one signature (for the first supported chain): personal_sign over the SIWE message.
      const signature = await opts.handle(
        {
          id: newId(),
          origin: verify.origin,
          via: "walletconnect",
          family: familyFor(chainId),
          networkId: chainId,
          method: "wallet_authenticate",
          params: { message, address, domain: params.authPayload.domain, authPayload: payload },
        },
        { warnings: verify.warnings, verification: verify.verification, peer },
      );
      if (typeof signature !== "string") throw new Error("expected a signature");
      const auth = authUtils.buildAuthObject(payload, { t: "eip191", s: signature }, iss);
      await kit.approveSessionAuthenticate({ id, auths: [auth] });
    } catch (err) {
      const e = toWcError(err);
      await kit
        .rejectSessionAuthenticate({ id, reason: e.code === WC_ERRORS.USER_REJECTED.code ? WC_ERRORS.USER_REJECTED : e })
        .catch(() => {});
    }
  };

  kit.on("session_proposal", onProposal);
  kit.on("session_request", onRequest);
  kit.on("session_request_expire", onRequestExpire);
  kit.on("session_authenticate", onAuthenticate);

  return {
    kit,
    pair: (uri) => {
      if (typeof uri !== "string" || !uri.startsWith("wc:")) throw new Error("Not a WalletConnect link.");
      return kit.pair({ uri });
    },
    sessions: () =>
      Object.values(kit.getActiveSessions()).map((s) => ({
        topic: s.topic,
        peer: s.peer.metadata,
        expiry: s.expiry,
        chains: Object.values(s.namespaces).flatMap((n) => n.chains ?? []),
      })),
    disconnect: (topic) => kit.disconnectSession({ topic, reason: WC_ERRORS.USER_DISCONNECTED }),
    async notifyAccountsChanged() {
      for (const s of Object.values(kit.getActiveSessions())) {
        const namespaces: Record<string, SessionNamespace> = {};
        for (const [key, ns] of Object.entries(s.namespaces)) {
          const accounts = ns.chains.flatMap((c) => opts.addressesFor(c, familyFor(c)).map((a) => `${c}:${a}`));
          namespaces[key] = { ...ns, accounts };
        }
        await kit.updateSession({ topic: s.topic, namespaces });
        for (const [key, ns] of Object.entries(namespaces)) {
          const event = key === "bip122" ? "bip122_addressesChanged" : "accountsChanged";
          if (!ns.events.includes(event)) continue;
          for (const c of ns.chains) {
            const data = ns.accounts.filter((a) => a.startsWith(`${c}:`)).map((a) => (key === "eip155" ? a.slice(c.length + 1) : a));
            await kit.emitSessionEvent({ topic: s.topic, event: { name: event, data }, chainId: c });
          }
        }
      }
    },
    mapProposal,
    destroy() {
      kit.off("session_proposal", onProposal);
      kit.off("session_request", onRequest);
      kit.off("session_request_expire", onRequestExpire);
      kit.off("session_authenticate", onAuthenticate);
    },
  };
}

export type { WcNamespaceKey };
