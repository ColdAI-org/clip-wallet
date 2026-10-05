import type { AssetRef, BalanceChange, NetworkId, Warning } from "@clip-wallet/core";
import { formatUnits, isUint, short } from "./encoding.js";
import { asAddress, isPrim, parseFa12Approve, parseFa12Transfer, parseFa2Transfer, parseUpdateOperators, preview } from "./micheline.js";
import { tokenAssetKey, xtzAsset } from "./networks.js";
import type { Tzkt } from "./rpc.js";
import { type TzktToken, isSpamToken, tokenAsset } from "./tokens.js";
import { msg, titled, say } from "@clip-wallet/core";

export interface Line {
  label: string;
  value: string;
}

export interface Described {
  title: string;
  lines: Line[];
  balanceChanges: BalanceChange[];
  warnings: Warning[];
  blind: boolean;
}

export interface DescribeContext {
  networkId: NetworkId;
  me: string;
  tzkt: Tzkt | null;
  /** Current baker of `me` (for stake/unstake titles). */
  delegate?: { address: string; alias?: string } | null;
}

export const STAKING_ENTRYPOINTS = ["stake", "unstake", "finalize_unstake"] as const;
export const REVEAL_LINE = "First transaction from this account: it also publishes your account's public key (a one-time step).";
/** Amounts at or above this are treated as "unlimited" approvals. */
const HUGE = 2n ** 128n;

type Op = { kind: string; [k: string]: unknown };

interface OpDescription {
  title: string;
  lines: Line[];
  warnings: Warning[];
  blind: boolean;
  /** Sort key for the batch title: the reveal is never the headline. */
  minor?: boolean;
  staking?: "stake" | "unstake" | "finalize_unstake";
  delegation?: string | null;
}

class Lookups {
  private names = new Map<string, Promise<string | undefined>>();
  private tokens = new Map<string, Promise<TzktToken | null>>();
  private bakers = new Map<string, Promise<{ alias?: string; active?: boolean } | null>>();
  constructor(private readonly tzkt: Tzkt | null) {}

  /** TzKT alias, or the shortened address. Aliases are TzKT's curated names. */
  async name(address: string): Promise<string> {
    if (!this.tzkt) return short(address);
    if (!this.names.has(address)) {
      this.names.set(
        address,
        this.tzkt
          .get<{ alias?: string } | null>(`/v1/accounts/${address}`)
          .then((a) => a?.alias ?? undefined)
          .catch(() => undefined),
      );
    }
    return (await this.names.get(address)!) ?? short(address);
  }

  async token(contract: string, tokenId: string): Promise<TzktToken | null> {
    if (!this.tzkt) return null;
    const k = `${contract}:${tokenId}`;
    if (!this.tokens.has(k)) {
      this.tokens.set(
        k,
        this.tzkt
          .get<TzktToken[]>(`/v1/tokens?contract=${contract}&tokenId=${tokenId}`)
          .then((t) => t?.[0] ?? null)
          .catch(() => null),
      );
    }
    return this.tokens.get(k)!;
  }

  async baker(address: string): Promise<{ alias?: string; active?: boolean } | null> {
    if (!this.tzkt) return null;
    if (!this.bakers.has(address)) {
      this.bakers.set(address, this.tzkt.get<{ alias?: string; active?: boolean } | null>(`/v1/delegates/${address}`).catch(() => null));
    }
    return this.bakers.get(address)!;
  }
}

function xtz(v: bigint): string {
  return `${formatUnits(v, 6)} XTZ`;
}

function amountText(asset: AssetRef, v: bigint): string {
  return `${formatUnits(v < 0n ? -v : v, asset.decimals)} ${asset.symbol}`;
}

class Changes {
  private m = new Map<string, { asset: AssetRef; delta: bigint }>();
  add(asset: AssetRef, delta: bigint) {
    const k = asset.address ? `${asset.address}:${asset.key}` : asset.key;
    const e = this.m.get(k) ?? { asset, delta: 0n };
    e.delta += delta;
    this.m.set(k, e);
  }
  list(): BalanceChange[] {
    return [...this.m.values()].filter((e) => e.delta !== 0n).map((e) => ({ asset: e.asset, delta: e.delta.toString() }));
  }
}

