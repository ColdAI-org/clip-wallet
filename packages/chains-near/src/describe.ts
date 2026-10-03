/**
 * Plain-language description of NEAR actions.
 *
 * Recognised function calls: NEP-141 ft_transfer / ft_transfer_call / storage_deposit (NEP-145), NEP-171
 * nft_transfer / nft_transfer_call, staking-pool calls (near/core-contracts staking-pool: deposit_and_stake,
 * deposit, stake, stake_all, unstake, unstake_all, withdraw, withdraw_all) and wNEAR near_deposit / near_withdraw.
 * Anything else is shown as "Call <method> on <contract>" with its JSON arguments; binary arguments are blind.
 */
import type { AssetRef, BalanceChange, NetworkId, Warning } from "@clip-wallet/core";
import { type Action, type PublicKey, publicKeyToString, samePublicKey } from "./borsh.js";
import { WRAP_CONTRACTS, isPool, nearAsset, networkName, poolName } from "./networks.js";
import type { NearRpc } from "./rpc.js";
import { assetFor, ftMetadata } from "./tokens.js";
import { formatUnits, hex, short } from "./util.js";

export const TGAS = 10n ** 12n;
export const YOCTO_PER_NEAR = 10n ** 24n;
/** Rough gas for the receipt plus one simple action (nearcore fee config: ~0.22 Tgas receipt + ~0.23 Tgas transfer). */
export const BASE_GAS = 450_000_000_000n;
export const SIMPLE_ACTION_GAS = 250_000_000_000n;
/** Unstaked NEAR unlocks after 4 epochs (staking-pool NUM_EPOCHS_TO_UNLOCK); an epoch is 43,200 blocks (~7 h on mainnet today). */
export const UNSTAKE_NOTE = "Unstaked NEAR can be withdrawn after about 4 epochs (roughly 1–2 days).";

export interface TxView {
  signerId: string;
  receiverId: string;
  actions: Action[];
}

export interface Described {
  title: string;
  lines: { label: string; value: string }[];
  balanceChanges: BalanceChange[];
  warnings: Warning[];
  blind: boolean;
  /** Upper bound of gas this transaction can burn. */
  gas: bigint;
}

export interface DescribeEnv {
  networkId: NetworkId;
  /** This wallet's key. */
  publicKey: PublicKey;
  /** Requesting site's host, or "Clip Wallet". */
  host: string;
  rpc: NearRpc;
}

export const near = (yocto: bigint) => `${formatUnits(yocto, 24, 6)} NEAR`;
export const tgas = (g: bigint) => `${formatUnits(g, 12, 2)} Tgas`;

