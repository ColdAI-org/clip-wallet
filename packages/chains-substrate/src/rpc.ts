/** Substrate JSON-RPC over HTTP POST (the legacy RPC spec every public node still serves), with endpoint fallback. */
import { ClipError } from "@clip-wallet/core";

export class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
  }
}

export class SubstrateRpc {
  private id = 0;
  constructor(
    private readonly urls: string[],
    private readonly f: typeof fetch,
  ) {
    if (!urls.length) throw new ClipError("No connection is set up for this network.", "substrate/no-rpc");
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    let last: unknown;
    for (const url of this.urls) {
      let res: Response;
      try {
        res = await this.f(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
        });
      } catch (e) {
        last = e;
        continue;
      }
      if (!res.ok) {
        last = new Error(`HTTP ${res.status}`);
        continue;
      }
      const j = (await res.json()) as { result?: T; error?: { code: number; message: string; data?: unknown } };
      if (j.error) throw new RpcError(j.error.code, j.error.message, j.error.data);
      return j.result as T;
    }
    throw new ClipError("Clip Wallet couldn't reach the network. Check your connection and try again.", "substrate/offline", last);
  }
}

/** Node / runtime error text → plain words. */
export function plainSubstrateError(text: string): string {
  if (/Inability to pay some fees|Payment|balance too low|InsufficientBalance|FundsUnavailable/i.test(text)) return "You don't have enough to cover this and the network fee.";
  if (/Stale|Outdated|AncientBirthBlock|BadProof.*era|Transaction is outdated/i.test(text)) return "This transaction expired before it was sent. Try again.";
  if (/Future/i.test(text)) return "A previous transaction is still pending. Wait a moment and try again.";
  if (/BadProof|Invalid signature/i.test(text)) return "The signature didn't match. Nothing was sent.";
  if (/ExistentialDeposit|KeepAlive|Expendability/i.test(text)) return "That would leave the account below the minimum balance. Send a little less.";
  if (/already imported|Priority is too low/i.test(text)) return "This transaction was already sent.";
  return "The network rejected this transaction. Nothing was sent.";
}
