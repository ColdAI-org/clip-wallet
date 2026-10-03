import { ClipError } from "@clip-wallet/core";

export class GraphQLError extends Error {
  constructor(
    message: string,
    public readonly errors: unknown[],
  ) {
    super(message);
  }
}

/** Minimal Sui GraphQL RPC client over the context's fetch (tests and the extension control networking). */
export class SuiGraphQL {
  constructor(
    readonly url: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ query, variables }),
      });
    } catch (cause) {
      throw new ClipError("Couldn't reach Sui right now. Check your connection and try again.", "sui/rpc-unreachable", cause);
    }
    if (!res.ok && res.status !== 400) throw new ClipError("Sui is slow to answer right now. Try again in a moment.", `sui/rpc-${res.status}`);
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) throw new GraphQLError(body.errors.map((e) => e.message).join("; "), body.errors);
    if (body.data == null) throw new ClipError("Sui sent an empty answer. Try again in a moment.", "sui/rpc-empty");
    return body.data;
  }
}

export const Q = {
  balances: /* GraphQL */ `query clipBalances($owner: SuiAddress!, $after: String) {
  address(address: $owner) { balances(first: 50, after: $after) { pageInfo { hasNextPage endCursor } nodes { coinType { repr } totalBalance } } }
}`,
  coinMetadata: /* GraphQL */ `query clipCoinMetadata($coinType: String!) {
  coinMetadata(coinType: $coinType) { decimals name symbol iconUrl }
}`,
  objects: /* GraphQL */ `query clipObjects($owner: SuiAddress!, $after: String, $type: String) {
  address(address: $owner) { objects(first: 50, after: $after, filter: { type: $type }) {
    pageInfo { hasNextPage endCursor }
    nodes { address version contents { type { repr } json display { output errors } } }
  } }
}`,
  simulate: /* GraphQL */ `query clipSimulate($tx: JSON!) {
  simulateTransaction(transaction: $tx) { effects {
    status
    executionError { message abortCode }
    balanceChanges(first: 50) { nodes { owner { address } coinType { repr } amount } }
    gasEffects { gasSummary { computationCost storageCost storageRebate nonRefundableStorageFee } }
  } }
}`,
  execute: /* GraphQL */ `mutation clipExecute($bytes: Base64!, $signatures: [Base64!]!) {
  executeTransaction(transactionDataBcs: $bytes, signatures: $signatures) { effects {
    status effectsBcs executionError { message } transaction { digest }
  } }
}`,
} as const;

export interface CoinMeta {
  decimals: number;
  name?: string | null;
  symbol?: string | null;
  iconUrl?: string | null;
}

export interface SimEffects {
  status: "SUCCESS" | "FAILURE" | string;
  executionError?: { message?: string | null; abortCode?: string | null } | null;
  balanceChanges?: { nodes: { owner?: { address: string } | null; coinType?: { repr: string } | null; amount: string }[] } | null;
  gasEffects?: { gasSummary?: { computationCost: string | number; storageCost: string | number; storageRebate: string | number } | null } | null;
}

export interface ObjectNode {
  address: string;
  version: string | number;
  contents?: { type?: { repr: string } | null; json?: unknown; display?: { output?: Record<string, unknown> | null; errors?: unknown } | null } | null;
}

/** Plain words for the usual Sui failures. */
export function plainSuiError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("insufficientgas") || s.includes("insufficient gas") || s.includes("gas balance")) return "You don't have enough SUI to pay the network fee.";
  if (s.includes("insufficientcoinbalance") || s.includes("insufficient balance") || s.includes("insufficientfunds")) return "You don't have enough of that coin for this.";
  if (s.includes("moveabort")) return "The app's contract refused this transaction. Nothing was sent.";
  if (s.includes("object") && (s.includes("not available") || s.includes("locked") || s.includes("version"))) return "Something in this transaction changed since the app built it. Ask the app to try again.";
  if (s.includes("signature")) return "Sui didn't accept the signature. Nothing was sent.";
  return "Sui couldn't run this transaction. Nothing was sent.";
}