function jsonArgs(args: Uint8Array): Record<string, unknown> | unknown[] | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(args);
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function pretty(v: unknown, max = 600): string {
  const s = JSON.stringify(v, null, 2);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

const s = (x: unknown) => (typeof x === "string" ? x : undefined);
const isUint = (x: unknown): x is string => typeof x === "string" && /^\d+$/.test(x);

class Acc {
  changes = new Map<string, { asset: AssetRef; delta: bigint }>();
  add(asset: AssetRef, delta: bigint) {
    const k = asset.address ?? asset.key;
    const e = this.changes.get(k) ?? { asset, delta: 0n };
    e.delta += delta;
    this.changes.set(k, e);
  }
  list(): BalanceChange[] {
    return [...this.changes.values()].filter((e) => e.delta !== 0n).map((e) => ({ asset: e.asset, delta: e.delta.toString() }));
  }
}

export async function describeTx(tx: TxView, env: DescribeEnv): Promise<Described> {
  const { networkId, host } = env;
  const NEAR = nearAsset(networkId);
  const net = networkName(networkId);
  const titles: string[] = [];
  const lines: { label: string; value: string }[] = [];
  const warnings: Warning[] = [];
  const acc = new Acc();
  let blind = false;
  let gas = BASE_GAS;
  const self = tx.receiverId === tx.signerId;
  const warn = (w: Warning) => {
    if (!warnings.some((x) => x.code === w.code && x.message === w.message)) warnings.push(w);
  };
  const blindWarn = (what: string) => {
    blind = true;
    warn({ level: "danger", code: "blind-signing", message: `${what} Only approve if you trust ${host}.` });
  };

  for (const a of tx.actions) {
    switch (a.kind) {
      case "Transfer": {
        gas += SIMPLE_ACTION_GAS;
        titles.push(`Send ${near(a.deposit)} to ${short(tx.receiverId)}`);
        lines.push({ label: "To", value: tx.receiverId });
        acc.add(NEAR, -a.deposit);
        break;
      }
      case "FunctionCall": {
        gas += a.gas;
        const args = jsonArgs(a.args);
        const A = (args && !Array.isArray(args) ? args : {}) as Record<string, unknown>;
        const m = a.methodName;
        const contract = tx.receiverId;
        if (a.deposit > 0n) acc.add(NEAR, -a.deposit);

        if ((m === "ft_transfer" || m === "ft_transfer_call") && isUint(A.amount) && s(A.receiver_id)) {
          const meta = await ftMetadata(env.rpc, contract);
          const asset = assetFor(networkId, contract, meta);
          const amt = BigInt(A.amount as string);
          const amountText = meta ? `${formatUnits(amt, meta.decimals)} ${meta.symbol}` : `${amt} units of ${contract}`;
          titles.push(`Send ${amountText} to ${short(s(A.receiver_id)!)}`);
          lines.push({ label: "To", value: s(A.receiver_id)! }, { label: "Token", value: `${meta?.name ?? "Unknown token"} (${contract})` });
          if (s(A.memo)) lines.push({ label: "Memo", value: s(A.memo)! });
          if (m === "ft_transfer_call") lines.push({ label: "Also", value: `${short(s(A.receiver_id)!)} runs its own code with the tokens${s(A.msg) ? `: ${s(A.msg)!.slice(0, 200)}` : ""}` });
          acc.add(asset, -amt);
          if (asset.spam) warn({ level: "danger", code: "known-scam", message: `This token (${contract}) looks like a copy of a well-known token. It isn't the real one.` });
          if (!meta) blindWarn("This token's details couldn't be read.");
          break;
        }
        if (m === "storage_deposit") {
          const who = s(A.account_id) ?? tx.signerId;
          titles.push(`Register ${who === tx.signerId ? "your account" : short(who)} with ${short(contract)}`);
          lines.push({ label: "Storage deposit", value: `${near(a.deposit)} (pays for ${who === tx.signerId ? "your" : "their"} record on ${short(contract)}; part of it can be reclaimed)` });
          break;
        }
        if (m === "storage_withdraw" || m === "storage_unregister") {
          titles.push(`Withdraw your storage deposit from ${short(contract)}`);
          break;
        }
        if ((m === "nft_transfer" || m === "nft_transfer_call") && s(A.receiver_id) && s(A.token_id)) {
          titles.push(`Send NFT ${s(A.token_id)!.slice(0, 40)} to ${short(s(A.receiver_id)!)}`);
          lines.push({ label: "Collection", value: contract }, { label: "To", value: s(A.receiver_id)! });
          if (m === "nft_transfer_call") lines.push({ label: "Also", value: `${short(s(A.receiver_id)!)} runs its own code with the NFT` });
          break;
        }
        if (net && WRAP_CONTRACTS[net] === contract && (m === "near_deposit" || m === "near_withdraw")) {
          const wnear = assetFor(networkId, contract, { name: "Wrapped NEAR", symbol: "wNEAR", decimals: 24 });
          if (m === "near_deposit") {
            titles.push(`Wrap ${near(a.deposit)} into wNEAR`);
            acc.add(wnear, a.deposit);
          } else if (isUint(A.amount)) {
            const amt = BigInt(A.amount as string);
            titles.push(`Unwrap ${formatUnits(amt, 24, 6)} wNEAR into NEAR`);
            acc.add(wnear, -amt);
            acc.add(NEAR, amt);
          } else titles.push("Unwrap wNEAR into NEAR");
          break;
        }
        const pool = isPool(networkId, contract);
        const name = poolName(contract);
        if (m === "deposit_and_stake" || (pool && m === "deposit")) {
          titles.push(`Stake ${near(a.deposit)} with ${name}`);
          lines.push({ label: "Validator", value: contract }, { label: "Unstaking", value: `When you unstake later: ${UNSTAKE_NOTE}` });
          break;
        }
        if (pool && (m === "unstake" || m === "unstake_all")) {
          titles.push(m === "unstake" && isUint(A.amount) ? `Unstake ${near(BigInt(A.amount as string))} from ${name}` : `Unstake everything from ${name}`);
          lines.push({ label: "Validator", value: contract }, { label: "When", value: UNSTAKE_NOTE });
          break;
        }
        if (pool && (m === "withdraw" || m === "withdraw_all")) {
          titles.push(m === "withdraw" && isUint(A.amount) ? `Withdraw ${near(BigInt(A.amount as string))} of unstaked NEAR from ${name}` : `Withdraw your unstaked NEAR from ${name}`);
          lines.push({ label: "Validator", value: contract });
          if (m === "withdraw" && isUint(A.amount)) acc.add(NEAR, BigInt(A.amount as string));
          break;
        }
        if (pool && (m === "stake" || m === "stake_all")) {
          titles.push(m === "stake" && isUint(A.amount) ? `Restake ${near(BigInt(A.amount as string))} with ${name}` : `Restake your unstaked NEAR with ${name}`);
          lines.push({ label: "Validator", value: contract });
          break;
        }
        // Generic contract call.
        titles.push(`Call ${m} on ${short(contract)}`);
        lines.push({ label: "App contract", value: contract }, { label: "Method", value: m });
        if (args) lines.push({ label: "Arguments", value: pretty(args) });
        else if (a.args.length) {
          lines.push({ label: "Arguments (not readable)", value: `0x${hex(a.args.slice(0, 64))}${a.args.length > 64 ? "…" : ""}` });
          blindWarn(`The details of this ${m} call can't be read.`);
        }
        if (a.deposit > 0n) lines.push({ label: "Attached", value: near(a.deposit) });
        lines.push({ label: "Gas limit", value: tgas(a.gas) });
        break;
      }
      case "AddKey": {
        gas += SIMPLE_ACTION_GAS;
        const key = publicKeyToString(a.publicKey);
        const p = a.accessKey.permission;
        if (p === "FullAccess") {
          titles.push(`Give ${host} full control of ${short(tx.receiverId)}`);
          lines.push({ label: "New full-access key", value: key });
          warn({
            level: "danger",
            code: "account-takeover",
            message: `This gives ${host} full control of your account ${tx.receiverId}. Whoever holds that key can move everything and lock you out.`,
          });
        } else {
          const methods = p.methodNames.length ? p.methodNames.join(", ") : "any method";
          titles.push(`Let ${host} use ${short(p.receiverId)} for you`);
          lines.push(
            { label: "New app key", value: key },
            { label: "Can call", value: `${methods} on ${p.receiverId} (it can't send your NEAR)` },
            { label: "Fee allowance", value: p.allowance === null ? "No limit" : near(p.allowance) },
          );
          if (p.allowance === null) {
            warn({ level: "caution", code: "unlimited-approval", message: `This app key can spend your NEAR on network fees with no limit.` });
          }
        }
        break;
      }
      case "DeleteKey": {
        gas += SIMPLE_ACTION_GAS;
        const key = publicKeyToString(a.publicKey);
        if (samePublicKey(a.publicKey, env.publicKey)) {
          titles.push(`Remove this wallet's key from ${short(tx.receiverId)}`);
          warn({
            level: "danger",
            code: "account-takeover",
            message: `This removes Clip Wallet's own key from ${tx.receiverId}. You'll lose access to the account from this wallet.`,
          });
        } else titles.push(`Remove a key from ${short(tx.receiverId)}`);
        lines.push({ label: "Key", value: key });
        break;
      }
      case "DeleteAccount": {
        gas += SIMPLE_ACTION_GAS;
        titles.push(`Delete ${short(tx.receiverId)}`);
        lines.push({ label: "Everything left goes to", value: a.beneficiaryId });
        warn({
          level: "danger",
          code: "account-closure",
          message: `Deletes the account ${tx.receiverId} and sends everything left to ${a.beneficiaryId}. Tokens and NFTs held by the account are lost.`,
        });
        break;
      }
      case "DeployContract":
      case "UseGlobalContract": {
        gas += SIMPLE_ACTION_GAS * 4n;
        const what = a.kind === "DeployContract" ? `${a.code.length} bytes of code` : "a shared (global) contract";
        titles.push(`Replace the code on ${short(tx.receiverId)}`);
        lines.push({ label: "Code", value: what });
        if (a.kind === "UseGlobalContract") {
          const id = a.contractIdentifier;
          lines.push({ label: "Contract", value: "accountId" in id ? id.accountId : `code hash 0x${hex(id.codeHash)}` });
        }
        warn({
          level: "danger",
          code: "account-takeover",
          message: `Replaces the code on ${self ? "your account" : tx.receiverId}. New code can do anything with the account and its funds.`,
        });
        break;
      }
      case "DeployGlobalContract":
        gas += SIMPLE_ACTION_GAS * 4n;
        titles.push(`Publish a shared contract (${a.code.length} bytes)`);
        lines.push({ label: "Publishing cost", value: "Paid from your balance for storing the code" });
        warn({ level: "caution", code: "high-fee", message: "Publishing a shared contract locks NEAR for its storage." });
        break;
      case "CreateAccount":
        gas += SIMPLE_ACTION_GAS;
        titles.push(`Create the account ${tx.receiverId}`);
        break;
      case "Stake":
        gas += SIMPLE_ACTION_GAS;
        titles.push(`Lock ${near(a.stake)} as a validator stake`);
        lines.push({ label: "Validator key", value: publicKeyToString(a.publicKey) });
        break;
      case "Delegate":
        gas += SIMPLE_ACTION_GAS;
        titles.push(`Pay the fees for a request from ${short(a.delegateAction.senderId)}`);
        lines.push({ label: "Relays", value: `${a.delegateAction.actions.length} action(s) from ${a.delegateAction.senderId} to ${a.delegateAction.receiverId}` });
        blindWarn("This relays someone else's signed request, and you pay its fees.");
        break;
      case "Unknown":
        titles.push("Unknown action");
        blindWarn("This transaction has an action Clip Wallet can't read.");
        break;
    }
  }

  if (!tx.actions.length) titles.push(`Empty transaction to ${short(tx.receiverId)}`);
  // Registration is a side effect: lead with the main action.
  const main = titles.findIndex((t) => !t.startsWith("Register "));
  const title = titles.length <= 1 ? (titles[0] ?? "") : main > 0 ? titles[main]! : titles[0]!;
  const others = titles.filter((t) => t !== title);
  if (others.length) lines.unshift({ label: others.length === 1 ? "Also" : "Also does", value: others.join("; ") });
  return { title, lines, balanceChanges: acc.list(), warnings, blind, gas };
}
