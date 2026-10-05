/**
 * Minimal NEAR JSON-RPC client (docs.near.org/api/rpc): `query` (view_account, view_access_key, call_function),
 * `block`, `gas_price`, `send_tx`.
 */
import { b64encode } from "./util.js";

export class RpcError extends Error {
  constructor(
    message: string,
    /** `error.cause.name` (UNKNOWN_ACCOUNT, INVALID_TRANSACTION…) or the raw `result.error` text. */
    public readonly name: string,
    public readonly data?: unknown,
  ) {
    super(message);
  }
}

export interface ViewAccount {
  amount: string;
  locked: string;
  code_hash: string;
  storage_usage: number;
  block_hash: string;
  block_height: number;
}

export type AccessKeyView = {
  nonce: number | string;
  permission: "FullAccess" | { FunctionCall: { allowance: string | null; receiver_id: string; method_names: string[] } } | Record<string, unknown>;
  block_hash: string;
  block_height: number;
};

export class NearRpc {
  private id = 0;
  constructor(
    readonly url: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async call<T>(method: string, params: unknown): Promise<T> {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
    });
    let body: { result?: T & { error?: unknown }; error?: { name?: string; message?: string; data?: unknown; cause?: { name?: string; info?: unknown } } };
    try {
      body = (await res.json()) as typeof body;
    } catch (cause) {
      throw new RpcError(`NEAR RPC ${res.status}`, "BAD_RESPONSE", cause);
    }
    if (body.error) {
      const e = body.error;
      throw new RpcError(String(typeof e.data === "string" ? e.data : (e.message ?? "RPC error")), e.cause?.name ?? e.name ?? "RPC_ERROR", e.data ?? e.cause);
    }
    // Older nodes report query failures inside `result.error`.
    if (body.result && typeof body.result === "object" && typeof body.result.error === "string") {
      const msg = body.result.error;
      throw new RpcError(msg, /access key .* does not exist/i.test(msg) ? "UNKNOWN_ACCESS_KEY" : /does not exist/i.test(msg) ? "UNKNOWN_ACCOUNT" : "QUERY_ERROR", msg);
    }
    if (body.result === undefined) throw new RpcError("empty RPC response", "BAD_RESPONSE");
    return body.result as T;
  }

  viewAccount(accountId: string): Promise<ViewAccount> {
    return this.call("query", { request_type: "view_account", finality: "final", account_id: accountId });
  }

  viewAccessKey(accountId: string, publicKey: string): Promise<AccessKeyView> {
    return this.call("query", { request_type: "view_access_key", finality: "final", account_id: accountId, public_key: publicKey });
  }

  /** call_function with JSON args; returns the parsed JSON result. */
  async view<T>(contract: string, method: string, args: unknown = {}): Promise<T> {
    const r = await this.call<{ result: number[] }>("query", {
      request_type: "call_function",
      finality: "final",
      account_id: contract,
      method_name: method,
      args_base64: b64encode(new TextEncoder().encode(JSON.stringify(args))),
    });
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(r.result))) as T;
  }

  async finalBlockHash(): Promise<string> {
    const b = await this.call<{ header: { hash: string } }>("block", { finality: "final" });
    return b.header.hash;
  }

  /**
   * True when this network has a block with this hash. A NEAR transaction names a recent block hash, which is
   * what ties it to one network (audit NEAR-01); nodes answer UNKNOWN_BLOCK for another network's hash.
   */
  async hasBlock(hashBase58: string): Promise<boolean> {
    try {
      await this.call<{ header: { hash: string } }>("block", { block_id: hashBase58 });
      return true;
    } catch (e) {
      if (e instanceof RpcError && /UNKNOWN_BLOCK/i.test(`${e.name} ${e.message}`)) return false;
      throw e;
    }
  }

  async gasPrice(): Promise<bigint> {
    const r = await this.call<{ gas_price: string }>("gas_price", [null]);
    return BigInt(r.gas_price);
  }
}

/**
 * Plain words for the errors people actually hit. Input: RPC error data / execution failure JSON as text.
 * Names come from nearcore's InvalidTxError / ActionErrorKind (also docs.near.org/api/rpc/transactions).
 */
export function plainNearError(text: string): string {
  const has = (s: string) => text.includes(s);
  if (has("NotEnoughBalance")) return "You don't have enough NEAR to cover this and its network fee.";
  if (has("LackBalanceForState")) {
    return "This would leave too little NEAR to pay for your account's storage. Keep a little more NEAR in the account and try again.";
  }
  if (has("InvalidNonce") || has("NonceTooLarge")) return "Another transaction from this account got there first. Try again.";
  if (has("Expired")) return "This transaction took too long and expired. Try again.";
  if (has("AccountDoesNotExist")) return "One of the accounts in this transaction doesn't exist. Check the account name and try again.";
  if (has("AccountAlreadyExists")) return "That account name is already taken.";
  if (has("InvalidAccessKeyError") || has("AccessKeyNotFound")) return "This wallet's key isn't allowed to do this for that account.";
  if (has("NotEnoughAllowance")) return "This app's key has used up its fee allowance. Sign in to the app again.";
  if (has("DepositWithFunctionCall")) return "This wallet's key can't attach NEAR to app calls for that account.";
  if (has("InvalidSignature")) return "The network rejected the signature. Nothing was sent.";
  if (has("FunctionCallError") || has("ExecutionError") || has("Smart contract panicked")) return "The app's contract rejected this. Any NEAR you attached comes back; the network fee is spent.";
  if (has("TIMEOUT_ERROR") || has("Timeout")) return "The network is slow to confirm. Check your activity before trying again.";
  return "NEAR didn't accept this transaction. Try again in a moment.";
}
