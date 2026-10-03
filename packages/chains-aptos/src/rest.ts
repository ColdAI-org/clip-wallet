import { ClipError } from "@clip-wallet/core";

export class AptosApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errorCode?: string,
    public readonly vmErrorCode?: number,
  ) {
    super(message);
  }
}

/** Aptos fullnode REST API (and the indexer's GraphQL) over the context's fetch. */
export class AptosRest {
  constructor(
    readonly base: string,
    private readonly fetchImpl: typeof fetch,
    readonly indexer?: string,
  ) {}

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, init);
    } catch (cause) {
      throw new ClipError("Couldn't reach Aptos right now. Check your connection and try again.", "aptos/rpc-unreachable", cause);
    }
  }

  private async json<T>(res: Response): Promise<T> {
    const body = (await res.json().catch(() => null)) as (T & { message?: string; error_code?: string; vm_error_code?: number }) | null;
    if (!res.ok) {
      if (res.status >= 500 || res.status === 429) throw new ClipError("Aptos is slow to answer right now. Try again in a moment.", `aptos/rpc-${res.status}`);
      throw new AptosApiError(res.status, body?.message ?? `HTTP ${res.status}`, body?.error_code, body?.vm_error_code);
    }
    return body as T;
  }

  async get<T>(path: string): Promise<T> {
    return this.json<T>(await this.send(`${this.base}${path}`, { method: "GET", headers: { accept: "application/json" } }));
  }

  async postBcs<T>(path: string, bytes: Uint8Array): Promise<T> {
    return this.json<T>(
      await this.send(`${this.base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/x.aptos.signed_transaction+bcs", accept: "application/json" },
        body: bytes as unknown as BodyInit,
      }),
    );
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    return this.json<T>(
      await this.send(`${this.base}${path}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) }),
    );
  }

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    if (!this.indexer) throw new ClipError("No Aptos indexer is set up for this network.", "aptos/no-indexer");
    const res = await this.send(this.indexer, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }) });
    const body = await this.json<{ data?: T; errors?: { message: string }[] }>(res);
    if (body.errors?.length || !body.data) throw new Error(body.errors?.map((e) => e.message).join("; ") ?? "empty indexer answer");
    return body.data;
  }
}

/** Plain words for the usual Aptos failures (vm_status / API messages). */
export function plainAptosError(raw: string): string {
  const s = raw.toUpperCase();
  if (s.includes("INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE")) return "You don't have enough APT to pay the network fee.";
  if (s.includes("EINSUFFICIENT_BALANCE") || s.includes("INSUFFICIENT_BALANCE")) return "You don't have enough of that asset for this.";
  if (s.includes("SEQUENCE_NUMBER_TOO_OLD") || s.includes("SEQUENCE_NUMBER_TOO_NEW")) return "Another transaction from this account went first. Ask the app to try again.";
  if (s.includes("TRANSACTION_EXPIRED")) return "This transaction expired before it was sent. Ask the app to try again.";
  if (s.includes("INVALID_SIGNATURE") || s.includes("INVALID_AUTH_KEY")) return "Aptos didn't accept the signature. Nothing was sent.";
  if (s.includes("ACCOUNT_DOES_NOT_EXIST") || s.includes("SENDING_ACCOUNT_DOES_NOT_EXIST")) return "This account isn't on Aptos yet. Receive some APT first.";
  if (s.includes("MOVE_ABORT") || s.includes("ABORTED")) return "The app's contract refused this transaction. Nothing was sent.";
  if (s.includes("MAX_GAS") || s.includes("OUT_OF_GAS")) return "This transaction needs more network fee than the app allowed.";
  return "Aptos couldn't run this transaction. Nothing was sent.";
}
