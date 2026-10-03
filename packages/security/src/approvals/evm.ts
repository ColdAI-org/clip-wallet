import type { AssetRef, ChainContext, DappRequest } from "@clip-wallet/core";
import { formatUnits, type Step } from "@clip-wallet/features";
import {
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  isAddressEqual,
  pad,
  parseAbi,
  toEventSelector,
  type Hex,
} from "viem";
import { spenderName } from "../labels.js";
import { JsonRpcError, fetchJson, mapLimit, randomId, rpcCall, shortAddress } from "../util.js";
import { type ApprovalScanner, type Grant, type RevokeSpec, type ScanOptions, type ScanResult, grantId, risksFor } from "./types.js";

/**
 * EVM standing permissions.
 *
 * Discovery: the logs that GRANT a permission, filtered by owner = you:
 *  - ERC-20 `Approval(address indexed owner, address indexed spender, uint256 value)` (EIP-20). ERC-721's
 *    `Approval` has the same signature but a 4th indexed topic (tokenId); single-token NFT approvals are
 *    cleared when the NFT moves and are skipped here.
 *  - `ApprovalForAll(address indexed owner, address indexed operator, bool approved)` (EIP-721 / EIP-1155).
 *  - Permit2 `Approval(owner, token, spender, uint160 amount, uint48 expiration)` and
 *    `Permit(owner, token, spender, uint160 amount, uint48 expiration, uint48 nonce)`
 *    (Uniswap/permit2 src/interfaces/IAllowanceTransfer.sol).
 * Source: Blockscout's Etherscan-compatible `GET /api?module=logs&action=getLogs` (topic0 + topic1 with
 * topic0_1_opr=and; at most 1000 per page) when the network has Blockscout, else `eth_getLogs` over the last
 * `lookbackBlocks` in `maxBlockRange` chunks (halving on "range too large").
 *
 * Then the CURRENT state is read on-chain: `allowance(owner, spender)`, `isApprovedForAll(owner, operator)`
 * and Permit2 `allowance(user, token, spender) → (amount, expiration, nonce)`. Only live grants are listed.
 *
 * Revoke: `approve(spender, 0)`, `setApprovalForAll(operator, false)` (both decoded in plain words by
 * chains-evm), and one Permit2 `lockdown(TokenSpenderPair[])` per network (verified against the bytes, then
 * lifted from blind only with a successful simulation, like the 0x swap step).
 *
 * Privacy: these reads go to the same RPC and Blockscout the wallet already uses for balances.
 */
export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

export const TOPIC = {
  approval: toEventSelector("Approval(address,address,uint256)"),
  approvalForAll: toEventSelector("ApprovalForAll(address,address,bool)"),
  permit2Approval: toEventSelector("Approval(address,address,address,uint160,uint48)"),
  permit2Permit: toEventSelector("Permit(address,address,address,uint160,uint48,uint48)"),
} as const;

const NFT_ABI = parseAbi([
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
  "function name() view returns (string)",
]);
export const PERMIT2_ABI = parseAbi([
  "struct TokenSpenderPair { address token; address spender; }",
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function lockdown(TokenSpenderPair[] approvals)",
]);

const UNLIMITED_256 = 2n ** 255n;
const UNLIMITED_160 = 2n ** 159n;

export interface RawLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  logIndex?: string;
  timeStamp?: string;
  blockTimestamp?: string;
  transactionHash?: string;
}

type PairKind = "erc20" | "nft-all" | "permit2";

interface Pair {
  kind: PairKind;
  contract: string;
  token: string;
  spender: string;
  /** Values seen in grant logs, oldest first. */
  values: bigint[];
  lastAt?: number;
  lastBlock: bigint;
}

const topicAddr = (t: string | undefined): string | null => (t && t.length === 66 ? getAddress(`0x${t.slice(26)}`) : null);

function logTime(l: RawLog): number | undefined {
  const raw = l.timeStamp ?? l.blockTimestamp;
  if (!raw) return undefined;
  const n = raw.startsWith("0x") ? Number(BigInt(raw)) : Number(raw);
  return Number.isFinite(n) && n > 0 ? n * 1000 : undefined;
}

