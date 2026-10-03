/**
 * Beacon (TZIP-10) v2 Tezos requests ⇄ Clip Wallet's `tezos_*` wallet methods. Pure; shared by the
 * extension (postMessage) peer and the P2P (Matrix) WalletClient wrapper.
 *
 * Message shapes: @airgap/beacon-types 4.8 (PermissionRequest, OperationRequest, SignPayloadRequest,
 * BroadcastRequest and their responses; BeaconErrorType). Tezos dApps still send version "2" requests
 * (beacon-dapp DAppClient.makeRequest); v3 is used for other blockchains only.
 */

export const BEACON_MESSAGE = {
  permissionRequest: "permission_request",
  operationRequest: "operation_request",
  signPayloadRequest: "sign_payload_request",
  broadcastRequest: "broadcast_request",
  permissionResponse: "permission_response",
  operationResponse: "operation_response",
  signPayloadResponse: "sign_payload_response",
  acknowledge: "acknowledge",
  disconnect: "disconnect",
  error: "error",
} as const;

export const BEACON_ERROR = {
  aborted: "ABORTED_ERROR",
  broadcast: "BROADCAST_ERROR",
  networkNotSupported: "NETWORK_NOT_SUPPORTED",
  noAddress: "NO_ADDRESS_ERROR",
  notGranted: "NOT_GRANTED_ERROR",
  parametersInvalid: "PARAMETERS_INVALID_ERROR",
  signatureTypeNotSupported: "SIGNATURE_TYPE_NOT_SUPPORTED",
  transactionInvalid: "TRANSACTION_INVALID_ERROR",
  unknown: "UNKNOWN_ERROR",
} as const;

export type BeaconErrorTypeValue = (typeof BEACON_ERROR)[keyof typeof BEACON_ERROR];

/** Clip's Tezos wallet methods (chains-tezos TEZOS_METHODS + 1Mask's connect/disconnect). */
export const TEZOS_WALLET_METHODS = {
  connect: "tezos:connect",
  disconnect: "tezos:disconnect",
  send: "tezos_send",
  sign: "tezos_sign",
} as const;

export interface BeaconNetwork {
  type: string;
  name?: string;
  rpcUrl?: string;
}

export interface BeaconAppMetadata {
  senderId: string;
  name: string;
  icon?: string;
}

export interface BeaconV2Request {
  type: string;
  version: string;
  id: string;
  senderId: string;
  appMetadata?: BeaconAppMetadata;
  network?: BeaconNetwork;
  scopes?: string[];
  operationDetails?: unknown[];
  sourceAddress?: string;
  signingType?: "raw" | "operation" | "micheline";
  payload?: string;
  signedTransaction?: string;
}

/** What Clip's wallet core answers with (1Mask router.dispatch signature). */
export type WalletDispatch = (origin: string, input: { family: "tezos"; method: string; params?: unknown; chain?: string }) => Promise<unknown>;

/** CAIP-2 Tezos chain for a Beacon network, and back. Defaults cover mainnet + the long-running testnets. */
export interface TezosNetworkMap {
  toChain(network: BeaconNetwork): string | undefined;
  toBeacon(chain: string): BeaconNetwork | undefined;
}

/**
 * Default map. CAIP-2 references are the base58 chain ids: mainnet NetXdQprcVkpaWU, shadownet NetXsqzbfFenSTS
 * (ghostnet is retired). Pass chains-tezos' `fromBeaconNetwork`/`beaconNetworkType` to follow its list.
 */
export const DEFAULT_TEZOS_NETWORKS: TezosNetworkMap = (() => {
  const byType: Record<string, string> = { mainnet: "tezos:NetXdQprcVkpaWU", shadownet: "tezos:NetXsqzbfFenSTS" };
  return {
    toChain: (n) => byType[n.type],
    toBeacon: (chain) => {
      const type = Object.entries(byType).find(([, c]) => c === chain)?.[0];
      return type ? { type } : undefined;
    },
  };
})();

export const SUPPORTED_SCOPES = ["operation_request", "sign"] as const;

export interface ConnectedAccount {
  address: string;
  /** Hex ed25519 public key (as 1Mask exposes it) or an edpk. */
  publicKey?: string;
}

/** A request mapped onto a wallet call, or an immediate Beacon error. */
export type MappedRequest =
  | { kind: "call"; method: string; params: unknown; chain?: string }
  | { kind: "error"; errorType: BeaconErrorTypeValue };

