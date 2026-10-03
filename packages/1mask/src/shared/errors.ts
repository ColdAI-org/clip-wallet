/**
 * Error codes 1Mask speaks to dapps.
 *
 * EIP-1193 provider errors (https://eips.ethereum.org/EIPS/eip-1193#provider-errors),
 * EIP-1474 JSON-RPC errors (https://eips.ethereum.org/EIPS/eip-1474#error-codes) and
 * EIP-3085/3326 (4902 unrecognized chain).
 */
export const RpcErrorCode = {
  /** EIP-1193: the user rejected the request. */
  UserRejected: 4001,
  /** EIP-1193: the requested method and/or account has not been authorized by the user. */
  Unauthorized: 4100,
  /** EIP-1193: the provider does not support the requested method. */
  UnsupportedMethod: 4200,
  /** EIP-1193: the provider is disconnected from all chains. */
  Disconnected: 4900,
  /** EIP-1193: the provider is not connected to the requested chain. */
  ChainDisconnected: 4901,
  /** EIP-3326: unrecognized chain id. */
  UnrecognizedChain: 4902,
  /** JSON-RPC: invalid params. */
  InvalidParams: -32602,
  /** JSON-RPC: internal error. */
  Internal: -32603,
  /** JSON-RPC: method not found. */
  MethodNotFound: -32601,
  /** EIP-1474: resource unavailable (used for "a request is already pending"). */
  ResourceUnavailable: -32002,
  /** EIP-1474: limit exceeded (rate limiting). */
  LimitExceeded: -32005,
} as const;

export type RpcErrorCodeValue = (typeof RpcErrorCode)[keyof typeof RpcErrorCode];

export interface RpcErrorShape {
  code: number;
  message: string;
  data?: unknown;
}

/** EIP-1193 ProviderRpcError. Also used by the Wallet Standard wallets (thrown as Error with a `code`). */
export class ProviderRpcError extends Error implements RpcErrorShape {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "ProviderRpcError";
  }

  toJSON(): RpcErrorShape {
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: this.data };
  }
}

export const rpcError = {
  userRejected: (m = "The user rejected the request.") => new ProviderRpcError(RpcErrorCode.UserRejected, m),
  unauthorized: (m = "Connect Clip Wallet to this site first.") => new ProviderRpcError(RpcErrorCode.Unauthorized, m),
  unsupportedMethod: (method: string) =>
    new ProviderRpcError(RpcErrorCode.UnsupportedMethod, `Clip Wallet does not support ${method}.`),
  disconnected: (m = "Clip Wallet is disconnected.") => new ProviderRpcError(RpcErrorCode.Disconnected, m),
  chainDisconnected: (m = "Clip Wallet is not connected to that network.") =>
    new ProviderRpcError(RpcErrorCode.ChainDisconnected, m),
  unrecognizedChain: (chainId: string) =>
    new ProviderRpcError(RpcErrorCode.UnrecognizedChain, `Clip Wallet does not support chain ${chainId}.`),
  invalidParams: (m: string) => new ProviderRpcError(RpcErrorCode.InvalidParams, m),
  internal: (m = "Something went wrong in Clip Wallet. Try again.") => new ProviderRpcError(RpcErrorCode.Internal, m),
  pending: (m = "A request from this site is already waiting in Clip Wallet.") =>
    new ProviderRpcError(RpcErrorCode.ResourceUnavailable, m),
  limitExceeded: (m = "Too many requests from this site. Slow down and try again.") =>
    new ProviderRpcError(RpcErrorCode.LimitExceeded, m),
};

/** Reduces anything thrown to a serialisable {code,message}. Never forwards stacks or causes. */
export function toRpcErrorShape(err: unknown): RpcErrorShape {
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; message?: unknown; userMessage?: unknown; data?: unknown };
    if (typeof e.code === "number" && Number.isInteger(e.code)) {
      const message = typeof e.message === "string" ? e.message : "Request failed.";
      return e.data === undefined ? { code: e.code, message } : { code: e.code, message, data: e.data };
    }
    // ClipError from @clip-wallet/core: string code + userMessage.
    if (typeof e.code === "string" && typeof e.userMessage === "string") {
      const rejected = /reject|denied|cancel/i.test(e.code);
      return { code: rejected ? RpcErrorCode.UserRejected : RpcErrorCode.Internal, message: e.userMessage };
    }
  }
  return { code: RpcErrorCode.Internal, message: "Something went wrong in Clip Wallet. Try again." };
}

export function fromRpcErrorShape(shape: RpcErrorShape): ProviderRpcError {
  return new ProviderRpcError(shape.code, shape.message, shape.data);
}