async function tokenFor(look: Lookups, dc: DescribeContext, contract: string, tokenId: string): Promise<AssetRef> {
  const t = await look.token(contract, tokenId);
  if (t) return tokenAsset(dc.networkId, t);
  return {
    key: tokenAssetKey(dc.networkId, contract, tokenId),
    symbol: "tokens",
    name: `Token ${tokenId} of ${short(contract)}`,
    decimals: 0,
    networkId: dc.networkId,
    address: contract,
  };
}

async function describeOp(op: Op, dc: DescribeContext, look: Lookups, changes: Changes): Promise<OpDescription> {
  const xtzRef = xtzAsset(dc.networkId);
  switch (op.kind) {
    case "reveal":
      return { title: "Set up your account", lines: [{ label: "Account setup", value: REVEAL_LINE }], warnings: [], blind: false, minor: true };

    case "delegation": {
      const d = typeof op.delegate === "string" ? op.delegate : null;
      if (!d) {
        return {
          title: "Stop delegating",
          lines: [{ label: "Baker", value: "None. Your XTZ stops earning baking rewards." }],
          warnings: [],
          blind: false,
          delegation: null,
        };
      }
      const b = await look.baker(d);
      const name = b?.alias ?? short(d);
      const inactive = b?.active === false;
      return {
        ...titled(msg("bg.req.delegateTo", { name })),
        lines: [
          { label: "Baker", value: `${name} (${d})` },
          { label: "Your XTZ", value: "Stays in your account and can be spent at any time." },
          ...(inactive ? [{ label: "Note", value: `${name} isn't baking right now, so delegating to it earns nothing.` }] : []),
        ],
        warnings: [],
        blind: false,
        delegation: d,
      };
    }

    case "origination": {
      const balance = BigInt(String(op.balance ?? "0"));
      if (balance > 0n) changes.add(xtzRef, -balance);
      return {
        title: balance > 0n ? `Create a smart contract with ${xtz(balance)}` : "Create a smart contract",
        lines: [
          { label: "Starting balance", value: xtz(balance) },
          ...(typeof op.delegate === "string" ? [{ label: "Contract's baker", value: await look.name(op.delegate) }] : []),
        ],
        warnings: [{ level: "caution", code: "blind-signing", message: "This creates a new smart contract. Clip Wallet can't check what its code does." }],
        blind: false,
      };
    }

    case "transaction":
      return describeTransaction(op, dc, look, changes);

    default:
      return {
        title: `Approve a ${op.kind.replace(/_/g, " ")} operation`,
        lines: [{ label: "Operation", value: op.kind }],
        warnings: [{ level: "danger", code: "blind-signing", message: "Clip Wallet can't explain this kind of operation. Only approve it if you trust the app." }],
        blind: true,
      };
  }
}