export function mapBeaconRequest(req: BeaconV2Request, networks: TezosNetworkMap): MappedRequest {
  switch (req.type) {
    case BEACON_MESSAGE.permissionRequest: {
      const chain = req.network ? networks.toChain(req.network) : undefined;
      if (!chain) return { kind: "error", errorType: BEACON_ERROR.networkNotSupported };
      const params: Record<string, unknown> = { scopes: req.scopes ?? [] };
      if (req.appMetadata) params.app = { name: req.appMetadata.name, icon: req.appMetadata.icon };
      return { kind: "call", method: TEZOS_WALLET_METHODS.connect, params, chain };
    }
    case BEACON_MESSAGE.operationRequest: {
      const chain = req.network ? networks.toChain(req.network) : undefined;
      if (!chain) return { kind: "error", errorType: BEACON_ERROR.networkNotSupported };
      if (!Array.isArray(req.operationDetails) || req.operationDetails.length === 0) return { kind: "error", errorType: BEACON_ERROR.parametersInvalid };
      return { kind: "call", method: TEZOS_WALLET_METHODS.send, params: { account: req.sourceAddress, operations: req.operationDetails }, chain };
    }
    case BEACON_MESSAGE.signPayloadRequest: {
      if (typeof req.payload !== "string") return { kind: "error", errorType: BEACON_ERROR.parametersInvalid };
      const signingType = req.signingType ?? "raw";
      if (!["raw", "operation", "micheline"].includes(signingType)) return { kind: "error", errorType: BEACON_ERROR.signatureTypeNotSupported };
      return { kind: "call", method: TEZOS_WALLET_METHODS.sign, params: { account: req.sourceAddress, payload: req.payload, signingType } };
    }
    case BEACON_MESSAGE.broadcastRequest:
      // Broadcasting someone else's signed operation isn't a wallet decision; dApps can inject it themselves.
      return { kind: "error", errorType: BEACON_ERROR.broadcast };
    default:
      return { kind: "error", errorType: BEACON_ERROR.unknown };
  }
}

/** Builds the Beacon v2 response for a successful wallet call (without senderId/version). */
export function beaconResponse(
  req: BeaconV2Request,
  result: unknown,
  ctx: { edpk(publicKey: string): string },
): Record<string, unknown> {
  switch (req.type) {
    case BEACON_MESSAGE.permissionRequest: {
      const accounts = (Array.isArray(result) ? result : []) as ConnectedAccount[];
      const a = accounts[0];
      if (!a?.publicKey) throw Object.assign(new Error("No Tezos account"), { beaconError: BEACON_ERROR.noAddress });
      const scopes = (req.scopes ?? []).filter((s) => (SUPPORTED_SCOPES as readonly string[]).includes(s));
      return {
        type: BEACON_MESSAGE.permissionResponse,
        id: req.id,
        publicKey: a.publicKey.startsWith("edpk") ? a.publicKey : ctx.edpk(a.publicKey),
        address: a.address,
        network: req.network,
        scopes,
        walletType: "implicit",
      };
    }
    case BEACON_MESSAGE.operationRequest: {
      const r = (result ?? {}) as { operationHash?: string; transactionHash?: string };
      return { type: BEACON_MESSAGE.operationResponse, id: req.id, transactionHash: r.operationHash ?? r.transactionHash };
    }
    case BEACON_MESSAGE.signPayloadRequest: {
      const r = (result ?? {}) as { signature?: string };
      return { type: BEACON_MESSAGE.signPayloadResponse, id: req.id, signingType: req.signingType ?? "raw", signature: r.signature };
    }
    default:
      throw Object.assign(new Error("unexpected"), { beaconError: BEACON_ERROR.unknown });
  }
}

/** Wallet error (1Mask RpcErrorShape codes or ClipError) → Beacon error type. */
export function beaconErrorType(req: BeaconV2Request, err: unknown): BeaconErrorTypeValue {
  const e = (err ?? {}) as { code?: unknown; beaconError?: BeaconErrorTypeValue };
  if (e.beaconError) return e.beaconError;
  switch (e.code) {
    case 4001:
      return BEACON_ERROR.aborted;
    case 4100:
      return BEACON_ERROR.notGranted;
    case -32602:
    case 4200:
      return BEACON_ERROR.parametersInvalid;
    case 4901:
    case 4902:
      return BEACON_ERROR.networkNotSupported;
  }
  return req.type === BEACON_MESSAGE.operationRequest ? BEACON_ERROR.transactionInvalid : BEACON_ERROR.unknown;
}
