import type { AssetRef, BalanceChange, NetworkId, Warning } from "@clip-wallet/core";
import {
  Asset,
  FeeBumpTransaction,
  LiquidityPoolAsset,
  type Memo,
  type Operation,
  StrKey,
  type Transaction,
  scValToNative,
  xdr,
} from "@stellar/stellar-base";
import type { Horizon, HorizonAccount } from "./horizon.js";
import { USDC_ISSUERS, assetOf, netOf, sep41Asset, xlmAsset } from "./networks.js";
import type { SimulateResult, SorobanRpc } from "./rpc.js";
import { b64encode, baseAccount, formatUnits, hex, joinWords, short, toStroops } from "./util.js";

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
  simulated: boolean;
  /** Stroops. */
  fee: bigint;
}

export interface TokenMeta {
  symbol?: string;
  name?: string;
  decimals?: number;
}

export interface DescribeContext {
  networkId: NetworkId;
  passphrase: string;
  /** This account (G…). */
  me: string;
  horizon: Horizon | null;
  rpc: SorobanRpc | null;
  /** Run simulateTransaction for Soroban operations. */
  simulate: boolean;
  /** SEP-41 token metadata (cached by the module). */
  tokenMeta(contract: string): Promise<TokenMeta | null>;
}

/** 1 XLM: the least createAccount accepts (2 × 0.5 XLM base reserve). */
export const MIN_CREATE_ACCOUNT_STROOPS = 10_000_000n;
const MAX_LIMIT = "922337203685.4775807";
const SOROBAN_OPS = new Set(["invokeHostFunction", "extendFootprintTtl", "restoreFootprint"]);

export function isSorobanTx(tx: Transaction | FeeBumpTransaction): boolean {
  const inner = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;
  return inner.operations.some((o) => SOROBAN_OPS.has(o.type));
}

const danger = (code: Warning["code"], message: string): Warning => ({ level: "danger", code, message });
const caution = (code: Warning["code"], message: string): Warning => ({ level: "caution", code, message });

function amountText(asset: AssetRef, stroops: bigint): string {
  return `${formatUnits(stroops < 0n ? -stroops : stroops, asset.decimals)} ${asset.symbol}`;
}

/** Display form of a G…/M… address; M… shows its base account and id. */
function who(address: string): string {
  if (StrKey.isValidMed25519PublicKey(address)) {
    const base = baseAccount(address);
    return base ? `${short(base)} (sub-account)` : short(address);
  }
  return short(address);
}

function assetName(a: Asset): string {
  return a.isNative() ? "XLM" : a.getCode();
}

function assetLabel(a: Asset): string {
  return a.isNative() ? "XLM (native)" : `${a.getCode()} issued by ${a.getIssuer()}`;
}

/** Best-effort, readable form of a Soroban value. */
export function formatScVal(v: xdr.ScVal): string {
  try {
    return fmt(scValToNative(v));
  } catch {
    return `${v.switch().name} value`;
  }
}

