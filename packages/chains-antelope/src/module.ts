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
  WALLET_ORIGIN,
  type Warning,
  msg,
  say,
} from "@clip-wallet/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { AbiError, TOKEN_ABI, encodeActionData } from "./abi.js";
import { fromHex, hex, isAccountName, isCanonical, isName, parseAsset, parsePublicKey, publicKeyString, signatureString, formatAsset } from "./bytes.js";
import { abiFor, describeActions } from "./describe.js";
import { assetFor, knownTokens, specFor, tokenAssetOf, type AntelopeToken } from "./networks.js";
import { AntelopeRpcError, type KeyAccount, type Rpc, plainAntelopeError, rpcFor } from "./rpc.js";
import { type ActionJson, type TransactionJson, expirationSeconds, expirationText, packTransaction, signingDigest, tapos, transactionId } from "./transaction.js";

/**
 * Request methods (Clip Wallet's own; no wallet-side Antelope standard exists to implement, see README):
 *  - antelope_signTransaction: { transaction, account? } → { signatures, packed_trx, transaction_id }
 *  - antelope_signAndPushTransaction: same → { transaction_id, processed? } (sent with send_transaction2)
 * `transaction` is the abieos JSON of a transaction; the header (expiration, ref_block_num, ref_block_prefix) may be
 * left out for the wallet to fill. Action `data` is packed hex, or an object serialised with the contract's ABI.
 * buildTransfer uses antelope_signAndPushTransaction with WALLET_ORIGIN.
 */
export const ANTELOPE_METHODS = {
  signTransaction: "antelope_signTransaction",
  signAndPushTransaction: "antelope_signAndPushTransaction",
} as const;

export interface AntelopeModuleOptions {
  /** Seconds until a filled-in transaction expires (default 300). */
  expireSeconds?: number;
  /** How long discovered account names are kept (default 60 s). */
  accountsTtlMs?: number;
}

