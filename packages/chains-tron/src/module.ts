import {
  type AssetRef,
  type ChainContext,
  type ChainModule,
  ClipError,
  type DappRequest,
  type DecodedRequest,
  type Network,
  type Nft,
  type Signature,
  type SignablePayload,
  type TokenBalance,
  type Warning,
  WALLET_ORIGIN,
  isWalletOrigin,
  msg,
} from "@clip-wallet/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { decodeUint, encodeBalanceOf, encodeTransferCall } from "./abi.js";
import { addressBytes, addressBytesFromPublicKey, encodeAddress, isTronAddress, sameAddress } from "./address.js";
import { type Described, type TokenInfo, describeContract, memoLine, readTokenInfo } from "./describe.js";
import { messageHash } from "./message.js";
import { specFor, trxAsset, usdtAsset } from "./networks.js";
import { type TronAccount, type TronResources, type TronRpc, nodeMessage, plainTronError, rpcFor } from "./rpc.js";
import { Writer } from "./proto.js";
import {
  ProtoError,
  type RawTx,
  type TronWebTx,
  bandwidthBytes,
  encodeRaw,
  encodeTransfer,
  encodeTrigger,
  jsonMismatches,
  ownerOf,
  parseRaw,
  txIdOf,
  txObjectOf,
} from "./tx.js";
import { big, bytesEqual, formatUnits, fromHex, hex, hostOf, randomId, sleep as defaultSleep, textOf, utf8 } from "./util.js";

/**
 * Request methods.
 *  - `tron_signTransaction` / `tron_signMessage`: the WalletConnect (Reown) TRON methods
 *    (https://github.com/reown-com/reown-docs/blob/main/advanced/multichain/rpc-reference/tron-rpc.mdx). Params
 *    `{ address, transaction }` (a TronWeb transaction object, flat or the legacy nested `{ transaction: {…} }`) and
 *    `{ address, message }`. Results: the transaction with `signature: [hex]` added, and `{ signature: "0x…" }`.
 *    `tron_signMessage` also takes `encoding: "hex"` for byte messages (TronWeb's signMessageV2 accepts bytes); that's
 *    Clip's extension, used by 1Mask's TronWeb subset.
 *  - `tron_signAndSendTransaction`: Clip's own (same params as tron_signTransaction); the wallet also broadcasts and
 *    waits for the transaction to land. buildTransfer uses it. Result `{ txID, result: true, transaction }`.
 */
export const TRON_METHODS = {
  signTransaction: "tron_signTransaction",
  signMessage: "tron_signMessage",
  signAndSendTransaction: "tron_signAndSendTransaction",
} as const;

export interface TronModuleOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Expiration of transactions Clip builds, after the reference block's time (default 10 min; TRON allows 24 h). */
  expirationMs?: number;
  /** Polls of /wallet/gettransactioninfobyid after broadcasting (default 10, every 3 s: about one block each). */
  confirmAttempts?: number;
  confirmPollMs?: number;
  /** Extra energy allowed in the fee limit of TRC-20 sends Clip builds, in percent of the estimate (default 30). */
  energyMarginPercent?: number;
}

/** Staked TRX (Stake 2.0) and resources, in sun / units. Read from the same /wallet/getaccount call as balances. */
export interface TronStaking {
  staked: string;
  /** Unstaked, still waiting out the unstaking period. */
  unstaking: string;
  /** Unstaked and ready to withdraw (WithdrawExpireUnfreeze). */
  withdrawable: string;
  energy: { used: string; limit: string };
  bandwidth: { used: string; limit: string; freeUsed: string; freeLimit: string };
}

type Normalized =
  | { kind: "message"; bytes: Uint8Array }
  | { kind: "tx"; tx: TronWebTx; rawBytes: Uint8Array; raw: RawTx | null; txId: Uint8Array; send: boolean };

const isObj = (p: unknown): p is Record<string, unknown> => !!p && typeof p === "object" && !Array.isArray(p);
const trx = (sun: bigint) => `${formatUnits(sun, 6)} TRX`;
const NOT_CONTROLLED = () => new ClipError(msg("bg.tron.notControlled"), "tron/not-controlled");
const WRONG_NETWORK = "This is for a different network, so Clip Wallet stopped it. Nothing was signed.";
const DEFAULT_ENERGY = 130_000n; // a TRC-20 transfer to an address that never held the token, when no estimate is possible