function word(data: string, i: number): bigint {
  const h = data.replace(/^0x/, "").slice(i * 64, i * 64 + 64);
  return h ? BigInt(`0x${h}`) : 0n;
}

/** Fold grant logs into one entry per (contract, token, spender). */
export function pairsFromLogs(logs: RawLog[], owner: string): Pair[] {
  const me = getAddress(owner);
  const pairs = new Map<string, Pair>();
  const sorted = [...logs].sort((a, b) => {
    const d = BigInt(a.blockNumber) - BigInt(b.blockNumber);
    return d !== 0n ? (d < 0n ? -1 : 1) : Number(BigInt(a.logIndex ?? "0") - BigInt(b.logIndex ?? "0"));
  });
  for (const l of sorted) {
    const t0 = l.topics[0]?.toLowerCase();
    if (topicAddr(l.topics[1]) !== me) continue;
    let p: Omit<Pair, "values" | "lastBlock" | "lastAt"> | null = null;
    let value = 0n;
    if (t0 === TOPIC.approval && l.topics.length === 3) {
      p = { kind: "erc20", contract: getAddress(l.address), token: getAddress(l.address), spender: topicAddr(l.topics[2])! };
      value = word(l.data, 0);
    } else if (t0 === TOPIC.approvalForAll && l.topics.length === 3) {
      p = { kind: "nft-all", contract: getAddress(l.address), token: getAddress(l.address), spender: topicAddr(l.topics[2])! };
      value = word(l.data, 0);
    } else if ((t0 === TOPIC.permit2Approval || t0 === TOPIC.permit2Permit) && l.topics.length === 4 && isAddressEqual(getAddress(l.address), PERMIT2)) {
      p = { kind: "permit2", contract: PERMIT2, token: topicAddr(l.topics[2])!, spender: topicAddr(l.topics[3])! };
      value = word(l.data, 0);
    }
    if (!p) continue;
    const key = `${p.kind}|${p.token}|${p.spender}`;
    const prev = pairs.get(key);
    const at = logTime(l);
    if (prev) {
      prev.values.push(value);
      prev.lastBlock = BigInt(l.blockNumber);
      prev.lastAt = at ?? prev.lastAt;
    } else {
      pairs.set(key, { ...p, values: [value], lastBlock: BigInt(l.blockNumber), lastAt: at });
    }
  }
  return [...pairs.values()];
}

/* ------------------------------------------------------------------ log sources */

function blockscoutRoot(ctx: ChainContext): string | null {
  const u = ctx.network.indexerUrl;
  if (!u || !/\/api\/v2\/?$/.test(u)) return null;
  return u.replace(/\/api\/v2\/?$/, "");
}

/** Blockscout Etherscan-compatible getLogs, following pages of 1000 by moving fromBlock forward. */
export async function blockscoutLogs(ctx: ChainContext, root: string, topic0: string, owner: string, address?: string): Promise<RawLog[]> {
  const out = new Map<string, RawLog>();
  let from = "0";
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ module: "logs", action: "getLogs", fromBlock: from, toBlock: "latest", topic0, topic1: pad(getAddress(owner).toLowerCase() as Hex), topic0_1_opr: "and" });
    if (address) q.set("address", address);
    const body = await fetchJson<{ result?: RawLog[] | string; message?: string }>(ctx.fetch, `${root}/api?${q}`, "the explorer");
    const logs = Array.isArray(body.result) ? body.result : [];
    for (const l of logs) out.set(`${l.transactionHash}|${l.logIndex}|${l.topics[0]}`, l);
    if (logs.length < 1000) break;
    from = BigInt(logs[logs.length - 1]!.blockNumber).toString();
  }
  return [...out.values()];
}