interface Normalized {
  header: Partial<TransactionJson>;
  actions: { account: string; name: string; authorization: { actor: string; permission: string }[]; data: unknown }[];
  push: boolean;
  needsHeader: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function malformed(): ClipError {
  return new ClipError("This request from the app is malformed, so we stopped it.", "antelope/bad-params");
}

export function normalize(request: DappRequest, ctx: ChainContext): Normalized {
  if (request.method !== ANTELOPE_METHODS.signTransaction && request.method !== ANTELOPE_METHODS.signAndPushTransaction) {
    throw new ClipError("Clip Wallet doesn't support this kind of request yet.", "antelope/unsupported-method");
  }
  if (!specFor(request.networkId) || request.networkId !== ctx.network.id) {
    throw new ClipError(msg("bg.antelope.err.wrongNetwork"), "antelope/network-mismatch");
  }
  const p = request.params;
  if (!isObj(p)) throw malformed();
  const t = isObj(p.transaction) ? p.transaction : p;
  if (p.chainId !== undefined && (typeof p.chainId !== "string" || specFor(p.chainId)?.chainId !== specFor(ctx.network.id)?.chainId)) {
    throw new ClipError(msg("bg.antelope.err.wrongNetwork"), "antelope/network-mismatch");
  }
  if (!Array.isArray(t.actions) || !t.actions.length) throw malformed();
  if ((Array.isArray(t.context_free_actions) && t.context_free_actions.length) || (Array.isArray(t.transaction_extensions) && t.transaction_extensions.length)) {
    throw new ClipError(msg("bg.antelope.err.contextFree"), "antelope/unsupported");
  }
  const actions = t.actions.map((a) => {
    if (!isObj(a) || typeof a.account !== "string" || typeof a.name !== "string" || !isName(a.account) || !isName(a.name) || !Array.isArray(a.authorization)) throw malformed();
    const authorization = a.authorization.map((x) => {
      if (!isObj(x) || typeof x.actor !== "string" || typeof x.permission !== "string" || !isName(x.actor) || !isName(x.permission)) throw malformed();
      return { actor: x.actor, permission: x.permission };
    });
    return { account: a.account, name: a.name, authorization, data: a.data };
  });
  const header: Partial<TransactionJson> = {};
  for (const k of ["expiration", "ref_block_num", "ref_block_prefix", "max_net_usage_words", "max_cpu_usage_ms", "delay_sec"] as const) {
    if (t[k] !== undefined) (header as Record<string, unknown>)[k] = t[k];
  }
  const needsHeader = header.expiration === undefined || header.ref_block_num === undefined || header.ref_block_prefix === undefined;
  return { header, actions, push: request.method === ANTELOPE_METHODS.signAndPushTransaction, needsHeader };
}

export function createAntelopeModule(options: AntelopeModuleOptions = {}): ChainModule & {
  normalize: typeof normalize;
  accounts(ctx: ChainContext): Promise<KeyAccount[]>;
  receiveAddress(ctx: ChainContext): Promise<string>;
} {
  const expireSeconds = options.expireSeconds ?? 300;
  const ttl = options.accountsTtlMs ?? 60_000;
  const accountCache = new Map<string, { at: number; list: KeyAccount[] }>();
  /** Per request: the exact transaction decode showed (header filled once). */
  const built = new Map<string, { tx: TransactionJson; packed: Uint8Array }>();
  const remember = (id: string, v: { tx: TransactionJson; packed: Uint8Array }) => {
    built.set(id, v);
    if (built.size > 64) built.delete(built.keys().next().value!);
  };

  function keyOf(ctx: ChainContext): string {
    return ctx.account.address.startsWith("PUB_K1_") ? ctx.account.address : publicKeyString(fromHex(ctx.account.publicKey));
  }

  async function accounts(ctx: ChainContext): Promise<KeyAccount[]> {
    const k = `${ctx.network.id}/${keyOf(ctx)}`;
    const hit = accountCache.get(k);
    if (hit && Date.now() - hit.at < ttl) return hit.list;
    const list = await rpcFor(ctx).accountsForKey(keyOf(ctx));
    accountCache.set(k, { at: Date.now(), list });
    return list;
  }

  function noAccount(ctx: ChainContext): ClipError {
    return new ClipError(msg(ctx.network.testnet ? "bg.antelope.err.noAccountTestnet" : "bg.antelope.err.noAccount", { network: ctx.network.name }), "antelope/no-account");
  }

  async function firstAccount(ctx: ChainContext): Promise<string> {
    const list = await accounts(ctx);
    const pick = list.find((a) => a.permission === "active") ?? list[0];
    if (!pick) throw noAccount(ctx);
    return pick.account;
  }

  async function header(rpc: Rpc, h: Partial<TransactionJson>): Promise<Pick<TransactionJson, "expiration" | "ref_block_num" | "ref_block_prefix">> {
    if (h.expiration !== undefined && h.ref_block_num !== undefined && h.ref_block_prefix !== undefined) {
      return { expiration: String(h.expiration), ref_block_num: Number(h.ref_block_num), ref_block_prefix: Number(h.ref_block_prefix) };
    }
    const info = await rpc.info();
    const head = expirationSeconds(info.head_block_time.replace(/\.\d+$/, ""));
    return { expiration: h.expiration !== undefined ? String(h.expiration) : expirationText(head + expireSeconds), ...tapos(info.last_irreversible_block_id) };
  }

  async function build(n: Normalized, ctx: ChainContext, rpc: Rpc): Promise<{ tx: TransactionJson; packed: Uint8Array }> {
    const actions: ActionJson[] = [];
    for (const a of n.actions) {
      let data: string;
      if (typeof a.data === "string" && /^([0-9a-fA-F]{2})*$/.test(a.data)) data = a.data.toLowerCase();
      else if (isObj(a.data)) {
        const abi = await abiFor({ ...a, data: "" }, { networkId: ctx.network.id, rpc });
        if (!abi) throw new ClipError(msg("bg.antelope.err.noAbi", { contract: a.account }), "antelope/unreadable-operation");
        try {
          data = hex(encodeActionData(abi, a.name, a.data));
        } catch (e) {
          if (e instanceof AbiError) throw new ClipError(msg("bg.antelope.err.noAbi", { contract: a.account }), "antelope/unreadable-operation", e);
          throw e;
        }
      } else throw malformed();
      actions.push({ account: a.account, name: a.name, authorization: a.authorization, data });
    }
    const h = await header(rpc, n.header);
    const tx: TransactionJson = {
      ...h,
      max_net_usage_words: Number(n.header.max_net_usage_words ?? 0),
      max_cpu_usage_ms: Number(n.header.max_cpu_usage_ms ?? 0),
      delay_sec: Number(n.header.delay_sec ?? 0),
      context_free_actions: [],
      actions,
      transaction_extensions: [],
    };
    let packed: Uint8Array;
    try {
      packed = packTransaction(tx);
    } catch (e) {
      throw new ClipError("This request from the app is malformed, so we stopped it.", "antelope/bad-params", e);
    }
    return { tx, packed };
  }

  /** Every authorization must be one this key holds (sign-and-push), or at least one (sign only: others co-sign). */
  function checkAuth(tx: TransactionJson, mine: KeyAccount[], push: boolean): void {
    const holds = (p: { actor: string; permission: string }) => mine.some((m) => m.account === p.actor && (m.permission === p.permission || (m.permission === "owner" && p.permission === "active")));
    const auths = tx.actions.flatMap((a) => a.authorization);
    const ours = auths.filter(holds);
    if (!ours.length) {
      if (auths.some((p) => mine.some((m) => m.account === p.actor))) throw new ClipError(msg("bg.antelope.err.permission"), "antelope/wrong-account");
      throw new ClipError("This transaction doesn't need your signature.", "antelope/wrong-account");
    }
    if (push && ours.length !== auths.length) throw new ClipError(msg("bg.antelope.err.otherSigners"), "antelope/missing-signature");
  }

  async function decode(req: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
    const n = normalize(req, ctx);
    const rpc = rpcFor(ctx);
    const mine = await accounts(ctx);
    if (!mine.length) throw noAccount(ctx);
    const b = await build(n, ctx, rpc);
    checkAuth(b.tx, mine, n.push);
    remember(req.id, b);
    const spec = specFor(ctx.network.id);
    const d = await describeActions(b.tx.actions, { networkId: ctx.network.id, mine: new Set(mine.map((m) => m.account)), rpc });
    const warnings: Warning[] = [...d.warnings];
    if (b.tx.delay_sec > 0) warnings.push({ level: "caution", code: "durable-nonce", message: say("bg.antelope.delayed", { seconds: b.tx.delay_sec }) });
    const lines = [...d.lines];
    lines.push({ label: "Network fee", value: spec?.resources === "free" ? say("bg.antelope.feeFree") : say("bg.antelope.feeResources") });
    if (!n.push) lines.push({ label: "Sent by", value: say("bg.antelope.appSends", { host: hostOf(req.origin) }) });
    return { requestId: req.id, networkId: req.networkId, title: d.title, lines, balanceChanges: d.balanceChanges, simulated: false, blind: d.blind, warnings };
  }

  async function builtFor(req: DappRequest, ctx: ChainContext): Promise<{ tx: TransactionJson; packed: Uint8Array }> {
    const cached = built.get(req.id);
    if (cached) return cached;
    const n = normalize(req, ctx);
    if (n.needsHeader) throw new ClipError("This request expired. Please try again from the app.", "antelope/not-prepared");
    const b = await build(n, ctx, rpcFor(ctx));
    checkAuth(b.tx, await accounts(ctx), n.push);
    remember(req.id, b);
    return b;
  }

  async function prepare(req: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
    const b = await builtFor(req, ctx);
    const spec = specFor(ctx.network.id)!;
    return [{ accountId: ctx.account.id, scheme: "ecdsa-secp256k1", bytes: signingDigest(spec.chainId, b.packed), approvalId }];
  }

  async function finalize(req: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown> {
    const n = normalize(req, ctx);
    const b = built.get(req.id);
    if (!b) throw new ClipError("This request expired. Please try again from the app.", "antelope/not-prepared");
    const spec = specFor(ctx.network.id)!;
    const digest = signingDigest(spec.chainId, b.packed);
    const sig = signatures[0];
    const pub = parsePublicKey(keyOf(ctx));
    if (
      signatures.length !== 1 ||
      !sig ||
      sig.scheme !== "ecdsa-secp256k1" ||
      sig.bytes.length !== 64 ||
      (sig.recovery !== 0 && sig.recovery !== 1) ||
      !isCanonical(sig.bytes) ||
      !secp256k1.verify(sig.bytes, digest, pub, { prehash: false }) ||
      !recoversTo(sig.bytes, sig.recovery, digest, pub)
    ) {
      throw new ClipError("The signature didn't match. Nothing was sent.", "antelope/bad-signature");
    }
    const sigText = signatureString(sig.bytes, sig.recovery);
    const packedHex = hex(b.packed);
    const id = transactionId(b.packed);
    built.delete(req.id);
    if (!n.push) return { signatures: [sigText], packed_trx: packedHex, transaction_id: id };
    try {
      const r = await rpcFor(ctx).send(packedHex, [sigText]);
      return { transaction_id: r.transaction_id ?? id, ...(r.processed ? { processed: r.processed } : {}) };
    } catch (e) {
      if (e instanceof AntelopeRpcError) {
        const m = plainAntelopeError(e, spec, ctx.network.name);
        const resource = /cpu|net|ram/i.test(m.id);
        throw new ClipError(m, resource ? "antelope/insufficient-resources" : "antelope/send-failed", e);
      }
      throw e;
    }
  }

  async function getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
    const spec = specFor(ctx.network.id);
    if (!spec) return [];
    const list = await accounts(ctx);
    const account = list[0]?.account;
    const core = tokenAssetOf(ctx.network.id, spec.core);
    if (!account) return [{ asset: core, amount: "0" }];
    const rpc = rpcFor(ctx);
    const out: TokenBalance[] = [];
    for (const t of knownTokens(ctx.network.id)) {
      const text = await rpc.balance(t.contract, account, t.symbol);
      const units = text ? parseAsset(text).amount : 0n;
      if (t === spec.core || units > 0n) out.push({ asset: tokenAssetOf(ctx.network.id, t), amount: units.toString() });
    }
    for (const t of (await rpc.tokens(account)) ?? []) {
      if (knownTokens(ctx.network.id).some((k) => k.contract === t.contract && k.symbol === t.symbol)) continue;
      let units: bigint;
      try {
        units = parseAsset(`${t.amount} ${t.symbol}`).amount;
      } catch {
        continue;
      }
      if (units > 0n) out.push({ asset: assetFor(ctx.network.id, t.contract, t.symbol, t.precision), amount: units.toString() });
    }
    return out;
  }

  async function getNfts(_ctx: ChainContext): Promise<Nft[]> {
    return [];
  }

  function tokenOf(asset: AssetRef, ctx: ChainContext): AntelopeToken {
    const spec = specFor(ctx.network.id)!;
    if (!asset.address) return spec.core;
    const [contract, symbol] = asset.address.split(":");
    if (!contract || !symbol || !isName(contract) || !/^[A-Z]{1,7}$/.test(symbol)) throw new ClipError(msg("bg.antelope.err.notToken"), "antelope/bad-asset");
    return knownTokens(ctx.network.id).find((t) => t.contract === contract && t.symbol === symbol) ?? { contract, symbol, precision: asset.decimals, key: asset.key, name: asset.name };
  }

  async function buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
    const to = p.to.trim();
    if (!isAccountName(to)) throw new ClipError(msg("bg.antelope.err.badAccount"), "antelope/bad-address");
    if (!/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "antelope/bad-amount");
    const from = await firstAccount(ctx);
    if (to === from) throw new ClipError("That's your own account.", "antelope/self-transfer");
    const token = tokenOf(p.asset, ctx);
    const rpc = rpcFor(ctx);
    if ((await rpc.account(to)) === null) throw new ClipError(msg("bg.antelope.noRecipient", { to }), "antelope/bad-recipient");
    const held = await rpc.balance(token.contract, from, token.symbol);
    const have = held ? parseAsset(held) : null;
    const precision = have?.symbol.precision ?? token.precision;
    const amount = BigInt(p.amount);
    if (!have || have.amount < amount) throw new ClipError(msg("bg.err.notEnough", { symbol: token.symbol }), "antelope/insufficient-token");
    const quantity = formatAsset({ amount, symbol: { precision, code: token.symbol } });
    const data = hex(encodeActionData(TOKEN_ABI, "transfer", { from, to, quantity, memo: "" }));
    const h = await header(rpc, {});
    const transaction: TransactionJson = {
      ...h,
      max_net_usage_words: 0,
      max_cpu_usage_ms: 0,
      delay_sec: 0,
      context_free_actions: [],
      actions: [{ account: token.contract, name: "transfer", authorization: [{ actor: from, permission: "active" }], data }],
      transaction_extensions: [],
    };
    return {
      id: randomId(),
      origin: WALLET_ORIGIN,
      via: "injected",
      family: "antelope",
      networkId: ctx.network.id,
      method: ANTELOPE_METHODS.signAndPushTransaction,
      params: { transaction, account: from },
    };
  }

