import { ClipError } from "@clip-wallet/core";

/** Soroban (Stellar) RPC, JSON-RPC 2.0. https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods */
export class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
  }
}

export interface SimulateResult {
  transactionData?: string;
  minResourceFee?: string;
  /** base64 DiagnosticEvent XDR. */
  events?: string[];
  results?: { auth: string[]; xdr: string }[];
  stateChanges?: { type: string; key: string; before?: string | null; after?: string | null }[];
  /** Present when simulation failed. */
  error?: string;
  restorePreamble?: unknown;
  latestLedger: number;
}

export interface SendResult {
  status: "PENDING" | "DUPLICATE" | "TRY_AGAIN_LATER" | "ERROR";
  hash: string;
  errorResultXdr?: string;
}

export interface GetTransactionResult {
  status: "SUCCESS" | "FAILED" | "NOT_FOUND";
  resultXdr?: string;
}

export class SorobanRpc {
  private id = 0;
  constructor(
    readonly url: string,
    private readonly f: typeof fetch,
  ) {}

  async call<T>(method: string, params?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.f(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, ...(params === undefined ? {} : { params }) }),
      });
    } catch (cause) {
      throw new ClipError("Couldn't reach the Stellar network. Check your connection and try again.", "stellar/offline", cause);
    }
    const body = (await res.json().catch(() => null)) as { result?: T; error?: { code: number; message: string; data?: unknown } } | null;
    if (!body) throw new RpcError(res.status, `HTTP ${res.status}`);
    if (body.error) throw new RpcError(body.error.code, body.error.message, body.error.data);
    return body.result as T;
  }

  simulate(envelopeXdr: string): Promise<SimulateResult> {
    return this.call<SimulateResult>("simulateTransaction", { transaction: envelopeXdr });
  }

  send(envelopeXdr: string): Promise<SendResult> {
    return this.call<SendResult>("sendTransaction", { transaction: envelopeXdr });
  }

  getTransaction(hash: string): Promise<GetTransactionResult> {
    return this.call<GetTransactionResult>("getTransaction", { hash });
  }

  latestLedger(): Promise<{ sequence: number; closeTime?: string }> {
    return this.call("getLatestLedger");
  }
}