async function describeTransaction(op: Op, dc: DescribeContext, look: Lookups, changes: Changes): Promise<OpDescription> {
  const xtzRef = xtzAsset(dc.networkId);
  const me = dc.me;
  const dest = String(op.destination);
  const amount = isUint(op.amount) ? BigInt(op.amount) : 0n;
  const params = op.parameters as { entrypoint: string; value: unknown } | undefined;
  const ep = params?.entrypoint ?? "default";
  const plain = !params || (ep === "default" && isPrim(params.value, "Unit"));
  if (dest !== me && amount > 0n) changes.add(xtzRef, -amount);

  // Staking pseudo-operations: a transaction to yourself with a staking entrypoint (octez docs, "Staking mechanism").
  if (dest === me && (STAKING_ENTRYPOINTS as readonly string[]).includes(ep)) {
    const kind = ep as (typeof STAKING_ENTRYPOINTS)[number];
    const baker = dc.delegate ? (dc.delegate.alias ?? short(dc.delegate.address)) : "your baker";
    if (kind === "stake") {
      return {
        ...titled(msg("bg.req.stakeWith", { amount: xtz(amount), validator: baker })),
        lines: [
          { label: "Stake", value: xtz(amount) },
          { label: "Unstaking", value: "Takes about 4 cycles (around 4 days) before you can withdraw." },
        ],
        warnings: [],
        blind: false,
        staking: kind,
      };
    }
    if (kind === "unstake") {
      return {
        ...titled(msg("bg.req.unstakeFrom", { amount: xtz(amount), validator: baker })),
        lines: [
          { label: "Unstake", value: xtz(amount) },
          { label: "Available", value: "After about 4 cycles (around 4 days), then withdraw it." },
        ],
        warnings: [],
        blind: false,
        staking: kind,
      };
    }
    return { title: "Withdraw your unstaked XTZ", lines: [{ label: "Withdraw", value: "All unstaked XTZ that is ready" }], warnings: [], blind: false, staking: kind };
  }

  if (plain) {
    const to = dest.startsWith("KT1") ? await look.name(dest) : short(dest);
    return {
      title: dest === me ? `Send ${xtz(amount)} to yourself` : say("bg.req.sendTo", { amount: xtz(amount), to }),
      lines: [{ label: "To", value: dest === me ? `${dest} (you)` : dest }],
      warnings: [],
      blind: false,
    };
  }

  const contractName = await look.name(dest);
  const extra: Line[] = amount > 0n ? [{ label: "Also sends", value: xtz(amount) }] : [];

  if (ep === "transfer") {
    const fa2 = parseFa2Transfer(params!.value);
    const fa12 = fa2 ? null : parseFa12Transfer(params!.value);
    const moves = fa2 ?? (fa12 ? [{ ...fa12, tokenId: "0" }] : null);
    if (moves) {
      const lines: Line[] = [];
      const titles: string[] = [];
      for (const mv of moves) {
        const asset = await tokenFor(look, dc, dest, mv.tokenId);
        if (mv.from === me && mv.to !== me) changes.add(asset, -mv.amount);
        if (mv.to === me && mv.from !== me) changes.add(asset, mv.amount);
        const what = amountText(asset, mv.amount);
        if (mv.from === me) {
          titles.push(`Send ${what} to ${short(mv.to)}`);
          lines.push({ label: "To", value: `${mv.to} gets ${what}` });
        } else {
          titles.push(`Move ${what} from ${short(mv.from)} to ${short(mv.to)}`);
          lines.push({ label: "Moves", value: `${what} from ${mv.from} to ${mv.to}` });
        }
      }
      lines.push({ label: "Token contract", value: `${contractName} (${dest})` }, ...extra);
      const unique = [...new Set(titles)];
      return { title: unique.length === 1 ? unique[0]! : `Send tokens to ${moves.length} recipients`, lines, warnings: [], blind: false };
    }
  }

  if (ep === "approve") {
    const a = parseFa12Approve(params!.value);
    if (a) {
      const asset = await tokenFor(look, dc, dest, "0");
      const who = await look.name(a.spender);
      if (a.amount === 0n) {
        return { ...titled(msg("bg.req.removeSpendPermission", { spender: who, symbol: asset.symbol })), lines: [{ label: "App", value: a.spender }, ...extra], warnings: [], blind: false };
      }
      const t = await look.token(dest, "0");
      const supply = t?.totalSupply && isUint(t.totalSupply) ? BigInt(t.totalSupply) : null;
      const unlimited = a.amount >= HUGE || (supply != null && supply > 0n && a.amount >= supply);
      const what = unlimited ? `all your ${asset.symbol}` : `up to ${amountText(asset, a.amount)}`;
      return {
        title: `Let ${who} spend ${what}`,
        lines: [{ label: "Spender", value: a.spender }, { label: "Limit", value: unlimited ? "Unlimited" : amountText(asset, a.amount) }, ...extra],
        warnings: [
          unlimited
            ? { level: "danger", code: "unlimited-approval", message: say("bg.tezos.canTakeAll", { spender: who, symbol: asset.symbol }) }
            : { level: "caution", code: "unlimited-approval", message: say("bg.tezos.canTakeUpTo", { spender: who, amount: amountText(asset, a.amount) }) },
        ],
        blind: false,
      };
    }
  }

  if (ep === "update_operators") {
    const ups = parseUpdateOperators(params!.value);
    if (ups) {
      const lines: Line[] = [];
      const warnings: Warning[] = [];
      let title = "";
      for (const u of ups) {
        const who = await look.name(u.operator);
        if (u.add) {
          if (!title) title = say("bg.req.letMoveTokens", { spender: who, collection: contractName });
          lines.push({ label: "Gives access to", value: `${u.operator} (token ${u.tokenId})` });
          if (!warnings.length) {
            warnings.push({
              level: "danger",
              code: "approval-for-all",
              message: `Lets ${who} move your ${contractName} tokens (token ${u.tokenId}) at any time, without asking again.`,
            });
          }
        } else {
          if (!title) title = say("bg.req.removeTokenAccess", { spender: who, collection: contractName });
          lines.push({ label: "Removes access for", value: `${u.operator} (token ${u.tokenId})` });
        }
        if (u.owner !== me) lines.push({ label: "Owner", value: u.owner });
      }
      lines.push({ label: "Collection", value: `${contractName} (${dest})` }, ...extra);
      return { title, lines, warnings, blind: false };
    }
  }

  return {
    title: amount > 0n ? `Call ${ep} on ${contractName} with ${xtz(amount)}` : say("bg.near.call", { method: ep, contract: contractName }),
    lines: [
      { label: "Contract", value: `${contractName} (${dest})` },
      { label: "Action", value: ep },
      { label: "Details", value: preview(params!.value) },
      ...extra,
    ],
    warnings: [],
    blind: false,
  };
}

