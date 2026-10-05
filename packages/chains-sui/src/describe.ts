import type { AssetRef, BalanceChange, NetworkId, Warning } from "@clip-wallet/core";
import { bcs } from "@mysten/sui/bcs";
import type { TransactionData } from "@mysten/sui/transactions";
import { normalizeStructTag, normalizeSuiAddress } from "@mysten/sui/utils";
import { type CoinMeta, type SimEffects, type SuiGraphQL, GraphQLError, Q, plainSuiError } from "./graphql.js";
import { SUI_TYPE, coinAssetKey, suiAsset } from "./networks.js";
import { b64decode, b64encode, formatUnits, short } from "./util.js";
import { say } from "@clip-wallet/core";

export interface Described {
  title: string;
  lines: { label: string; value: string }[];
  balanceChanges: BalanceChange[];
  /** Total gas in MIST (computation + storage − rebate), or the budget when not simulated. */
  fee: bigint;
  sponsored: boolean;
  simulated: boolean;
  warnings: Warning[];
}

type Command = TransactionData["commands"][number];
type Arg = { $kind: string; Input?: number; Result?: number; NestedResult?: [number, number]; GasCoin?: true };

/** Coin plumbing the SDK emits for coinWithBalance / address balances. Never changes who gets what by itself. */
const COIN_PLUMBING = new Set([
  "0x2::coin::redeem_funds",
  "0x2::coin::send_funds",
  "0x2::coin::into_balance",
  "0x2::coin::from_balance",
  "0x2::coin::destroy_zero",
  "0x2::coin::zero",
  "0x2::coin::split",
  "0x2::coin::join",
  "0x2::balance::redeem_funds",
  "0x2::balance::send_funds",
  "0x2::balance::zero",
  "0x2::balance::destroy_zero",
  "0x2::pay::split",
  "0x2::pay::join",
  "0x2::pay::join_vec",
]);

const STAKE = "0x3::sui_system::request_add_stake";
const UNSTAKE = "0x3::sui_system::request_withdraw_stake";

function shortPkg(pkg: string): string {
  const n = normalizeSuiAddress(pkg);
  const trimmed = n.replace(/^0x0+/, "0x");
  return trimmed.length <= 6 ? trimmed : short(n);
}

export function moveTarget(c: { package: string; module: string; function: string }): string {
  const pkg = normalizeSuiAddress(c.package).replace(/^0x0+(?=[0-9a-f])/, "0x");
  return `${pkg}::${c.module}::${c.function}`;
}

function pureU64(data: TransactionData, arg: Arg): bigint | null {
  if (arg.$kind !== "Input" || arg.Input === undefined) return null;
  const input = data.inputs[arg.Input] as { Pure?: { bytes: string } } | undefined;
  if (!input?.Pure) return null;
  try {
    const bytes = b64decode(input.Pure.bytes);
    return bytes.length === 8 ? BigInt(bcs.u64().parse(bytes)) : null;
  } catch {
    return null;
  }
}

function pureAddress(data: TransactionData, arg: Arg): string | null {
  if (arg.$kind !== "Input" || arg.Input === undefined) return null;
  const input = data.inputs[arg.Input] as { Pure?: { bytes: string } } | undefined;
  if (!input?.Pure) return null;
  try {
    const bytes = b64decode(input.Pure.bytes);
    return bytes.length === 32 ? normalizeSuiAddress(bcs.Address.parse(bytes)) : null;
  } catch {
    return null;
  }
}

/** Coin metadata, cached per endpoint. */
const metaCache = new Map<string, Promise<CoinMeta | null>>();
export function clearCoinCache(): void {
  metaCache.clear();
}

export function coinMeta(gql: SuiGraphQL, coinType: string): Promise<CoinMeta | null> {
  const t = normalizeStructTag(coinType);
  const key = `${gql.url}|${t}`;
  let p = metaCache.get(key);
  if (!p) {
    p = gql
      .query<{ coinMetadata: CoinMeta | null }>(Q.coinMetadata, { coinType: t })
      .then((r) => r.coinMetadata)
      .catch(() => {
        metaCache.delete(key);
        return null;
      });
    metaCache.set(key, p);
  }
  return p;
}