export function normalize(request: DappRequest, ctx: ChainContext): Normalized {
  const method = request.method;
  if (method !== TRON_METHODS.signTransaction && method !== TRON_METHODS.signMessage && method !== TRON_METHODS.signAndSendTransaction) {
    throw new ClipError("Clip Wallet doesn't support this kind of request yet.", "tron/unsupported-method");
  }
  if (!specFor(request.networkId) || request.networkId !== ctx.network.id || ctx.network.family !== "tron") throw new ClipError(WRONG_NETWORK, "tron/network-mismatch");
  const p = isObj(request.params) ? request.params : {};
  if (p.address !== undefined && (typeof p.address !== "string" || !sameAddress(p.address, ctx.account.address))) {
    throw new ClipError("This request is for a different account than the one you connected.", "tron/wrong-account");
  }
  if (method === TRON_METHODS.signMessage) {
    if (typeof p.message !== "string") throw new ClipError("This request from the app is malformed, so we stopped it.", "tron/malformed");
    if (p.encoding === "hex") {
      if (!/^(0x)?([0-9a-f]{2})*$/i.test(p.message)) throw new ClipError("This request from the app is malformed, so we stopped it.", "tron/malformed");
      return { kind: "message", bytes: fromHex(p.message) };
    }
    return { kind: "message", bytes: utf8(p.message) };
  }
  let tx: TronWebTx;
  try {
    tx = txObjectOf(p.transaction ?? p);
  } catch (e) {
    throw new ClipError("This request from the app is malformed, so we stopped it.", "tron/malformed", e);
  }
  const rawBytes = fromHex(tx.raw_data_hex);
  const txId = txIdOf(rawBytes);
  // The txID the app shows must be the hash of the bytes that get signed.
  if (tx.txID !== undefined && !bytesEqual(fromHex(tx.txID), txId)) throw new ClipError("This request from the app is malformed, so we stopped it.", "tron/txid-mismatch");
  let raw: RawTx | null = null;
  try {
    raw = parseRaw(rawBytes);
  } catch (e) {
    if (!(e instanceof ProtoError) && !(e instanceof TypeError)) throw e;
  }
  // Trust only the hex: JSON that says something else is refused.
  if (raw && isObj(tx.raw_data) && jsonMismatches(tx.raw_data, raw).length) {
    throw new ClipError("This request from the app is malformed, so we stopped it.", "tron/json-mismatch");
  }
  return { kind: "tx", tx, rawBytes, raw, txId, send: method === TRON_METHODS.signAndSendTransaction };
}

/** Does `me` alone meet the threshold of the permission this transaction uses (0 = owner, ≥ 2 = an active one)? */
export function controls(account: TronAccount, me: string, permissionId: number): boolean {
  if (!account.address) return permissionId === 0; // not on chain yet: the default owner permission is the address itself
  const perm = permissionId === 0 ? account.owner_permission : account.active_permission?.find((p) => (p.id ?? 2) === permissionId);
  if (!perm) return permissionId === 0;
  const weight = (perm.keys ?? []).filter((k) => sameAddress(k.address, me)).reduce((a, k) => a + BigInt(k.weight ?? 0), 0n);
  return weight >= BigInt(perm.threshold ?? 1);
}

