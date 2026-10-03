import { type ChainContext, ClipError } from "@clip-wallet/core";

/** An error answered by an octez node: the JSON error list ([{ kind, id, ... }]). */
export class RpcError extends Error {
  constructor(
    public readonly status: number,
    public readonly errors: TezosRpcErrorItem[],
    public readonly body: string,
  ) {
    super(`tezos rpc ${status}: ${errors.map((e) => e.id).join(", ") || body.slice(0, 200)}`);
  }
}

export interface TezosRpcErrorItem {
  kind?: string;
  id: string;
  with?: unknown;
  [k: string]: unknown;
}

/** Minimal octez node RPC client (https://octez.tezos.com/docs/active/rpc.html). */
export class TezosRpc {
  constructor(
    public readonly url: string,
    private readonly f: typeof fetch,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await this.f(`${this.url.replace(/\/+$/, "")}${path}`, init);
    } catch (cause) {
      throw new ClipError("Couldn't reach the Tezos network. Check your connection and try again.", "tezos/network-unreachable", cause);
    }
    const text = await res.text();
    if (!res.ok) {
      let errors: TezosRpcErrorItem[] = [];
      try {
        const j = JSON.parse(text) as unknown;
        if (Array.isArray(j)) errors = j as TezosRpcErrorItem[];
      } catch {
        /* plain text error */
      }
      throw new RpcError(res.status, errors, text);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }

  branch(): Promise<string> {
    // head~2: a recent block that is very unlikely to be reorganised away (Taquito does the same).
    return this.get<string>("/chains/main/blocks/head~2/hash");
  }

  chainId(): Promise<string> {
    return this.get<string>("/chains/main/chain_id");
  }

  /** null when the account hasn't published (revealed) its public key yet. */
  managerKey(address: string): Promise<string | null> {
    return this.get<string | null>(`/chains/main/blocks/head/context/contracts/${address}/manager_key`);
  }

  async counter(address: string): Promise<bigint> {
    return BigInt(await this.get<string>(`/chains/main/blocks/head/context/contracts/${address}/counter`));
  }

  simulate(body: unknown): Promise<SimulationResult> {
    return this.post<SimulationResult>("/chains/main/blocks/head/helpers/scripts/simulate_operation", body);
  }

  inject(signedHex: string): Promise<string> {
    return this.post<string>("/injection/operation?chain=main", signedHex);
  }
}

export interface OperationResult {
  status: "applied" | "failed" | "backtracked" | "skipped";
  consumed_milligas?: string;
  paid_storage_size_diff?: string;
  storage_size?: string;
  allocated_destination_contract?: boolean;
  originated_contracts?: string[];
  balance_updates?: { kind: string; contract?: string; category?: string; change: string; origin?: string }[];
  errors?: TezosRpcErrorItem[];
}

export interface SimulationResult {
  contents: {
    kind: string;
    metadata?: {
      operation_result?: OperationResult;
      internal_operation_results?: { kind: string; source?: string; destination?: string; amount?: string; result: OperationResult }[];
    };
  }[];
}

/** TzKT API (https://api.tzkt.io). */
export class Tzkt {
  constructor(
    public readonly url: string,
    private readonly f: typeof fetch,
  ) {}

  async get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await this.f(`${this.url.replace(/\/+$/, "")}${path}`);
    } catch (cause) {
      throw new ClipError("Couldn't load your Tezos account. Check your connection and try again.", "tezos/indexer-unreachable", cause);
    }
    if (res.status === 204) return null as T;
    if (!res.ok) throw new ClipError("Couldn't load your Tezos account right now. Try again in a moment.", "tezos/indexer-error");
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }
}

export function rpcFor(ctx: ChainContext): TezosRpc {
  const url = ctx.network.rpcUrls[0];
  if (!url) throw new ClipError("No Tezos connection is set up for this network.", "tezos/no-rpc");
  return new TezosRpc(url, ctx.fetch);
}

export function tzktFor(ctx: ChainContext): Tzkt {
  const url = ctx.network.indexerUrl;
  if (!url) throw new ClipError("No Tezos indexer is set up for this network.", "tezos/no-indexer");
  return new Tzkt(url, ctx.fetch);
}