export function assetFor(networkId: NetworkId, coinType: string, meta: CoinMeta | null): AssetRef {
  const t = normalizeStructTag(coinType);
  if (t === SUI_TYPE) return suiAsset(networkId);
  const tail = t.split("::").pop() ?? "TOKEN";
  const a: AssetRef = {
    key: coinAssetKey(networkId, t),
    symbol: meta?.symbol || tail,
    name: meta?.name || meta?.symbol || tail,
    decimals: meta?.decimals ?? 0,
    networkId,
    address: t,
  };
  if (meta?.iconUrl && /^https:\/\//.test(meta.iconUrl)) a.logoUrl = meta.iconUrl;
  return a;
}

export async function simulate(gql: SuiGraphQL, txBytes: Uint8Array): Promise<SimEffects> {
  const r = await gql.query<{ simulateTransaction: { effects: SimEffects | null } | null }>(Q.simulate, { tx: { bcs: { value: b64encode(txBytes) } } });
  const e = r.simulateTransaction?.effects;
  if (!e) throw new Error("no simulation effects");
  return e;
}

export function gasOf(e: SimEffects): bigint | null {
  const g = e.gasEffects?.gasSummary;
  if (!g) return null;
  return BigInt(g.computationCost) + BigInt(g.storageCost) - BigInt(g.storageRebate);
}

export interface DescribeOptions {
  networkId: NetworkId;
  me: string;
  gql: SuiGraphQL;
  host: string;
  simulate: boolean;
}

/** Plain-language description of a Sui programmable transaction, plus a dry run for balance changes and gas. */
export async function describeTransaction(data: TransactionData, bytes: Uint8Array, o: DescribeOptions): Promise<Described> {
  const me = normalizeSuiAddress(o.me);
  const gasOwner = data.gasData.owner ? normalizeSuiAddress(data.gasData.owner) : me;
  const sponsored = gasOwner !== me;
  const lines: { label: string; value: string }[] = [];
  const warnings: Warning[] = [];
  const targets: string[] = [];
  const recipients = new Set<string>();
  let gasSplit: bigint | null = null; // SplitCoins(GasCoin, [x]) total
  let onlyTransfers = true;
  let stake: { validator: string | null } | null = null;
  let unstake = false;

  for (const raw of data.commands as Command[]) {
    const c = raw as Record<string, unknown> & { $kind: string };
    switch (c.$kind) {
      case "SplitCoins": {
        const s = c.SplitCoins as { coin: Arg; amounts: Arg[] };
        if (s.coin.$kind === "GasCoin") {
          for (const a of s.amounts) {
            const v = pureU64(data, a);
            gasSplit = v == null || gasSplit === -1n ? -1n : (gasSplit ?? 0n) + v;
          }
        }
        break;
      }
      case "MergeCoins":
        break;
      case "TransferObjects": {
        const t = c.TransferObjects as { objects: Arg[]; address: Arg };
        const to = pureAddress(data, t.address);
        if (to) recipients.add(to);
        lines.push({ label: "Sends to", value: to ? (to === me ? "Your own account" : to) : "an address the app computes" });
        break;
      }
      case "MoveCall": {
        const m = c.MoveCall as { package: string; module: string; function: string; arguments: Arg[] };
        const target = moveTarget(m);
        if (COIN_PLUMBING.has(target)) break;
        onlyTransfers = false;
        if (target === STAKE) {
          const v = m.arguments[2] ? pureAddress(data, m.arguments[2]) : null;
          stake = { validator: v };
          lines.push({ label: "Stake with", value: v ?? "a validator" });
        } else if (target === UNSTAKE) {
          unstake = true;
          lines.push({ label: "Action", value: "Withdraw a stake (principal plus rewards)" });
        } else {
          targets.push(target);
          lines.push({ label: "App action", value: `${shortPkg(m.package)}::${m.module}::${m.function}` });
        }
        break;
      }
      case "MakeMoveVec":
        break;
      case "Publish":
        onlyTransfers = false;
        lines.push({ label: "Action", value: "Publishes new contract code" });
        warnings.push({ level: "caution", code: "blind-signing", message: "This publishes new contract code from your account. Only continue if you wrote it." });
        break;
      case "Upgrade":
        onlyTransfers = false;
        lines.push({ label: "Action", value: "Upgrades contract code you control" });
        warnings.push({ level: "caution", code: "blind-signing", message: "This upgrades a contract you control. Only continue if you meant to." });
        break;
      default:
        onlyTransfers = false;
        lines.push({ label: "Action", value: c.$kind });
    }
  }

  const budget = BigInt(data.gasData.budget ?? 0);
  let fee = budget;
  let simulated = false;
  const changes = new Map<string, bigint>();
  const received = new Map<string, Map<string, bigint>>(); // recipient → coinType → amount

  if (o.simulate) {
    try {
      const e = await simulate(o.gql, bytes);
      simulated = true;
      if (e.status !== "SUCCESS") {
        warnings.push({
          level: "danger",
          code: "simulation-failed",
          message: `This transaction would fail: ${plainSuiError(e.executionError?.message ?? "")}`,
        });
      }
      const gas = gasOf(e);
      if (gas != null) fee = gas < 0n ? 0n : gas;
      for (const n of e.balanceChanges?.nodes ?? []) {
        const owner = n.owner?.address ? normalizeSuiAddress(n.owner.address) : null;
        const type = n.coinType?.repr ? normalizeStructTag(n.coinType.repr) : null;
        if (!owner || !type) continue;
        if (owner === me) changes.set(type, (changes.get(type) ?? 0n) + BigInt(n.amount));
        else if (BigInt(n.amount) > 0n) {
          const m = received.get(owner) ?? new Map<string, bigint>();
          m.set(type, (m.get(type) ?? 0n) + BigInt(n.amount));
          received.set(owner, m);
        }
      }
      // The fee is shown on its own line: take it out of my SUI change when I pay gas.
      if (!sponsored && gas != null) {
        const sui = (changes.get(SUI_TYPE) ?? 0n) + gas;
        if (sui === 0n) changes.delete(SUI_TYPE);
        else changes.set(SUI_TYPE, sui);
      }
    } catch (err) {
      const msg = err instanceof GraphQLError ? plainSuiError(err.message) : "Clip Wallet couldn't preview this transaction.";
      warnings.push({ level: "caution", code: "simulation-failed", message: `${msg} Check the details carefully.` });
    }
  }

  const balanceChanges: BalanceChange[] = [];
  for (const [type, delta] of changes) {
    if (delta === 0n) continue;
    balanceChanges.push({ asset: assetFor(o.networkId, type, await coinMeta(o.gql, type)), delta: delta.toString() });
  }

  if (sponsored) {
    lines.push({ label: "Network fee", value: `Paid by ${short(gasOwner)}` });
    warnings.push({ level: "info", code: "network-matters", message: "Another account pays the network fee for this transaction." });
  }

  // Audit UNK-01: an app's own Move functions can take any object passed to them (NFTs, kiosks, caps), and only coin
  // balances are previewed. Say so instead of presenting the call as fully understood.
  if (targets.length) {
    warnings.push({
      level: "caution",
      code: "unknown-call",
      message: say("bg.warn.runsOwnCode", { host: o.host }),
    });
  }

  // Title: the plainest true sentence we can say.
  let title = say("bg.req.approveTxFor", { host: o.host });
  const others = [...recipients].filter((r) => r !== me);
  if (stake) {
    const amt = changes.get(SUI_TYPE);
    title = amt != null && amt < 0n ? say("bg.req.stake", { amount: `${formatUnits(-amt, 9)} SUI` }) : gasSplit && gasSplit > 0n ? say("bg.req.stake", { amount: `${formatUnits(gasSplit, 9)} SUI` }) : "Stake SUI";
  } else if (unstake && targets.length === 0) {
    title = "Unstake SUI";
  } else if (onlyTransfers && others.length === 1) {
    const to = others[0]!;
    const got = received.get(to);
    if (got && got.size === 1) {
      const [type, amount] = [...got][0]!;
      const a = assetFor(o.networkId, type, await coinMeta(o.gql, type));
      title = say("bg.req.sendSymbolTo", { amount: formatUnits(amount, a.decimals), symbol: a.symbol, to: short(to) });
    } else if (!simulated && gasSplit != null && gasSplit > 0n) {
      title = say("bg.req.sendTo", { amount: `${formatUnits(gasSplit, 9)} SUI`, to: short(to) });
    } else {
      title = say("bg.req.sendToOnly", { to: short(to) });
    }
  } else if (targets.length === 1) {
    const fn = targets[0]!.split("::")[2] ?? "";
    const words = fn.replace(/_/g, " ").trim();
    title = words ? `${words[0]!.toUpperCase()}${words.slice(1)} on ${o.host}` : `Use ${o.host}`;
  }

  return { title, lines, balanceChanges, fee, sponsored, simulated, warnings };
}