/** Plain-language description of a batch of manager operations (fees are added by the caller). */
export async function describeOperations(contents: Op[], dc: DescribeContext): Promise<Described> {
  const look = new Lookups(dc.tzkt);
  const changes = new Changes();
  const ds: OpDescription[] = [];
  for (const op of contents) ds.push(await describeOp(op, dc, look, changes));

  // A delegation in the same batch is the baker for stake/unstake titles.
  const newBaker = ds.find((d) => d.delegation)?.delegation;
  if (newBaker && ds.some((d) => d.staking)) {
    const name = (await look.baker(newBaker))?.alias ?? short(newBaker);
    const ctx = { ...dc, delegate: { address: newBaker, alias: name } };
    for (let i = 0; i < contents.length; i++) if (ds[i]!.staking) ds[i] = await describeOp(contents[i]!, ctx, look, new Changes());
  }

  const main = ds.filter((d) => !d.minor);
  const warnings: Warning[] = [];
  for (const w of ds.flatMap((d) => d.warnings)) if (!warnings.some((x) => x.code === w.code && x.message === w.message)) warnings.push(w);
  const blind = ds.some((d) => d.blind);
  let title: string;
  let lines: Line[];
  const stake = main.find((d) => d.staking === "stake");
  if (main.length === 1) {
    title = main[0]!.title;
    lines = ds.flatMap((d) => d.lines);
  } else if (main.length === 2 && stake && main.some((d) => d.delegation)) {
    title = stake.title;
    lines = [...ds.filter((d) => d.minor).flatMap((d) => d.lines), { label: "Also", value: main.find((d) => d.delegation)!.title }, ...stake.lines];
  } else if (main.length === 0) {
    title = ds[0]?.title ?? "Approve a Tezos operation";
    lines = ds.flatMap((d) => d.lines);
  } else {
    title = say("bg.req.approveOps", { count: main.length });
    lines = ds.flatMap((d, i) => [...(d.minor ? [] : [{ label: say("bg.label.stepN", { n: i + 1 }), value: d.title }]), ...d.lines]);
  }
  return { title, lines, balanceChanges: changes.list(), warnings, blind };
}

export { asAddress, isSpamToken };