function fmt(x: unknown, depth = 0): string {
  if (depth > 4) return "…";
  if (x === null || x === undefined) return "nothing";
  if (typeof x === "bigint" || typeof x === "number" || typeof x === "boolean") return String(x);
  if (typeof x === "string") return x.length > 80 ? `${x.slice(0, 77)}…` : x;
  if (x instanceof Uint8Array) return `0x${hex(x).slice(0, 64)}${x.length > 32 ? "…" : ""}`;
  if (Array.isArray(x)) return `[${x.map((i) => fmt(i, depth + 1)).join(", ")}]`;
  if (typeof x === "object") {
    return `{ ${Object.entries(x as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${fmt(v, depth + 1)}`)
      .join(", ")} }`;
  }
  return String(x);
}

function addressOf(a: xdr.ScAddress): string {
  switch (a.switch().name) {
    case "scAddressTypeAccount":
      return StrKey.encodeEd25519PublicKey(a.accountId().ed25519() as never);
    case "scAddressTypeContract":
      return StrKey.encodeContract(a.contractId() as never);
    default:
      try {
        return String(scValToNative(xdr.ScVal.scvAddress(a)));
      } catch {
        return a.switch().name;
      }
  }
}

function memoText(memo: Memo): string | null {
  switch (memo.type) {
    case "none":
      return null;
    case "text": {
      const v = memo.value as unknown;
      return typeof v === "string" ? v : new TextDecoder().decode(v as Uint8Array);
    }
    case "id":
      return String(memo.value);
    case "hash":
    case "return":
      return `0x${hex(memo.value as unknown as Uint8Array)}`;
    default:
      return null;
  }
}

/** A short description of one authorized contract call tree. */
export function describeInvocation(inv: xdr.SorobanAuthorizedInvocation, depth = 0): Line[] {
  const f = inv.function();
  const lines: Line[] = [];
  const pad = depth ? "↳ ".padStart(depth * 2 + 2, " ") : "";
  switch (f.switch().name) {
    case "sorobanAuthorizedFunctionTypeContractFn": {
      const c = f.contractFn();
      const fn = c.functionName().toString();
      lines.push({ label: `${pad}Contract`, value: addressOf(c.contractAddress()) });
      lines.push({ label: `${pad}Function`, value: fn });
      c.args().forEach((a, i) => lines.push({ label: `${pad}Argument ${i + 1}`, value: formatScVal(a) }));
      break;
    }
    default:
      lines.push({ label: `${pad}Action`, value: "Create a smart contract" });
  }
  for (const sub of inv.subInvocations()) lines.push(...describeInvocation(sub, depth + 1));
  return lines;
}

interface OpOut {
  title: string;
  lines: Line[];
  changes: BalanceChange[];
  warnings: Warning[];
  blind?: boolean;
  /** Destination to check for SEP-29 memo requirements. */
  memoCheck?: string;
  /** Destination must exist / hold the asset, else the payment fails. */
  destCheck?: { address: string; asset?: Asset };
}

function out(title: string, lines: Line[] = [], extra: Partial<OpOut> = {}): OpOut {
  return { title, lines, changes: [], warnings: [], ...extra };
}

async function describeOp(op: Operation, source: string, dc: DescribeContext): Promise<OpOut> {
  const mine = baseAccount(source) === dc.me;
  const toMe = (d: string) => baseAccount(d) === dc.me;
  const ch = (a: Asset, stroops: bigint): BalanceChange => ({ asset: assetOf(dc.networkId, a), delta: stroops.toString() });
  const on = mine ? [] : [{ label: "Account", value: source }];

  switch (op.type) {
    case "createAccount": {
      const amt = toStroops(op.startingBalance);
      const xlm = xlmAsset(dc.networkId);
      return out(`Send ${amountText(xlm, amt)} to ${who(op.destination)} and open their account`, [
        ...on,
        { label: "To", value: op.destination },
        { label: "Also", value: "This also opens their Stellar account; it needs at least 1 XLM." },
      ], { changes: mine ? [{ asset: xlm, delta: (-amt).toString() }] : [] });
    }
    case "payment": {
      const amt = toStroops(op.amount);
      const asset = assetOf(dc.networkId, op.asset);
      const changes: BalanceChange[] = [];
      if (mine && !toMe(op.destination)) changes.push(ch(op.asset, -amt));
      if (!mine && toMe(op.destination)) changes.push(ch(op.asset, amt));
      const title = !mine && toMe(op.destination) ? `Receive ${amountText(asset, amt)} from ${who(source)}` : `Send ${amountText(asset, amt)} to ${who(op.destination)}`;
      const lines = [...on, { label: "To", value: op.destination }, { label: "Asset", value: assetLabel(op.asset) }];
      const warnings = asset.spam ? [caution("known-scam", `This ${asset.symbol} isn't from its usual issuer. It may be a copy with no value.`)] : [];
      return out(title, lines, { changes, warnings, memoCheck: op.destination, destCheck: { address: op.destination, asset: op.asset } });
    }
    case "pathPaymentStrictSend": {
      const send = assetOf(dc.networkId, op.sendAsset);
      const dest = assetOf(dc.networkId, op.destAsset);
      const sAmt = toStroops(op.sendAmount);
      const dMin = toStroops(op.destMin);
      const self = toMe(op.destination) && mine;
      const title = self
        ? `Swap ${amountText(send, sAmt)} for at least ${amountText(dest, dMin)}`
        : `Swap ${amountText(send, sAmt)} for at least ${amountText(dest, dMin)}, sent to ${who(op.destination)}`;
      const changes: BalanceChange[] = [];
      if (mine) changes.push(ch(op.sendAsset, -sAmt));
      if (toMe(op.destination)) changes.push(ch(op.destAsset, dMin));
      return out(title, [...on, { label: "To", value: op.destination }, { label: "Route", value: [op.sendAsset, ...op.path, op.destAsset].map(assetName).join(" → ") }], {
        changes,
        memoCheck: self ? undefined : op.destination,
      });
    }
    case "pathPaymentStrictReceive": {
      const send = assetOf(dc.networkId, op.sendAsset);
      const dest = assetOf(dc.networkId, op.destAsset);
      const sMax = toStroops(op.sendMax);
      const dAmt = toStroops(op.destAmount);
      const self = toMe(op.destination) && mine;
      const title = self
        ? `Swap up to ${amountText(send, sMax)} for ${amountText(dest, dAmt)}`
        : `Swap up to ${amountText(send, sMax)} for ${amountText(dest, dAmt)}, sent to ${who(op.destination)}`;
      const changes: BalanceChange[] = [];
      if (mine) changes.push(ch(op.sendAsset, -sMax));
      if (toMe(op.destination)) changes.push(ch(op.destAsset, dAmt));
      return out(title, [...on, { label: "To", value: op.destination }, { label: "Route", value: [op.sendAsset, ...op.path, op.destAsset].map(assetName).join(" → ") }], {
        changes,
        memoCheck: self ? undefined : op.destination,
      });
    }
    case "manageSellOffer":
    case "createPassiveSellOffer": {
      const sell = assetOf(dc.networkId, op.selling);
      const amt = toStroops(op.amount);
      const offerId = op.type === "manageSellOffer" ? op.offerId : "0";
      if (amt === 0n) return out("Cancel an offer", [...on, { label: "Offer", value: offerId }]);
      const verb = offerId !== "0" ? "Change an offer to sell" : "Offer to sell";
      return out(`${verb} ${amountText(sell, amt)} for ${assetName(op.buying)}`, [
        ...on,
        { label: "Price", value: `${op.price} ${assetName(op.buying)} per ${assetName(op.selling)}` },
        ...(op.type === "createPassiveSellOffer" ? [{ label: "Kind", value: "Passive (won't take matching offers at the same price)" }] : []),
        { label: "Also", value: "An open offer sets aside 0.5 XLM of your balance until it's filled or cancelled." },
      ]);
    }
    case "manageBuyOffer": {
      const buy = assetOf(dc.networkId, op.buying);
      const amt = toStroops(op.buyAmount);
      if (amt === 0n) return out("Cancel an offer", [...on, { label: "Offer", value: op.offerId }]);
      const verb = op.offerId !== "0" ? "Change an offer to buy" : "Offer to buy";
      return out(`${verb} ${amountText(buy, amt)} with ${assetName(op.selling)}`, [
        ...on,
        { label: "Price", value: `${op.price} ${assetName(op.selling)} per ${assetName(op.buying)}` },
        { label: "Also", value: "An open offer sets aside 0.5 XLM of your balance until it's filled or cancelled." },
      ]);
    }
    case "setOptions": {
      const lines: Line[] = [...on];
      const warnings: Warning[] = [];
      const whose = mine ? "your account" : `account ${short(source)}`;
      const signer = op.signer as { ed25519PublicKey?: string; sha256Hash?: unknown; preAuthTx?: unknown; ed25519SignedPayload?: string; weight?: number } | undefined;
      if (signer) {
        const key = signer.ed25519PublicKey ?? signer.ed25519SignedPayload ?? (signer.sha256Hash ? "a hash secret" : signer.preAuthTx ? "a pre-approved transaction" : "a key");
        if ((signer.weight ?? 0) > 0) {
          lines.push({ label: "Adds a signer", value: `${key} (weight ${signer.weight})` });
          if (mine) warnings.push(danger("account-takeover", `This lets ${typeof key === "string" && key.length > 12 ? short(key) : key} sign for your account. Only approve if you control that key.`));
        } else {
          lines.push({ label: "Removes a signer", value: String(key) });
        }
      }
      if (op.masterWeight !== undefined) {
        lines.push({ label: "Your key's weight", value: String(op.masterWeight) });
        if (op.masterWeight === 0 && mine) warnings.push(danger("account-takeover", "This turns off your own key. You could lose control of this account."));
      }
      const th = [op.lowThreshold, op.medThreshold, op.highThreshold];
      if (th.some((t) => t !== undefined)) {
        lines.push({ label: "Signing thresholds", value: `low ${op.lowThreshold ?? "same"}, medium ${op.medThreshold ?? "same"}, high ${op.highThreshold ?? "same"}` });
        if (mine) warnings.push(danger("account-takeover", "This changes how many signatures your account needs. You could lose control of it."));
      }
      if (op.homeDomain !== undefined) lines.push({ label: "Home domain", value: op.homeDomain || "(cleared)" });
      if (op.inflationDest) lines.push({ label: "Inflation destination", value: op.inflationDest });
      if (op.setFlags) lines.push({ label: "Turns on issuer flags", value: String(op.setFlags) });
      if (op.clearFlags) lines.push({ label: "Turns off issuer flags", value: String(op.clearFlags) });
      return out(`Change ${whose}'s settings`, lines, { warnings });
    }
    case "changeTrust": {
      const remove = toStroops(op.limit) === 0n;
      if (op.line instanceof LiquidityPoolAsset) {
        return out(remove ? "Remove a liquidity pool share from your account" : "Add a liquidity pool share to your account", [
          ...on,
          { label: "Pool", value: `${assetName(op.line.assetA)} / ${assetName(op.line.assetB)}` },
        ]);
      }
      const a = op.line as Asset;
      const ref = assetOf(dc.networkId, a);
      const lines: Line[] = [...on, { label: "Asset", value: assetLabel(a) }];
      if (remove) return out(`Remove ${ref.symbol} from your account`, [...lines, { label: "Also", value: "This frees the 0.5 XLM it set aside." }]);
      lines.push({ label: "Also", value: `This sets aside 0.5 XLM of your balance while ${ref.symbol} is added.` });
      if (op.limit !== MAX_LIMIT) lines.push({ label: "Most you can hold", value: `${op.limit} ${ref.symbol}` });
      const warnings = ref.spam ? [caution("known-scam", `This ${ref.symbol} isn't from its usual issuer. It may be a copy with no value.`)] : [];
      return out(`Add ${ref.symbol} to your account`, lines, { warnings });
    }
    case "allowTrust":
      return out(`Change whether ${who(op.trustor)} can hold ${op.assetCode}`, [...on, { label: "Account", value: op.trustor }, { label: "Allowed", value: String(op.authorize) }]);
    case "setTrustLineFlags": {
      const f = op.flags;
      const parts = Object.entries(f).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v ? "on" : "off"}`);
      return out(`Change whether ${who(op.trustor)} can hold ${assetName(op.asset)}`, [...on, { label: "Account", value: op.trustor }, { label: "Flags", value: parts.join(", ") }]);
    }
    case "accountMerge": {
      if (!mine) return out(`Close account ${short(source)} and move its XLM to ${who(op.destination)}`, [{ label: "To", value: op.destination }], { memoCheck: op.destination });
      return out(`Close your account and send all your XLM to ${who(op.destination)}`, [{ label: "To", value: op.destination }], {
        warnings: [danger("account-closure", `This closes your Stellar account and sends everything left in XLM to ${short(op.destination)}. It can't be undone.`)],
        memoCheck: op.destination,
      });
    }
    case "inflation":
      return out("Run inflation (no longer does anything)", on);
    case "manageData": {
      const value = op.value as Uint8Array | undefined | null;
      if (!value) return out(`Delete “${op.name}” from your account data`, on);
      const text = new TextDecoder("utf-8", { fatal: false }).decode(value);
      const printable = !/[\u0000-\u001f\u007f�]/.test(text);
      return out(`Save “${op.name}” on your account`, [...on, { label: "Value", value: printable ? text : b64encode(value) }, { label: "Also", value: "Each saved entry sets aside 0.5 XLM of your balance." }]);
    }
    case "bumpSequence":
      return out("Move your account's transaction counter forward", [...on, { label: "New value", value: op.bumpTo }, { label: "Also", value: "Any older pending transactions from your account stop working." }]);
    case "createClaimableBalance": {
      const amt = toStroops(op.amount);
      const asset = assetOf(dc.networkId, op.asset);
      const dests = op.claimants.map((c) => c.destination);
      const title = dests.length === 1 ? `Send ${amountText(asset, amt)} to ${who(dests[0]!)} to claim` : `Send ${amountText(asset, amt)} for ${dests.length} accounts to claim`;
      return out(title, [...on, { label: "Can be claimed by", value: dests.join(", ") }, { label: "Also", value: "They have to claim it. Until then, 0.5 XLM of your balance is set aside per claimant." }], {
        changes: mine ? [ch(op.asset, -amt)] : [],
      });
    }
    case "claimClaimableBalance":
      return out("Claim a balance sent to you", [...on, { label: "Balance id", value: op.balanceId }]);
    case "clawbackClaimableBalance":
      return out("Take back a claimable balance (issuer)", [...on, { label: "Balance id", value: op.balanceId }]);
    case "beginSponsoringFutureReserves":
      return out(`Pay the XLM reserves for ${who(op.sponsoredId)}`, [
        ...on,
        { label: "For", value: op.sponsoredId },
        { label: "Also", value: "You lock 0.5 XLM for each account entry they create in this transaction, for as long as it exists." },
      ]);
    case "endSponsoringFutureReserves":
      return out("Finish a reserve sponsorship", [...on, { label: "Also", value: "Ends the sponsorship started earlier in this transaction." }]);
    case "revokeSponsorship":
    case "revokeAccountSponsorship" as never:
    case "revokeTrustlineSponsorship" as never:
    case "revokeOfferSponsorship" as never:
    case "revokeDataSponsorship" as never:
    case "revokeClaimableBalanceSponsorship" as never:
    case "revokeLiquidityPoolSponsorship" as never:
    case "revokeSignerSponsorship" as never: {
      const o = op as unknown as Record<string, unknown>;
      const what =
        o.seller ? `offer ${String(o.offerId)}` : o.name ? `data “${String(o.name)}”` : o.balanceId ? "a claimable balance" : o.liquidityPoolId ? "a liquidity pool share" : o.signer ? "a signer" : o.asset ? "a trustline" : "an account";
      return out(`Change who pays the reserve for ${what}`, [
        ...on,
        ...(o.account ? [{ label: "Account", value: String(o.account) }] : []),
        { label: "Also", value: "The sponsor stops paying its 0.5 XLM reserve; the owner pays it, or it moves to a new sponsor." },
      ]);
    }
    case "clawback": {
      const amt = toStroops(op.amount);
      return out(`Take back ${amountText(assetOf(dc.networkId, op.asset), amt)} from ${who(op.from)}`, [...on, { label: "From", value: op.from }]);
    }
    case "liquidityPoolDeposit":
      return out("Add funds to a liquidity pool", [
        ...on,
        { label: "Pool", value: op.liquidityPoolId },
        { label: "Up to", value: `${op.maxAmountA} of the first asset and ${op.maxAmountB} of the second` },
        { label: "Price range", value: `${op.minPrice} – ${op.maxPrice}` },
      ]);
    case "liquidityPoolWithdraw":
      return out("Withdraw funds from a liquidity pool", [
        ...on,
        { label: "Pool", value: op.liquidityPoolId },
        { label: "Shares", value: op.amount },
        { label: "At least", value: `${op.minAmountA} of the first asset and ${op.minAmountB} of the second` },
      ]);
    case "invokeHostFunction":
      return describeInvoke(op, mine, dc);
    case "extendFootprintTtl":
      return out("Keep smart contract data from expiring", [...on, { label: "Extends to", value: `ledger ${op.extendTo}` }]);
    case "restoreFootprint":
      return out("Restore archived smart contract data", on);
    default:
      return out("Unknown Stellar action", [{ label: "Type", value: String((op as { type: string }).type) }], { blind: true });
  }
}