/* ------------------------------------------------------------------ errors in plain words */

const shortId = (id: string) => id.replace(/^proto\.[^.]+\./, "");

function failwithText(w: unknown): string | null {
  if (!w || typeof w !== "object") return null;
  const o = w as { string?: string; int?: string; prim?: string; args?: unknown[] };
  if (typeof o.string === "string") return o.string;
  if (typeof o.int === "string") return `error ${o.int}`;
  if (o.prim === "Pair" && Array.isArray(o.args)) return o.args.map(failwithText).filter(Boolean).join(" ") || null;
  return null;
}

/** Plain-language message for octez error ids (simulation, injection). Never shows the raw error. */
export function plainTezosError(errors: TezosRpcErrorItem[]): string {
  const ids = errors.map((e) => shortId(e.id ?? ""));
  const has = (s: string) => ids.some((i) => i === s || i.endsWith(`.${s}`) || i.includes(s));
  const rejected = errors.find((e) => shortId(e.id ?? "").endsWith("script_rejected"));
  if (rejected) {
    const msg = failwithText(rejected.with);
    return msg
      ? `The app's contract refused this: “${msg.slice(0, 120)}”. Nothing was sent.`
      : "The app's contract refused this. Nothing was sent.";
  }
  if (has("empty_implicit_contract")) return "Your Tezos account has no XTZ yet. Add some XTZ to pay the network fee, then try again.";
  if (has("balance_too_low") || has("subtraction_underflow")) return "You don't have enough XTZ for this, including the network fee.";
  if (has("cannot_pay_storage_fee")) return "You don't have enough XTZ to pay for the storage this needs.";
  if (has("counter_in_the_past") || has("counter_in_the_future")) return "Another transaction from this account was sent at the same time. Try again.";
  if (has("gas_exhausted") || has("gas_limit_too_high")) return "This needs more processing than one Tezos operation allows. Nothing was sent.";
  if (has("storage_exhausted") || has("storage_limit_too_high")) return "This needs more storage than one Tezos operation allows. Nothing was sent.";
  if (has("unregistered_delegate") || has("delegate.unregistered")) return "That address isn't a Tezos baker. Pick a baker from the list.";
  if (has("delegate.unchanged") || has("no_deletion") || has("delegate_unchanged")) return "You're already delegating to that baker.";
  if (has("staking_to_delegate_that_refuses_external_staking") || has("refuses_external_staking")) return "This baker doesn't accept staking. You can still delegate to it, or pick another baker.";
  if (has("stake_modification_with_no_delegate_set") || has("no_delegate")) return "Pick a baker (delegate) before staking.";
  if (has("invalid_nonzero_transaction_amount") || has("invalid_staking_parameters")) return "That staking request isn't valid. Check the amount and try again.";
  if (has("bad_contract_parameter") || has("invalid_contract") || has("no_such_entrypoint") || has("ill_typed")) return "The app sent a request the contract doesn't accept. Nothing was sent.";
  if (has("non_existing_contract")) return "That contract doesn't exist on this network. Check the address.";
  if (has("previously_revealed_key") || has("unrevealed_key") || has("inconsistent_hash")) return "This account's public key isn't set up as expected. Try again.";
  if (has("fees_too_low") || has("fee_too_low")) return "The network fee was too low. Try again.";
  if (has("operation.invalid_signature") || has("invalid_signature")) return "The signature didn't match. Nothing was sent.";
  if (has("branch") && has("outdated")) return "This took too long and expired. Try again.";
  return "The Tezos network didn't accept this. Nothing was sent. Try again in a moment.";
}

/** Errors reported in a simulation result (per-operation results) or null if everything applied. */
export function simulationErrors(sim: SimulationResult): TezosRpcErrorItem[] | null {
  const errs: TezosRpcErrorItem[] = [];
  let failed = false;
  for (const c of sim.contents) {
    const r = c.metadata?.operation_result;
    if (r && r.status !== "applied") failed = true;
    if (r?.errors) errs.push(...r.errors);
    for (const i of c.metadata?.internal_operation_results ?? []) {
      if (i.result.status !== "applied") failed = true;
      if (i.result.errors) errs.push(...i.result.errors);
    }
  }
  return failed ? errs : null;
}
