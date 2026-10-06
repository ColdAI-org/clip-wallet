import { ClipError, type ChainContext } from "@clip-wallet/core";
import { specFor } from "./networks.js";

/**
 * A small fuel-core GraphQL client over `ctx.fetch` (no fuels-ts at runtime). Queries are the ones fuels-ts sends
 * (@fuel-ts/account providers/operations.graphql), trimmed to the fields used here. Subscriptions are served as
 * server-sent events on `<url>-sub` (fuels-ts FuelGraphqlSubscriber).
 */

export class GqlError extends Error {
  constructor(
    message: string,
    public readonly kind: "graphql" | "http" | "offline",
  ) {
    super(message);
  }
}

export interface DependentCost {
  base: string;
  unitsPerGas?: string;
  gasPerUnit?: string;
}

export interface ChainInfo {
  chainId: number;
  baseAssetId: string;
  maxInputs: number;
  maxOutputs: number;
  maxGasPerTx: bigint;
  maxSize: bigint;
  gasPriceFactor: bigint;
  gasPerByte: bigint;
  gasCosts: { ecr1: bigint; vmInitialization: DependentCost; s256: DependentCost; contractRoot: DependentCost };
}

export interface Receipt {
  receiptType: string;
  id?: string | null;
  to?: string | null;
  toAddress?: string | null;
  amount?: string | null;
  assetId?: string | null;
  contractId?: string | null;
  subId?: string | null;
  val?: string | null;
  gasUsed?: string | null;
  result?: string | null;
  reason?: string | null;
  sender?: string | null;
  recipient?: string | null;
}

export interface DryRunResult {
  id: string;
  status: { type: "DryRunSuccessStatus" | "DryRunFailureStatus"; totalGas: string; totalFee: string; reason?: string };
  receipts: Receipt[];
}

export type Spendable =
  | { type: "Coin"; utxoId: string; amount: string; assetId: string; owner: string }
  | { type: "MessageCoin"; nonce: string; amount: string; assetId: string; sender: string; recipient: string };

export type FinalStatus =
  | { type: "SuccessStatus"; id?: string }
  | { type: "FailureStatus"; reason: string }
  | { type: "SqueezedOutStatus"; reason: string }
  /** The stream ended after the node accepted the transaction but before a final status. */
  | { type: "SubmittedStatus" };

const DEP = "... on LightOperation { base unitsPerGas } ... on HeavyOperation { base gasPerUnit }";
const CHAIN_QUERY = `query getChain { chain { consensusParameters { chainId baseAssetId txParams { maxInputs maxOutputs maxGasPerTx maxSize } feeParams { gasPriceFactor gasPerByte } gasCosts { ecr1 vmInitialization { ${DEP} } s256 { ${DEP} } contractRoot { ${DEP} } } } } }`;
const RECEIPT = "receiptType id to toAddress amount assetId contractId subId val gasUsed result reason sender recipient";

export function graphqlUrl(ctx: ChainContext): string {
  const url = ctx.network.rpcUrls[0] ?? specFor(ctx.network.id)?.graphql;
  if (!url) throw new ClipError("No connection is set up for this network.", "fuel/no-rpc");
  return url;
}