  return {
    family: "antelope",
    curve: "secp256k1",
    /** SLIP-44 194 (EOS/Vaulta), as TokenPocket: one K1 key for Vaulta, Telos and XPR Network. */
    derivationPath: (index: number) => `m/44'/194'/0'/0/${index}`,
    /** The account's key as "PUB_K1_…" (accounts are names on chain that point at it: receiveAddress). */
    addressFromPublicKey: (publicKey: Uint8Array, _network: Network) => publicKeyString(publicKey),
    /** An account name (what you send to). Keys aren't addresses on Antelope. */
    isAddress: (value: string) => isAccountName(value.trim()),
    /** A name can exist on any Antelope network (and mean different owners on each). */
    networksForAddress: (value: string, candidates: Network[]) => (isAccountName(value.trim()) ? candidates.filter((c) => c.family === "antelope") : []),
    receiveAddress: firstAccount,
    accounts,
    getBalances,
    getNfts,
    decode,
    prepare,
    finalize,
    buildTransfer,
    normalize,
  };
}

/** The vault's recovery id must recover the account key (it becomes the SIG_K1 recovery byte). */
function recoversTo(rs: Uint8Array, recovery: number, digest: Uint8Array, pub: Uint8Array): boolean {
  try {
    const rec = new Uint8Array(65);
    rec[0] = recovery;
    rec.set(rs, 1);
    const key = secp256k1.recoverPublicKey(rec, digest, { prehash: false });
    return hex(key) === hex(pub);
  } catch {
    return false;
  }
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
}

function randomId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return hex(b);
}