/** eth_getLogs over the recent past, OR-ing every grant topic in one filter. Returns logs and whether it covered everything asked. */
export async function rpcLogs(ctx: ChainContext, owner: string, lookbackBlocks: number, maxRange: number): Promise<{ logs: RawLog[]; complete: boolean }> {
  const url = ctx.network.rpcUrls[0];
  if (!url) return { logs: [], complete: false };
  const latest = BigInt(await rpcCall<string>(ctx.fetch, url, "eth_blockNumber", []));
  const start = latest > BigInt(lookbackBlocks) ? latest - BigInt(lookbackBlocks) : 0n;
  const ownerTopic = pad(getAddress(owner).toLowerCase() as Hex);
  const topics = [[TOPIC.approval, TOPIC.approvalForAll, TOPIC.permit2Approval, TOPIC.permit2Permit], ownerTopic];
  const logs: RawLog[] = [];
  let range = BigInt(maxRange);
  let from = start;
  let complete = true;
  while (from <= latest) {
    const to = from + range - 1n > latest ? latest : from + range - 1n;
    try {
      const got = await rpcCall<RawLog[]>(ctx.fetch, url, "eth_getLogs", [{ fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics }]);
      logs.push(...got);
      from = to + 1n;
    } catch (e) {
      if (e instanceof JsonRpcError && range > 500n) {
        range /= 2n;
        continue;
      }
      complete = false;
      break;
    }
  }
  // Complete only if every chunk answered AND the window reached the first block.
  return { logs, complete: complete && start === 0n };
}

/* ------------------------------------------------------------------ on-chain reads */

async function call(ctx: ChainContext, to: string, data: Hex): Promise<Hex | null> {
  const url = ctx.network.rpcUrls[0];
  if (!url) return null;
  try {
    return await rpcCall<Hex>(ctx.fetch, url, "eth_call", [{ to, data }, "latest"]);
  } catch {
    return null;
  }
}

async function tokenMeta(ctx: ChainContext, token: string, assets: AssetRef[]): Promise<{ symbol: string; name: string; decimals: number }> {
  const known = assets.find((a) => a.networkId === ctx.network.id && a.address && isAddressEqual(getAddress(a.address), getAddress(token)));
  if (known) return { symbol: known.symbol, name: known.name, decimals: known.decimals };
  const read = async (fn: "symbol" | "name" | "decimals") => {
    const raw = await call(ctx, token, encodeFunctionData({ abi: erc20Abi, functionName: fn }));
    if (!raw || raw === "0x") return undefined;
    try {
      return decodeFunctionResult({ abi: erc20Abi, functionName: fn, data: raw });
    } catch {
      return undefined;
    }
  };
  const [symbol, name, decimals] = await Promise.all([read("symbol"), read("name"), read("decimals")]);
  return { symbol: typeof symbol === "string" && symbol ? symbol : shortAddress(token), name: typeof name === "string" && name ? name : "Token", decimals: typeof decimals === "number" ? decimals : 18 };
}

async function collectionName(ctx: ChainContext, collection: string): Promise<string> {
  const raw = await call(ctx, collection, encodeFunctionData({ abi: NFT_ABI, functionName: "name" }));
  if (raw && raw !== "0x") {
    try {
      const n = decodeFunctionResult({ abi: NFT_ABI, functionName: "name", data: raw });
      if (n) return n;
    } catch {
      // fall through
    }
  }
  return shortAddress(collection);
}

/* ------------------------------------------------------------------ scanner */

export class EvmApprovals implements ApprovalScanner {
  readonly family = "evm" as const;

  constructor(private readonly assets: () => AssetRef[] = () => []) {}