export function gqlFor(ctx: ChainContext, opts: { timeoutMs?: number } = {}) {
  const url = graphqlUrl(ctx);
  const f = ctx.fetch;

  async function query<T>(q: string, variables?: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await f(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(variables ? { query: q, variables } : { query: q }),
      });
    } catch (e) {
      throw new GqlError(String((e as Error)?.message ?? e), "offline");
    }
    let body: { data?: T; errors?: { message?: string }[] };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new GqlError(`HTTP ${res.status}`, "http");
    }
    if (body.errors?.length) throw new GqlError(body.errors.map((e) => e.message ?? "").join("; "), "graphql");
    if (!res.ok || !body.data) throw new GqlError(`HTTP ${res.status}`, "http");
    return body.data;
  }

  let chain: Promise<ChainInfo> | undefined;

  return {
    query,

    chainInfo(): Promise<ChainInfo> {
      chain ??= query<{ chain: { consensusParameters: Record<string, any> } }>(CHAIN_QUERY).then(({ chain: c }) => {
        const p = c.consensusParameters;
        return {
          chainId: Number(p.chainId),
          baseAssetId: String(p.baseAssetId).toLowerCase(),
          maxInputs: Number(p.txParams.maxInputs),
          maxOutputs: Number(p.txParams.maxOutputs),
          maxGasPerTx: BigInt(p.txParams.maxGasPerTx),
          maxSize: BigInt(p.txParams.maxSize),
          gasPriceFactor: BigInt(p.feeParams.gasPriceFactor),
          gasPerByte: BigInt(p.feeParams.gasPerByte),
          gasCosts: {
            ecr1: BigInt(p.gasCosts.ecr1),
            vmInitialization: p.gasCosts.vmInitialization,
            s256: p.gasCosts.s256,
            contractRoot: p.gasCosts.contractRoot,
          },
        };
      });
      chain.catch(() => (chain = undefined));
      return chain;
    },

    /** fuels-ts `estimateGasPrice(10)`: the gas price expected 10 blocks ahead (U32 is passed as a string). */
    async estimateGasPrice(blockHorizon = 10): Promise<bigint> {
      const d = await query<{ estimateGasPrice: { gasPrice: string } }>("query estimateGasPrice($h: U32!) { estimateGasPrice(blockHorizon: $h) { gasPrice } }", { h: String(blockHorizon) });
      return BigInt(d.estimateGasPrice.gasPrice);
    },

    async balances(owner: string): Promise<{ assetId: string; amount: string }[]> {
      const d = await query<{ balances: { nodes: { assetId: string; amount: string }[] } }>(
        "query getBalances($owner: Address!) { balances(filter: { owner: $owner }, first: 100) { nodes { assetId amount } } }",
        { owner },
      );
      return d.balances.nodes;
    },

    async coinsToSpend(owner: string, want: { assetId: string; amount: bigint }[], excludedUtxos: string[] = []): Promise<Spendable[][]> {
      const d = await query<{ coinsToSpend: (Record<string, string> & { __typename: string })[][] }>(
        "query getCoinsToSpend($owner: Address!, $q: [SpendQueryElementInput!]!, $ex: ExcludeInput) { coinsToSpend(owner: $owner, queryPerAsset: $q, excludedIds: $ex) { __typename ... on Coin { utxoId amount assetId owner } ... on MessageCoin { nonce amount assetId sender recipient } } }",
        { owner, q: want.map((w) => ({ assetId: w.assetId, amount: w.amount.toString() })), ex: { utxos: excludedUtxos, messages: [] } },
      );
      return d.coinsToSpend.map((list) => list.map((c) => ({ ...c, type: c.__typename }) as unknown as Spendable));
    },

    /** `gasPrice` overrides the price the node checks max_fee against ("0": measure gas without a fee). */
    async dryRun(txHex: string, utxoValidation = false, gasPrice?: bigint): Promise<DryRunResult> {
      const d = await query<{ dryRun: { id: string; status: Record<string, string>; receipts: Receipt[] }[] }>(
        `query dryRun($txs: [HexString!]!, $v: Boolean, $p: U64) { dryRun(txs: $txs, utxoValidation: $v, gasPrice: $p) { id status { type: __typename ... on DryRunSuccessStatus { totalGas totalFee } ... on DryRunFailureStatus { totalGas totalFee reason } } receipts { ${RECEIPT} } } }`,
        { txs: [txHex], v: utxoValidation, ...(gasPrice !== undefined ? { p: gasPrice.toString() } : {}) },
      );
      const r = d.dryRun[0];
      if (!r) throw new GqlError("empty dry run", "graphql");
      return r as unknown as DryRunResult;
    },

    /**
     * `submitAndAwaitStatus` (server-sent events on `<url>-sub`): resolves with the final status (success, failure or
     * squeezed out), or SubmittedStatus when the stream ends early (the caller then polls `transactionStatus`).
     */
    async submitAndAwait(txHex: string): Promise<FinalStatus> {
      const STATUS = "type: __typename ... on SuccessStatus { transactionId } ... on FailureStatus { reason } ... on SqueezedOutStatus { reason }";
      let res: Response;
      try {
        res = await f(`${url}-sub`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify({
            query: `subscription submitAndAwaitStatus($tx: HexString!) { submitAndAwaitStatus(tx: $tx) { ${STATUS} } }`,
            variables: { tx: txHex },
            operationName: "submitAndAwaitStatus",
          }),
        });
      } catch (e) {
        throw new GqlError(String((e as Error)?.message ?? e), "offline");
      }
      if (!res.ok || !res.body) throw new GqlError(`HTTP ${res.status}`, "http");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let text = "";
      let submitted = false;
      for (;;) {
        const m = /data:(.*)\n\n/.exec(text);
        if (m) {
          text = text.slice(m.index + m[0].length);
          let ev: { data?: { submitAndAwaitStatus?: { type: string; reason?: string; transactionId?: string } }; errors?: { message?: string }[] };
          try {
            ev = JSON.parse(m[1]!);
          } catch {
            throw new GqlError("unreadable status stream", "http");
          }
          if (ev.errors?.length) throw new GqlError(ev.errors.map((e) => e.message ?? "").join("; "), "graphql");
          const s = ev.data?.submitAndAwaitStatus;
          if (!s) continue;
          submitted = true;
          if (s.type === "SuccessStatus") return { type: "SuccessStatus", ...(s.transactionId ? { id: s.transactionId } : {}) };
          if (s.type === "FailureStatus" || s.type === "SqueezedOutStatus") return { type: s.type, reason: s.reason ?? "" } as FinalStatus;
          continue; // SubmittedStatus / preconfirmations: keep reading
        }
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true }).replace(/:keep-alive-text\n\n/g, "");
      }
      if (!submitted) throw new GqlError("the status stream ended before the node answered", "http");
      return { type: "SubmittedStatus" };
    },

    async transactionStatus(id: string): Promise<{ type: string; reason?: string } | null> {
      const d = await query<{ transaction: { status: { type: string; reason?: string } | null } | null }>(
        "query getTransaction($id: TransactionId!) { transaction(id: $id) { status { type: __typename ... on FailureStatus { reason } ... on SqueezedOutStatus { reason } } } }",
        { id },
      );
      return d.transaction?.status ?? null;
    },
  };
}

export type Gql = ReturnType<typeof gqlFor>;