async function describeInvoke(op: Operation.InvokeHostFunction, mine: boolean, dc: DescribeContext): Promise<OpOut> {
  const func = op.func;
  const lines: Line[] = [];
  let title: string;
  switch (func.switch().name) {
    case "hostFunctionTypeInvokeContract": {
      const call = func.invokeContract();
      const contract = addressOf(call.contractAddress());
      const fn = call.functionName().toString();
      const args = call.args();
      lines.push({ label: "Contract", value: contract }, { label: "Function", value: fn });
      args.forEach((a, i) => lines.push({ label: `Argument ${i + 1}`, value: formatScVal(a) }));
      title = `Use ${fn} on contract ${short(contract)}`;
      // SEP-41 transfer(from, to, amount)
      if (fn === "transfer" && args.length === 3) {
        try {
          const from = String(scValToNative(args[0]!));
          const to = String(scValToNative(args[1]!));
          const amount = BigInt(scValToNative(args[2]!) as bigint);
          if (from === dc.me) {
            const asset = await tokenAsset(contract, null, dc);
            title = `Send ${amountText(asset, amount)} to ${who(to)}`;
          }
        } catch {
          /* not a token transfer */
        }
      }
      break;
    }
    case "hostFunctionTypeCreateContract":
    case "hostFunctionTypeCreateContractV2":
      title = "Create a smart contract";
      break;
    case "hostFunctionTypeUploadContractWasm":
      title = "Upload smart contract code";
      lines.push({ label: "Code size", value: `${func.wasm().length} bytes` });
      break;
    default:
      return out("Unknown smart contract action", lines, { blind: true });
  }
  for (const entry of op.auth ?? []) {
    const cred = entry.credentials();
    if (cred.switch().name === "sorobanCredentialsSourceAccount") {
      if (mine) lines.push({ label: "Your signature also approves", value: summarizeInvocation(entry.rootInvocation()) });
    } else {
      const who = addressOf(cred.address().address());
      if (who === dc.me) lines.push({ label: "Already approved by you", value: summarizeInvocation(entry.rootInvocation()) });
    }
  }
  return out(title, lines);
}