export function createTronModule(options: TronModuleOptions = {}): ChainModule & {
  normalize: typeof normalize;
  staking(ctx: ChainContext): Promise<TronStaking>;
} {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
  const expirationMs = BigInt(options.expirationMs ?? 10 * 60_000);
  const attempts = options.confirmAttempts ?? 10;
  const pollMs = options.confirmPollMs ?? 3000;
  const margin = BigInt(options.energyMarginPercent ?? 30);
  const paramsCache = new Map<string, { at: number; p: Map<string, bigint> }>();
  const tokenCache = new Map<string, Promise<TokenInfo | null>>();

  async function chainParams(ctx: ChainContext, rpc: TronRpc): Promise<Map<string, bigint>> {
    const c = paramsCache.get(ctx.network.id);
    if (c && now() - c.at < 10 * 60_000) return c.p;
    const p = await rpc.chainParameters();
    paramsCache.set(ctx.network.id, { at: now(), p });
    return p;
  }
  const param = (p: Map<string, bigint>, key: string, fallback: bigint) => p.get(key) ?? fallback;

  function tokenInfo(ctx: ChainContext, rpc: TronRpc, contract: Uint8Array): Promise<TokenInfo | null> {
    const key = `${ctx.network.id}:${hex(contract)}`;
    let v = tokenCache.get(key);
    if (!v) {
      v = readTokenInfo(rpc, ctx.account.address, contract, ctx.network.id);
      tokenCache.set(key, v);
      v.then((r) => r === null && tokenCache.delete(key)).catch(() => tokenCache.delete(key));
    }
    return v;
  }

  /** The reference block must be a block of THIS network (TAPOS): a transaction made for another TRON network is refused. */
  async function checkRefBlock(rpc: TronRpc, raw: RawTx): Promise<void> {
    if (raw.refBlockBytes.length !== 2 || raw.refBlockHash.length !== 8) throw new ClipError(WRONG_NETWORK, "tron/network-mismatch");
    const head = await rpc.nowBlock();
    const ref = (raw.refBlockBytes[0]! << 8) | raw.refBlockBytes[1]!;
    const delta = BigInt((Number(head.number & 0xffffn) - ref + 65536) % 65536);
    const num = head.number - delta;
    if (num < 0n) throw new ClipError(WRONG_NETWORK, "tron/network-mismatch");
    const id = await rpc.blockId(num).catch(() => null);
    if (id !== null && !bytesEqual(fromHex(id).subarray(8, 16), raw.refBlockHash)) throw new ClipError(WRONG_NETWORK, "tron/network-mismatch");
  }

  interface Fee {
    total: bigint;
    activation: bigint;
    energy: bigint | null;
    simulated: boolean;
    warnings: Warning[];
  }

  /**
   * The most TRX this transaction can burn, given what the account has right now (resources used earlier recover over
   * 24 h; that recovery isn't counted, so this errs high). Bandwidth: the signed size in bytes, free if staked or the
   * daily free bandwidth covers ALL of it, else bytes × getTransactionFee. A TRX/TRC-10 transfer that opens the
   * recipient's account: getCreateNewAccountFeeInSystemContract, plus getCreateAccountFee unless staked bandwidth
   * covers it (free bandwidth can't). A memo: getMemoFee. A contract call: (estimated energy − available energy) ×
   * getEnergyFee, at most the fee limit. (java-tron BandwidthProcessor / EnergyProcessor; TRON docs "Resource Model".)
   */
  async function feeOf(ctx: ChainContext, rpc: TronRpc, raw: RawTx, d: Described): Promise<Fee> {
    const me = ctx.account.address;
    const [p, res] = await Promise.all([chainParams(ctx, rpc), rpc.resources(me).catch((): TronResources => ({}))]);
    const bytes = BigInt(bandwidthBytes(raw.bytes.length, 1, raw.contracts.length));
    const stakedNet = big(res.NetLimit) - big(res.NetUsed);
    const freeNet = big(res.freeNetLimit) - big(res.freeNetUsed);
    const warnings: Warning[] = [];
    let bandwidth = stakedNet >= bytes || freeNet >= bytes ? 0n : bytes * param(p, "getTransactionFee", 1000n);
    let activation = 0n;
    if (d.recipient) {
      const to = await rpc.account(encodeAddress(d.recipient));
      if (to.type === "Contract" && raw.contracts[0]?.name === "TransferContract") throw new ClipError(msg("bg.tron.contractRecipient"), "tron/contract-recipient");
      if (!to.address) {
        activation = param(p, "getCreateNewAccountFeeInSystemContract", 1_000_000n) + (stakedNet >= bytes ? 0n : param(p, "getCreateAccountFee", 100_000n));
        bandwidth = 0n;
        const m = msg("bg.tron.newAccountFee", { amount: trx(activation) });
        warnings.push({ level: "info", code: "new-recipient", message: m.fallback, msg: m });
      }
    }
    const memo = raw.data.length ? param(p, "getMemoFee", 1_000_000n) : 0n;
    let energyBurn = 0n;
    let energy: bigint | null = null;
    let simulated = false;
    if (d.call) {
      const contract = encodeAddress(d.call.contract);
      const sim = await rpc.triggerConstant(me, contract, d.call.data, d.call.callValue).catch(() => null);
      simulated = !!sim?.result;
      if (sim?.result && !sim.result.result) {
        const reason = nodeMessage(sim.result.message).slice(0, 160);
        const m = reason ? msg("bg.warn.expectedToFailReason", { reason }) : msg("bg.warn.expectedToFail");
        warnings.push({ level: "danger", code: "simulation-failed", message: m.fallback, msg: m });
      }
      energy = await rpc.estimateEnergy(me, contract, d.call.data, d.call.callValue);
      if (energy === null && sim?.result?.result && typeof sim.energy_used === "number") energy = BigInt(sim.energy_used) + BigInt(sim.energy_penalty ?? 0);
      const available = big(res.EnergyLimit) - big(res.EnergyUsed);
      const feeLimit = raw.feeLimit;
      if (energy === null) {
        energyBurn = feeLimit;
        if (!sim) warnings.push({ level: "caution", code: "simulation-failed", message: "We couldn't preview the exact result of this on the network. Check the details before you approve." });
      } else {
        energyBurn = (energy > available ? energy - available : 0n) * param(p, "getEnergyFee", 100n);
        if (energyBurn > feeLimit) {
          // Over the fee limit the call runs out of energy and fails, burning the whole limit.
          energyBurn = feeLimit;
          if (!warnings.some((w) => w.code === "simulation-failed")) warnings.push({ level: "danger", code: "simulation-failed", message: msg("bg.warn.expectedToFail").fallback, msg: msg("bg.warn.expectedToFail") });
        }
      }
    }
    return { total: bandwidth + activation + memo + energyBurn, activation, energy, simulated, warnings };
  }

  async function account(rpc: TronRpc, me: string): Promise<TronAccount> {
    return rpc.account(me);
  }

  async function decode(req: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
    const n = normalize(req, ctx);
    const TRX = trxAsset(ctx.network.id);
    const host = hostOf(req.origin);
    if (n.kind === "message") {
      const text = textOf(n.bytes);
      const warnings: Warning[] = text === null ? [{ level: "caution", code: "blind-signing", message: "This message isn't readable text. It can't move funds by itself, but only sign it if you trust the site." }] : [];
      const t = msg("bg.req.signMessage", { host });
      return {
        requestId: req.id,
        networkId: req.networkId,
        title: t.fallback,
        titleMsg: t,
        lines: [text !== null ? { label: "Message", value: text } : { label: "Message (not text)", value: `0x${hex(n.bytes)}` }],
        balanceChanges: [],
        simulated: false,
        blind: false,
        warnings,
      };
    }

    const me = ctx.account.address;
    const me21 = addressBytes(me);
    if (!me21) throw new ClipError("That address isn't valid. Check it and try again.", "tron/bad-account");
    const raw = n.raw;
    const blind = (): DecodedRequest => ({
      requestId: req.id,
      networkId: req.networkId,
      title: msg("bg.req.unreadableFrom", { host }).fallback,
      titleMsg: msg("bg.req.unreadableFrom", { host }),
      lines: [{ label: "Data", value: `0x${hex(n.rawBytes).slice(0, 120)}${n.rawBytes.length > 60 ? "…" : ""}` }],
      balanceChanges: [],
      simulated: false,
      blind: true,
      warnings: [{ level: "danger", code: "blind-signing", message: "Clip Wallet can't read this transaction. Only sign it if you trust the app." }],
    });
    // Exactly one contract (java-tron accepts only one), nothing Clip doesn't explain.
    if (!raw || raw.contracts.length !== 1 || raw.oddities.length) return blind();
    const c = raw.contracts[0]!;
    if (!c.name || c.extra || c.typeUrl !== `type.googleapis.com/protocol.${c.name}`) return blind();
    let owner: Uint8Array | null;
    try {
      owner = ownerOf(c);
    } catch {
      return blind();
    }
    if (owner && !bytesEqual(owner, me21)) throw new ClipError("This transaction doesn't need your signature.", "tron/not-a-signer");
    if (raw.expiration <= BigInt(now())) throw new ClipError("This request expired. Please try again from the app.", "tron/expired");

    const rpc = rpcFor(ctx);
    const [acct] = await Promise.all([account(rpc, me), checkRefBlock(rpc, raw)]);
    if (!controls(acct, me, c.permissionId)) throw NOT_CONTROLLED();

    let d: Described;
    try {
      d = await describeContract(c, {
        networkId: ctx.network.id,
        me: me21,
        rpc,
        token: (contract) => tokenInfo(ctx, rpc, contract),
        unstakeDays: async () => (await chainParams(ctx, rpc).catch(() => null))?.get("getUnfreezeDelayDays") ?? null,
      });
    } catch (e) {
      if (e instanceof ProtoError || e instanceof TypeError) return blind();
      throw e;
    }
    const fee = await feeOf(ctx, rpc, raw, d);
    const lines = [...d.lines];
    const memo = memoLine(raw.data);
    if (memo) lines.push(memo);
    lines.push({ label: "Network fee at most", value: trx(fee.total) });
    if (!n.send && !isWalletOrigin(req.origin)) {
      const m = msg("bg.tron.getsSigned", { host });
      lines.push({ label: "Sent by", value: m.fallback, valueMsg: m });
    }
    const balanceChanges = [...d.balanceChanges];
    return {
      requestId: req.id,
      networkId: req.networkId,
      title: d.title,
      ...(d.titleMsg ? { titleMsg: d.titleMsg } : {}),
      lines,
      balanceChanges,
      fee: { asset: TRX, amount: fee.total.toString() },
      simulated: fee.simulated,
      blind: d.blind,
      warnings: [...d.warnings, ...fee.warnings],
    };
  }

  async function prepare(req: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
    const n = normalize(req, ctx);
    const bytes = n.kind === "message" ? messageHash(n.bytes) : n.txId;
    return [{ accountId: ctx.account.id, scheme: "ecdsa-secp256k1", bytes, approvalId }];
  }

  /** r ‖ s ‖ v (v = 27 + recovery, as TronWeb's ECKeySign / joinSignature), after checking it against the account key. */
  function signatureHex(sig: Signature | undefined, digest: Uint8Array, ctx: ChainContext): string {
    const pub = fromHex(ctx.account.publicKey);
    if (!sig || sig.scheme !== "ecdsa-secp256k1" || sig.bytes.length !== 64) throw new ClipError("The signature didn't match. Nothing was sent.", "tron/bad-signature");
    let ok = false;
    try {
      ok = secp256k1.verify(sig.bytes, digest, pub, { prehash: false });
    } catch {
      ok = false;
    }
    if (!ok) throw new ClipError("The signature didn't match. Nothing was sent.", "tron/bad-signature");
    const s = secp256k1.Signature.fromBytes(sig.bytes, "compact");
    const want = secp256k1.Point.fromBytes(pub);
    const order = sig.recovery === 1 ? [1, 0] : [0, 1];
    for (const rec of order) {
      try {
        if (s.addRecoveryBit(rec).recoverPublicKey(digest).equals(want)) return `${hex(sig.bytes)}${(27 + rec).toString(16)}`;
      } catch {
        /* try the other */
      }
    }
    throw new ClipError("The signature didn't match. Nothing was sent.", "tron/bad-signature");
  }

  async function confirm(rpc: TronRpc, txId: string): Promise<void> {
    for (let k = 0; k < attempts; k++) {
      if (pollMs > 0) await sleep(pollMs);
      const info = await rpc.post<{ id?: string; receipt?: { result?: string }; result?: string; resMessage?: string }>("/wallet/gettransactioninfobyid", { value: txId }).catch(() => null);
      if (!info?.id) continue;
      const r = info.receipt?.result;
      if (info.result === "FAILED" || (r && r !== "SUCCESS" && r !== "DEFAULT")) {
        throw new ClipError("This didn't go through. Check Activity before you try again.", "tron/failed");
      }
      return;
    }
  }

  async function finalize(req: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown> {
    const n = normalize(req, ctx);
    if (signatures.length !== 1) throw new ClipError("Some signatures are missing. Nothing was sent.", "tron/bad-signature");
    if (n.kind === "message") return { signature: `0x${signatureHex(signatures[0], messageHash(n.bytes), ctx)}` };

    const sigHex = signatureHex(signatures[0], n.txId, ctx);
    const txID = hex(n.txId);
    const signed = { ...n.tx, txID, signature: [...(n.tx.signature ?? []).filter((s) => s.replace(/^0x/, "").toLowerCase() !== sigHex), sigHex] };
    if (!n.send) return signed;

    const body = new Writer().message(1, n.rawBytes);
    for (const s of signed.signature) body.bytes(2, fromHex(s));
    const rpc = rpcFor(ctx);
    const res = await rpc.broadcastHex(hex(body.finish()));
    if (!res.result) throw new ClipError(plainTronError(res.code, nodeMessage(res.message)), "tron/send-failed");
    await confirm(rpc, txID);
    return { txID, result: true, transaction: signed };
  }

  async function balanceOf(rpc: TronRpc, me: string, token: string): Promise<bigint | null> {
    const r = await rpc.triggerConstant(me, token, encodeBalanceOf(addressBytes(me)!)).catch(() => null);
    return r?.result?.result ? decodeUint(r.constant_result?.[0]) : null;
  }

  async function getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
    const rpc = rpcFor(ctx);
    const me = ctx.account.address;
    const acct = await rpc.account(me);
    const out: TokenBalance[] = [{ asset: trxAsset(ctx.network.id), amount: big(acct.balance).toString() }];
    const usdt = usdtAsset(ctx.network.id);
    if (usdt?.address) {
      const v = await balanceOf(rpc, me, usdt.address);
      if (v !== null) out.push({ asset: usdt, amount: v.toString() });
    }
    return out;
  }

  async function staking(ctx: ChainContext): Promise<TronStaking> {
    const rpc = rpcFor(ctx);
    const me = ctx.account.address;
    const [acct, res] = await Promise.all([rpc.account(me), rpc.resources(me).catch((): TronResources => ({}))]);
    const t = BigInt(now());
    const staked =
      (acct.frozenV2 ?? []).reduce((a, f) => a + big(f.amount), 0n) +
      big(acct.delegated_frozenV2_balance_for_bandwidth) +
      big(acct.account_resource?.delegated_frozenV2_balance_for_energy);
    let unstaking = 0n;
    let withdrawable = 0n;
    for (const u of acct.unfrozenV2 ?? []) {
      if (big(u.unfreeze_expire_time) <= t) withdrawable += big(u.unfreeze_amount);
      else unstaking += big(u.unfreeze_amount);
    }
    return {
      staked: staked.toString(),
      unstaking: unstaking.toString(),
      withdrawable: withdrawable.toString(),
      energy: { used: big(res.EnergyUsed).toString(), limit: big(res.EnergyLimit).toString() },
      bandwidth: { used: big(res.NetUsed).toString(), limit: big(res.NetLimit).toString(), freeUsed: big(res.freeNetUsed).toString(), freeLimit: big(res.freeNetLimit).toString() },
    };
  }

  function request(ctx: ChainContext, rawBytes: Uint8Array): DappRequest {
    return {
      id: randomId(),
      origin: WALLET_ORIGIN,
      via: "injected",
      family: "tron",
      networkId: ctx.network.id,
      method: TRON_METHODS.signAndSendTransaction,
      params: { address: ctx.account.address, transaction: { txID: hex(txIdOf(rawBytes)), raw_data_hex: hex(rawBytes), visible: true } },
    };
  }

  async function buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
    if (ctx.network.family !== "tron" || !specFor(ctx.network.id)) throw new ClipError("That network isn't available in this wallet.", "tron/network-mismatch");
    const me = ctx.account.address;
    const me21 = addressBytes(me)!;
    const to = p.to.trim();
    if (!isTronAddress(to)) throw new ClipError("That address isn't valid. Check it and try again.", "tron/bad-address");
    if (sameAddress(to, me)) throw new ClipError("That's your own address.", "tron/self-transfer");
    if (!/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "tron/bad-amount");
    const amount = BigInt(p.amount);
    const to21 = addressBytes(to)!;

    const rpc = rpcFor(ctx);
    const [acct, head] = await Promise.all([rpc.account(me), rpc.nowBlock()]);
    if (!acct.address) throw new ClipError(msg("bg.tron.notOpen"), "tron/not-open");
    if (!controls(acct, me, 0)) throw NOT_CONTROLLED();
    const balance = big(acct.balance);
    const base = { ref: head, timestamp: BigInt(now()), expiration: head.timestamp + expirationMs };

    if (!p.asset.address) {
      const rawBytes = encodeRaw({ ...base, name: "TransferContract", value: encodeTransfer(me21, to21, amount) });
      const raw = parseRaw(rawBytes);
      const fee = await feeOf(ctx, rpc, raw, { title: "", lines: [], balanceChanges: [], warnings: [], blind: false, recipient: to21 });
      if (amount + fee.total > balance) throw new ClipError(msg("bg.err.notEnoughForFee", { symbol: "TRX" }), "tron/insufficient-funds");
      return request(ctx, rawBytes);
    }

    const token = addressBytes(p.asset.address);
    if (!token || !isTronAddress(p.asset.address)) throw new ClipError("That token couldn't be found.", "tron/bad-asset");
    const symbol = p.asset.symbol;
    const held = await balanceOf(rpc, me, p.asset.address);
    if (held === null) throw new ClipError("That token couldn't be found.", "tron/bad-asset");
    if (held < amount) throw new ClipError(msg("bg.err.notEnough", { symbol }), "tron/insufficient-token");
    const data = encodeTransferCall(to21, amount);
    const params = await chainParams(ctx, rpc);
    const sim = await rpc.triggerConstant(me, p.asset.address, data);
    if (sim.result && !sim.result.result) throw new ClipError("This is expected to fail and would still cost a fee.", "tron/would-fail");
    const estimate =
      (await rpc.estimateEnergy(me, p.asset.address, data)) ??
      (typeof sim.energy_used === "number" ? BigInt(sim.energy_used) + BigInt(sim.energy_penalty ?? 0) : DEFAULT_ENERGY);
    const maxFeeLimit = param(params, "getMaxFeeLimit", 15_000_000_000n);
    let feeLimit = (estimate * param(params, "getEnergyFee", 100n) * (100n + margin)) / 100n;
    feeLimit = ((feeLimit + 99_999n) / 100_000n) * 100_000n; // round up to 0.1 TRX
    if (feeLimit > maxFeeLimit) feeLimit = maxFeeLimit;
    const rawBytes = encodeRaw({ ...base, feeLimit, name: "TriggerSmartContract", value: encodeTrigger(me21, token, data) });
    const raw = parseRaw(rawBytes);
    const fee = await feeOf(ctx, rpc, raw, { title: "", lines: [], balanceChanges: [], warnings: [], blind: false, call: { contract: token, data, callValue: 0n } });
    if (fee.total > balance) throw new ClipError(msg("bg.err.notEnoughForFee", { symbol: "TRX" }), "tron/insufficient-funds");
    return request(ctx, rawBytes);
  }

  return {
    family: "tron",
    curve: "secp256k1",
    /** TronLink / TronWeb.fromMnemonic: m/44'/195'/0'/0/i (account i = address index i). */
    derivationPath: (index: number) => `m/44'/195'/0'/0/${index}`,
    addressFromPublicKey(publicKey: Uint8Array, _network: Network): string {
      return encodeAddress(addressBytesFromPublicKey(publicKey));
    },
    isAddress: (value: string) => isTronAddress(value),
    /** The same address works on every TRON network. */
    networksForAddress: (value: string, candidates: Network[]) => (isTronAddress(value) ? candidates.filter((c) => c.family === "tron") : []),
    getBalances,
    getNfts: async (_ctx: ChainContext): Promise<Nft[]> => [],
    decode,
    prepare,
    finalize,
    buildTransfer,
    normalize,
    staking,
  };
}

