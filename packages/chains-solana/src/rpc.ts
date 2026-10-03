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

/** Minimal JSON-RPC client over the context's fetch (so tests and the extension control networking). */
export class SolanaRpc {
  private nextId = 1;
  constructor(
    private readonly url: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async call<T>(method: string, params: unknown[] | Record<string, unknown> = []): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
      });
    } catch (cause) {
      throw new ClipError("Couldn't reach Solana right now. Check your connection and try again.", "solana/rpc-unreachable", cause);
    }
    if (!res.ok) throw new ClipError("Solana is slow to answer right now. Try again in a moment.", `solana/rpc-${res.status}`);
    const body = (await res.json()) as { result?: T; error?: { code: number; message: string; data?: unknown } };
    if (body.error) throw new RpcError(body.error.code, body.error.message, body.error.data);
    return body.result as T;
  }
}

export interface ParsedAccount {
  lamports: number;
  owner: string;
  data: { parsed?: { type: string; info: Record<string, unknown> }; program?: string } | [string, string];
  executable: boolean;
}

export async function getMultipleAccounts(
  rpc: SolanaRpc,
  addresses: string[],
  encoding: "jsonParsed" | "base64",
): Promise<(ParsedAccount | null)[]> {
  const out: (ParsedAccount | null)[] = [];
  for (let i = 0; i < addresses.length; i += 100) {
    const chunk = addresses.slice(i, i + 100);
    const r = await rpc.call<{ value: (ParsedAccount | null)[] }>("getMultipleAccounts", [chunk, { encoding, commitment: "confirmed" }]);
    out.push(...r.value);
  }
  return out;
}

export function base64Data(acc: ParsedAccount | null): Uint8Array | null {
  if (!acc || !Array.isArray(acc.data)) return null;
  const s = atob(acc.data[0]);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