function summarizeInvocation(inv: xdr.SorobanAuthorizedInvocation): string {
  const parts: string[] = [];
  const walk = (i: xdr.SorobanAuthorizedInvocation) => {
    const f = i.function();
    if (f.switch().name === "sorobanAuthorizedFunctionTypeContractFn") {
      const c = f.contractFn();
      parts.push(`${c.functionName().toString()} on ${short(addressOf(c.contractAddress()))}`);
    } else parts.push("create a contract");
    i.subInvocations().forEach(walk);
  };
  walk(inv);
  return joinWords(parts);
}

/** Classic asset behind a Stellar Asset Contract (checked: the contract id must match), or a SEP-41 token. */
export async function tokenAsset(contract: string, sacName: string | null, dc: DescribeContext): Promise<AssetRef> {
  if (sacName) {
    try {
      const a = sacName === "native" ? Asset.native() : new Asset(...(sacName.split(":") as [string, string]));
      if (a.contractId(dc.passphrase) === contract) return assetOf(dc.networkId, a);
    } catch {
      /* not a SEP-11 asset name */
    }
  }
  for (const a of knownSacs(dc)) if (a.contractId(dc.passphrase) === contract) return assetOf(dc.networkId, a);
  const meta = await dc.tokenMeta(contract).catch(() => null);
  return sep41Asset(dc.networkId, contract, meta ?? undefined);
}

