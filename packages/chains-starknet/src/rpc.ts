import { ClipError } from "@clip-wallet/core";

export class RpcError extends Error {
  constructor(
    public readonly rpcCode: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
  }
}

/** Starknet JSON-RPC error codes we act on (starknet-specs, starknet_api_openrpc.json / write_api). */
export const RPC_ERRORS = {
  CONTRACT_NOT_FOUND: 20,
  CLASS_HASH_NOT_FOUND: 28,
  CONTRACT_ERROR: 40,
  TRANSACTION_EXECUTION_ERROR: 41,
  INSUFFICIENT_ACCOUNT_BALANCE: 53,
  VALIDATION_FAILURE: 55,
  INVALID_TRANSACTION_NONCE: 52,
  INSUFFICIENT_RESOURCES_FOR_VALIDATE: 54,
  DUPLICATE_TX: 59,
} as const;

/** Minimal JSON-RPC client over the context's fetch, falling back across the network's public RPCs. */
export class StarknetRpc {
  private nextId = 1;
  constructor(
    private readonly urls: string[],
    private readonly fetchImpl: typeof fetch,
  ) {
    if (!urls.length) throw new ClipError("No Starknet connection is set up for this network.", "starknet/no-rpc");
  }

  async call<T>(method: string, params: unknown[] | Record<string, unknown> = []): Promise<T> {
    let lastStatus = 0;
    for (const url of this.urls) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
        });
      } catch {
        continue;
      }
      if (!res.ok) {
        lastStatus = res.status;
        continue;
      }
      const body = (await res.json()) as { result?: T; error?: { code: number; message: string; data?: unknown } };
      if (body.error) throw new RpcError(body.error.code, body.error.message, body.error.data);
      return body.result as T;
    }
    if (lastStatus) throw new ClipError("Starknet is slow to answer right now. Try again in a moment.", `starknet/rpc-${lastStatus}`);
    throw new ClipError("Couldn't reach Starknet right now. Check your connection and try again.", "starknet/rpc-unreachable");
  }
}

/** Turns an RPC failure into plain words. */
export function plainStarknetError(e: unknown): string {
  const text = e instanceof RpcError ? `${e.rpcCode} ${e.message} ${JSON.stringify(e.data ?? "")}` : String((e as Error)?.message ?? e);
  if (/u256_sub Overflow|transfer amount exceeds balance|insufficient balance|ERC20: amount exceeds/i.test(text)) {
    return "You don't have enough of a token this needs.";
  }
  if (/INSUFFICIENT_ACCOUNT_BALANCE|insufficient account balance|resources? bounds.*exceed.*balance|^53 /i.test(text)) {
    return "You don't have enough STRK to pay the network fee.";
  }
  if (/nonce/i.test(text)) return "Another transaction from this account went through first. Try again.";
  if (/allowance/i.test(text)) return "The app isn't allowed to move that token yet.";
  if (/invalid signature|VALIDATE_FAILURE|validation failure/i.test(text)) return "The account didn't accept the signature. Nothing was sent.";
  if (e instanceof RpcError && e.rpcCode === RPC_ERRORS.DUPLICATE_TX) return "This transaction was already sent.";
  return "Starknet rejected this transaction. Nothing was sent.";
}