  async scan(ctx: ChainContext, opts: ScanOptions): Promise<ScanResult> {
    const owner = getAddress(ctx.account.address);
    const partial: ScanResult["partial"] = [];
    let logs: RawLog[] = [];
    const root = blockscoutRoot(ctx);
    if (root) {
      const sets = await Promise.all([
        blockscoutLogs(ctx, root, TOPIC.approval, owner),
        blockscoutLogs(ctx, root, TOPIC.approvalForAll, owner),
        blockscoutLogs(ctx, root, TOPIC.permit2Approval, owner, PERMIT2),
        blockscoutLogs(ctx, root, TOPIC.permit2Permit, owner, PERMIT2),
      ]);
      logs = sets.flat();
    } else {
      const r = await rpcLogs(ctx, owner, opts.evm.lookbackBlocks, opts.evm.maxBlockRange);
      logs = r.logs;
      if (!r.complete) {
        partial.push({ code: "approvals/recent-only", network: ctx.network.name, message: `On ${ctx.network.name} only recent permissions could be checked. Older ones may still be there.` });
      }
    }
    const pairs = pairsFromLogs(logs, owner);
    const grants = (await mapLimit(pairs, 6, (p) => this.current(ctx, owner, p, opts))).filter((g): g is Grant => g !== null);
    return { grants, partial };
  }