function knownSacs(dc: DescribeContext): Asset[] {
  const n = netOf(dc.networkId);
  return n ? [Asset.native(), new Asset("USDC", USDC_ISSUERS[n])] : [Asset.native()];
}

/** Token movements in a simulation's contract events (SEP-41 / SAC "transfer", "burn", "mint"). */
export async function simulatedChanges(sim: SimulateResult, dc: DescribeContext): Promise<BalanceChange[]> {
  const sum = new Map<string, { asset: AssetRef; delta: bigint }>();
  for (const raw of sim.events ?? []) {
    let ev: xdr.ContractEvent;
    try {
      const d = xdr.DiagnosticEvent.fromXDR(raw, "base64");
      ev = d.event();
    } catch {
      continue;
    }
    if (ev.type().name !== "contract") continue;
    const cid = ev.contractId();
    if (!cid) continue;
    const contract = StrKey.encodeContract(cid as never);
    const body = ev.body().v0();
    const topics = body.topics();
    const name = topics[0]?.switch().name === "scvSymbol" ? topics[0].sym().toString() : "";
    if (name !== "transfer" && name !== "burn" && name !== "mint") continue;
    let amount: bigint;
    try {
      const data = scValToNative(body.data()) as unknown;
      amount = typeof data === "bigint" ? data : BigInt((data as { amount: bigint }).amount);
    } catch {
      continue;
    }
    const addr = (i: number) => {
      try {
        return String(scValToNative(topics[i]!));
      } catch {
        return "";
      }
    };
    let delta = 0n;
    let sacName: string | null = null;
    if (name === "transfer") {
      const from = addr(1);
      const to = addr(2);
      if (from === dc.me) delta -= amount;
      if (to === dc.me) delta += amount;
      sacName = topics.length > 3 ? addr(3) : null;
    } else if (name === "burn") {
      if (addr(1) === dc.me) delta -= amount;
      sacName = topics.length > 2 ? addr(2) : null;
    } else {
      // mint: SEP-41 topics [mint, to] (older SAC: [mint, admin, to, asset])
      const to = topics.length >= 4 ? addr(2) : addr(1);
      if (to === dc.me) delta += amount;
      sacName = topics.length >= 4 ? addr(3) : topics.length === 3 ? addr(2) : null;
    }
    if (delta === 0n) continue;
    const asset = await tokenAsset(contract, sacName, dc);
    const k = asset.key;
    const e = sum.get(k) ?? { asset, delta: 0n };
    e.delta += delta;
    sum.set(k, e);
  }
  return [...sum.values()].filter((e) => e.delta !== 0n).map((e) => ({ asset: e.asset, delta: e.delta.toString() }));
}

function mergeChanges(list: BalanceChange[]): BalanceChange[] {
  const sum = new Map<string, { asset: AssetRef; delta: bigint }>();
  for (const c of list) {
    const k = c.asset.address ?? c.asset.key;
    const e = sum.get(k) ?? { asset: c.asset, delta: 0n };
    e.delta += BigInt(c.delta);
    sum.set(k, e);
  }
  return [...sum.values()].filter((e) => e.delta !== 0n).map((e) => ({ asset: e.asset, delta: e.delta.toString() }));
}

const MEMO_REQUIRED_B64 = "MQ=="; // "1"

/** Describes a Transaction or FeeBumpTransaction for the approval screen. */
export async function describeTransaction(tx: Transaction | FeeBumpTransaction, dc: DescribeContext): Promise<Described> {
  const feeBump = tx instanceof FeeBumpTransaction;
  const inner = feeBump ? tx.innerTransaction : tx;
  const fee = BigInt(tx.fee);
  const ops = inner.operations;
  const outs: OpOut[] = [];
  for (const op of ops) outs.push(await describeOp(op, op.source ?? inner.source, dc));

  const lines: Line[] = [];
  const warnings: Warning[] = outs.flatMap((o) => o.warnings);
  let blind = outs.some((o) => o.blind);
  let simulated = false;
  let changes = outs.flatMap((o) => o.changes);

  if (outs.length === 1) lines.push(...outs[0]!.lines);
  else outs.forEach((o, i) => lines.push({ label: `Action ${i + 1}`, value: o.title }, ...o.lines));

  const memo = memoText(inner.memo);
  if (memo !== null) lines.push({ label: "Memo", value: memo });
  const maxTime = inner.timeBounds?.maxTime;
  lines.push({ label: "Valid until", value: maxTime && maxTime !== "0" ? new Date(Number(maxTime) * 1000).toISOString().replace(".000Z", "Z") : "No time limit" });
  if (feeBump) lines.push({ label: "Fee paid by", value: tx.feeSource === dc.me ? "You" : tx.feeSource });
  if (baseAccount(inner.source) !== dc.me) lines.push({ label: "Transaction account", value: inner.source });

  // SEP-29 memo requirements and destination checks (Horizon).
  if (dc.horizon) {
    const cache = new Map<string, HorizonAccount | null>();
    const load = async (g: string) => {
      if (!cache.has(g)) cache.set(g, await dc.horizon!.account(g).catch(() => null));
      return cache.get(g) ?? null;
    };
    for (const o of outs) {
      if (o.memoCheck && memo === null && StrKey.isValidEd25519PublicKey(o.memoCheck) && o.memoCheck !== dc.me) {
        const acct = await load(o.memoCheck);
        if (acct?.data?.["config.memo_required"] === MEMO_REQUIRED_B64 && !warnings.some((w) => w.code === "memo-required")) {
          warnings.push(danger("memo-required", `${short(o.memoCheck)} needs a memo (exchanges use it to know whose deposit it is). Without one, the funds may be lost.`));
        }
      }
      if (o.destCheck && baseAccount(o.destCheck.address) !== dc.me) {
        const g = baseAccount(o.destCheck.address);
        if (!g) continue;
        const acct = await load(g);
        const a = o.destCheck.asset;
        if (!acct) {
          warnings.push(caution("simulation-failed", `${short(g)} isn't an open Stellar account yet, so this payment will fail. Send at least 1 XLM to open it instead.`));
        } else if (a && !a.isNative() && a.getIssuer() !== g && !acct.balances.some((b) => b.asset_code === a.getCode() && b.asset_issuer === a.getIssuer())) {
          warnings.push(caution("simulation-failed", `They need to add ${a.getCode()} to their account first, so this payment will fail.`));
        }
      }
    }
  }

  // Soroban: simulate for token movements.
  if (isSorobanTx(tx)) {
    let unsimulated = false;
    if (dc.simulate && dc.rpc) {
      try {
        const sim = await dc.rpc.simulate(tx.toEnvelope().toXDR("base64"));
        if (sim.error) {
          warnings.push(caution("simulation-failed", "This smart contract call fails in a test run, so it would probably fail for real."));
        } else {
          simulated = true;
          changes = await simulatedChanges(sim, dc);
          if (sim.minResourceFee) lines.push({ label: "Smart contract resources", value: `${formatUnits(BigInt(sim.minResourceFee), 7)} XLM (included in the fee)` });
        }
      } catch {
        unsimulated = true;
      }
    } else {
      unsimulated = true;
    }
    // Audit STL-01: a contract call's sub-calls are shown by name only (no arguments); without a test run nothing
    // shows what moves, so this is blind signing rather than a caution.
    if (unsimulated) {
      blind = true;
      warnings.push(danger("blind-signing", "Couldn't test-run this smart contract call, so Clip Wallet can't show what it moves. Only sign it if you trust the app."));
    }
  }

  const titles = outs.map((o) => o.title);
  const title = titles.length === 1 ? titles[0]! : titles.length === 2 ? `${titles[0]} and ${lower(titles[1]!)}` : `Approve ${titles.length} actions`;
  if (blind) warnings.unshift(danger("blind-signing", "Part of this transaction couldn't be read. Only sign it if you trust the app."));
  blind = blind || ops.length === 0;
  return { title, lines, balanceChanges: mergeChanges(changes), warnings, blind, simulated, fee };
}

function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