  private async current(ctx: ChainContext, owner: string, p: Pair, opts: ScanOptions): Promise<Grant | null> {
    const name = spenderName("evm", p.spender);
    const base = { spenderKnown: !!name, flagged: opts.isFlagged(p.spender), grantedAt: p.lastAt, now: opts.now, oldAfterDays: opts.oldAfterDays };
    const who = name ?? "An unknown app";
    const spender = { address: p.spender, name, known: !!name };

    if (p.kind === "erc20") {
      const raw = await call(ctx, p.token, encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [owner as Hex, p.spender as Hex] }));
      if (!raw || raw === "0x") return null;
      const amount = decodeFunctionResult({ abi: erc20Abi, functionName: "allowance", data: raw });
      if (amount === 0n) return null;
      const meta = await tokenMeta(ctx, p.token, this.assets());
      const unlimited = amount >= UNLIMITED_256;
      const unused = !unlimited && p.values.every((v) => v === amount);
      const spec: RevokeSpec = { kind: "erc20", token: p.token, spender: p.spender };
      return {
        revoke: spec,
        view: {
          id: grantId(ctx.network.id, spec),
          kind: "token-allowance",
          family: "evm",
          title: unlimited ? `${who} can spend all your ${meta.symbol}` : `${who} can spend up to ${formatUnits(amount, meta.decimals)} ${meta.symbol}`,
          asset: { symbol: meta.symbol, name: meta.name, address: p.token },
          spender,
          amount: unlimited ? `All your ${meta.symbol}` : `Up to ${formatUnits(amount, meta.decimals)} ${meta.symbol}`,
        ...(unlimited ? {} : { limit: formatUnits(amount, meta.decimals) }),
          ...(unlimited ? {} : { limit: formatUnits(amount, meta.decimals) }),
          unlimited,
          grantedAt: p.lastAt,
          ...risksFor({ ...base, unlimited, unused }),
          networkId: ctx.network.id,
        },
      };
    }

    if (p.kind === "nft-all") {
      const raw = await call(ctx, p.contract, encodeFunctionData({ abi: NFT_ABI, functionName: "isApprovedForAll", args: [owner as Hex, p.spender as Hex] }));
      if (!raw || raw === "0x") return null;
      if (!decodeFunctionResult({ abi: NFT_ABI, functionName: "isApprovedForAll", data: raw })) return null;
      const coll = await collectionName(ctx, p.contract);
      const spec: RevokeSpec = { kind: "nft-all", collection: p.contract, operator: p.spender };
      return {
        revoke: spec,
        view: {
          id: grantId(ctx.network.id, spec),
          kind: "nft-all",
          family: "evm",
          title: `${who} can move every NFT you hold in ${coll}`,
          asset: { symbol: coll, name: coll, address: p.contract },
          spender,
          amount: `Every NFT in ${coll}`,
          unlimited: true,
          grantedAt: p.lastAt,
          ...risksFor({ ...base, unlimited: true }),
          networkId: ctx.network.id,
        },
      };
    }

    const raw = await call(ctx, PERMIT2, encodeFunctionData({ abi: PERMIT2_ABI, functionName: "allowance", args: [owner as Hex, p.token as Hex, p.spender as Hex] }));
    if (!raw || raw === "0x") return null;
    const [amount, expiration] = decodeFunctionResult({ abi: PERMIT2_ABI, functionName: "allowance", data: raw });
    const expiresAt = Number(expiration) * 1000;
    if (amount === 0n || expiresAt <= opts.now) return null;
    const meta = await tokenMeta(ctx, p.token, this.assets());
    const unlimited = amount >= UNLIMITED_160;
    const spec: RevokeSpec = { kind: "permit2", token: p.token, spender: p.spender };
    return {
      revoke: spec,
      view: {
        id: grantId(ctx.network.id, spec),
        kind: "permit2",
        family: "evm",
        title: unlimited ? `${who} can spend all your ${meta.symbol} through Permit2` : `${who} can spend up to ${formatUnits(amount, meta.decimals)} ${meta.symbol} through Permit2`,
        asset: { symbol: meta.symbol, name: meta.name, address: p.token },
        spender,
        amount: unlimited ? `All your ${meta.symbol}` : `Up to ${formatUnits(amount, meta.decimals)} ${meta.symbol}`,
        unlimited,
        grantedAt: p.lastAt,
        expiresAt,
        ...risksFor({ ...base, unlimited }),
        networkId: ctx.network.id,
      },
    };
  }

  async revoke(grants: Grant[], ctx: ChainContext): Promise<Step[]> {
    const from = getAddress(ctx.account.address);
    const mk = (to: string, data: Hex): DappRequest => ({
      id: randomId(),
      origin: "wallet",
      via: "injected",
      family: "evm",
      networkId: ctx.network.id,
      method: "eth_sendTransaction",
      params: [{ from, to: getAddress(to), value: "0x0", data }],
    });
    const steps: Step[] = [];
    const permit2: { token: Hex; spender: Hex }[] = [];
    for (const g of grants) {
      const s = g.revoke;
      const who = g.view.spender.name ?? shortAddress(g.view.spender.address);
      if (s.kind === "erc20") {
        steps.push({ title: `Stop ${who} from spending your ${g.view.asset.symbol}`, request: mk(s.token, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [getAddress(s.spender), 0n] })) });
      } else if (s.kind === "nft-all") {
        steps.push({ title: `Stop ${who} from moving your ${g.view.asset.symbol} NFTs`, request: mk(s.collection, encodeFunctionData({ abi: NFT_ABI, functionName: "setApprovalForAll", args: [getAddress(s.operator), false] })) });
      } else if (s.kind === "permit2") {
        permit2.push({ token: getAddress(s.token), spender: getAddress(s.spender) });
      }
    }
    if (permit2.length) {
      const request = mk(PERMIT2, encodeFunctionData({ abi: PERMIT2_ABI, functionName: "lockdown", args: [permit2] }));
      steps.push({
        title: permit2.length === 1 ? "Remove 1 Permit2 permission" : `Remove ${permit2.length} Permit2 permissions`,
        lines: [{ label: "What happens", value: "Permit2 sets these permissions to zero. Nothing is moved." }],
        request,
        verify: (r) => verifyLockdown(r, from, permit2),
      });
    }
    return steps;
  }
}

/** The request is exactly a Permit2 lockdown of the pairs we chose, from you, moving no value. */
export function verifyLockdown(r: DappRequest, from: string, pairs: { token: string; spender: string }[]): boolean {
  const p = (r.params as { from?: string; to?: string; data?: Hex; value?: string }[] | undefined)?.[0];
  if (!p?.to || !p.data || !p.from) return false;
  if (!isAddressEqual(getAddress(p.to), PERMIT2) || !isAddressEqual(getAddress(p.from), getAddress(from))) return false;
  if (p.value && BigInt(p.value) !== 0n) return false;
  try {
    const d = decodeFunctionData({ abi: PERMIT2_ABI, data: p.data });
    if (d.functionName !== "lockdown") return false;
    const got = d.args[0] as readonly { token: string; spender: string }[];
    return got.length === pairs.length && got.every((g, i) => isAddressEqual(g.token as Hex, pairs[i]!.token as Hex) && isAddressEqual(g.spender as Hex, pairs[i]!.spender as Hex));
  } catch {
    return false;
  }
}
