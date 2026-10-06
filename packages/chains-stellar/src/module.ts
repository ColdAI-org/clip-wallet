import { type AssetRef, type ChainContext, type ChainModule, ClipError, type DappRequest, type DecodedRequest, type Network, type Nft, type Signature, type SignablePayload, type TokenBalance, type Warning, msg, titled, say, type Msg } from "@clip-wallet/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  Account,
  Asset,
  FeeBumpTransaction,
  Operation,
  StrKey,
  type Transaction,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-base";
import { type Described, type DescribeContext, MIN_CREATE_ACCOUNT_STROOPS, type TokenMeta, describeInvocation, describeTransaction, isSorobanTx } from "./describe.js";
import { Horizon, type HorizonAccount, HorizonError, plainStellarError } from "./horizon.js";
import { STELLAR_HORIZON, STELLAR_SOROBAN_RPC, classicAsset, netOf, networkPassphrase, sep41Asset, toStellarAsset, xlmAsset } from "./networks.js";
import { RpcError, SorobanRpc } from "./rpc.js";
import { asBytes, b64decode, b64encode, baseAccount, concat, formatUnits, fromStroops, hex, hostOf, isContract, randomId, short, utf8 } from "./util.js";

/**
 * WalletConnect `stellar` namespace methods (Reown RPC reference + stellar-wallets-kit's WalletConnect module).
 * The injected (SEP-43) provider maps signTransaction / signAuthEntry / signMessage onto the same names.
 */
export const STELLAR_METHODS = {
  signXDR: "stellar_signXDR",
  signAndSubmitXDR: "stellar_signAndSubmitXDR",
  signAuthEntry: "stellar_signAuthEntry",
  signMessage: "stellar_signMessage",
} as const;

/** SEP-53 prefix. */
export const SIGN_MESSAGE_PREFIX = "Stellar Signed Message:\n";

export interface StellarModuleOptions {
  /** Horizon override (one URL, or per NetworkId). Default: the network's rpcUrls[0]. */
  horizonUrl?: string | Record<string, string>;
  /** Soroban RPC (one URL, or per NetworkId). Default: SDF's testnet RPC; none on pubnet unless set. */
  sorobanRpcUrl?: string | Record<string, string>;
  /** Simulate Soroban calls in decode() (default true). */
  simulate?: boolean;
  /** Soroban submission: getTransaction polls (default 10) and the wait between them (default 1000 ms). */
  pollAttempts?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Clock for time bounds (ms). */
  now?: () => number;
  /** buildTransfer / buildAddAsset validity window (default 300 s). */
  txTimeoutSeconds?: number;
}

export type Normalized =
  | { kind: "tx"; submit: boolean; envelope: string; tx: Transaction | FeeBumpTransaction; passphrase: string }
  | { kind: "auth"; raw: Uint8Array; preimage: xdr.HashIdPreimageSorobanAuthorization; passphrase: string }
  | { kind: "message"; message: string };

function bad(what: string): ClipError {
  return new ClipError(`This request is missing its ${what}.`, "stellar/bad-params");
}

function passphraseFor(request: DappRequest): string {
  if (!netOf(request.networkId)) throw new ClipError("This isn't a Stellar network Clip Wallet knows.", "stellar/unknown-network");
  return networkPassphrase(request.networkId);
}

/** Checks the request's params and parses them. */
export function normalize(request: DappRequest, me: string): Normalized {
  const passphrase = passphraseFor(request);
  const p = (request.params ?? {}) as Record<string, unknown>;
  if (typeof p.address === "string" && p.address && baseAccount(p.address) !== me) {
    throw new ClipError("This request is for a different account than the one you connected.", "stellar/wrong-account");
  }
  if (typeof p.networkPassphrase === "string" && p.networkPassphrase && p.networkPassphrase !== passphrase) {
    throw new ClipError("This app is asking for a different Stellar network than the one it's connected to.", "stellar/network-mismatch");
  }
  switch (request.method) {
    case STELLAR_METHODS.signXDR:
    case STELLAR_METHODS.signAndSubmitXDR: {
      if (typeof p.xdr !== "string" || !p.xdr) throw bad("transaction");
      let tx: Transaction | FeeBumpTransaction;
      try {
        tx = TransactionBuilder.fromXDR(p.xdr, passphrase);
      } catch (cause) {
        throw new ClipError("This transaction can't be read.", "stellar/bad-transaction", cause);
      }
      return { kind: "tx", submit: request.method === STELLAR_METHODS.signAndSubmitXDR || p.submit === true, envelope: p.xdr, tx, passphrase };
    }
    case STELLAR_METHODS.signAuthEntry: {
      const entry = typeof p.authEntry === "string" ? p.authEntry : typeof p.entryXdr === "string" ? p.entryXdr : null;
      if (!entry) throw bad("authorization");
      let raw: Uint8Array;
      let preimage: xdr.HashIdPreimage;
      try {
        raw = b64decode(entry);
        preimage = xdr.HashIdPreimage.fromXDR(entry, "base64");
      } catch (cause) {
        throw new ClipError("This authorization can't be read.", "stellar/bad-auth-entry", cause);
      }
      if (preimage.switch().name !== "envelopeTypeSorobanAuthorization") {
        throw new ClipError("This authorization can't be read.", "stellar/bad-auth-entry");
      }
      const auth = preimage.sorobanAuthorization();
      if (hex(asBytes(auth.networkId())) !== hex(sha256(utf8(passphrase)))) {
        throw new ClipError("This approval is for a different Stellar network than the one this app is connected to. Clip Wallet won't sign it.", "stellar/network-mismatch");
      }
      return { kind: "auth", raw, preimage: auth, passphrase };
    }
    case STELLAR_METHODS.signMessage: {
      if (typeof p.message !== "string") throw bad("message");
      return { kind: "message", message: p.message };
    }
    default:
      throw new ClipError("Clip Wallet doesn't support this Stellar request yet.", "stellar/unsupported-method");
  }
}

/** SEP-53: sha256("Stellar Signed Message:\n" || utf8(message)). */
export function messageHash(message: string | Uint8Array): Uint8Array {
  return sha256(concat(utf8(SIGN_MESSAGE_PREFIX), typeof message === "string" ? utf8(message) : message));
}

/** Transaction signature payload: networkId (sha256 passphrase) || envelope type || tx XDR. */
export function signaturePayload(tx: Transaction | FeeBumpTransaction): Uint8Array {
  return asBytes(tx.signatureBase());
}

/** The bytes a Stellar ed25519 signature covers: sha256 of the signature payload (= tx.hash()). */
export function transactionHash(tx: Transaction | FeeBumpTransaction): Uint8Array {
  return sha256(signaturePayload(tx));
}

function needsMe(tx: Transaction, me: string): boolean {
  return baseAccount(tx.source) === me || tx.operations.some((o) => o.source && baseAccount(o.source) === me);
}

/** Which envelope (if any) this account signs. */
function txSigning(tx: Transaction | FeeBumpTransaction, me: string): "outer" | null {
  if (tx instanceof FeeBumpTransaction) {
    if (baseAccount(tx.feeSource) === me) return "outer";
    if (needsMe(tx.innerTransaction, me)) {
      throw new ClipError("This fee-bump wraps a transaction that needs your signature first. Ask the app to send that transaction instead.", "stellar/fee-bump-inner");
    }
    return null;
  }
  return needsMe(tx, me) ? "outer" : null;
}

function signable(n: Normalized, me: string): Uint8Array | null {
  if (n.kind === "tx") return txSigning(n.tx, me) ? transactionHash(n.tx) : null;
  if (n.kind === "auth") return sha256(n.raw);
  return messageHash(n.message);
}

function textOf(s: string): boolean {
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s);
}

/** Token-interface (SEP-41) and SAC functions that move, approve or destroy assets. */
const ASSET_MOVING_FUNCTIONS = new Set(["transfer", "transfer_from", "approve", "burn", "burn_from", "clawback", "mint", "set_admin", "swap", "withdraw", "deposit"]);
/** An auth entry valid for more than about a day (17,280 ledgers of ~5 s) gets a caution. */
const LONG_AUTH_LEDGERS = 17_280;

/** Function names in an authorized invocation tree ("" for a contract creation). */
function invokedFunctions(inv: xdr.SorobanAuthorizedInvocation): string[] {
  const f = inv.function();
  const name = f.switch().name === "sorobanAuthorizedFunctionTypeContractFn" ? f.contractFn().functionName().toString() : "";
  return [name, ...inv.subInvocations().flatMap((s) => invokedFunctions(s))];
}

export interface StellarModule extends ChainModule {
  normalize: typeof normalize;
  /** XLM you can spend: balance − minimum balance ((2 + subentries + sponsoring − sponsored) × base reserve) − selling liabilities. */
  spendable(ctx: ChainContext): Promise<string>;
  buildAddAsset(p: { asset: AssetRef | { code: string; issuer: string } }, ctx: ChainContext): Promise<DappRequest>;
  buildRemoveAsset(p: { asset: AssetRef | { code: string; issuer: string } }, ctx: ChainContext): Promise<DappRequest>;
}

export function createStellarModule(options: StellarModuleOptions = {}): StellarModule {
  const metaCache = new Map<string, TokenMeta | null>();
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => Date.now());
  const timeout = options.txTimeoutSeconds ?? 300;

  function pick(v: string | Record<string, string> | undefined, networkId: string): string | undefined {
    return typeof v === "string" ? v : v?.[networkId];
  }

  function horizonFor(ctx: ChainContext): Horizon {
    const n = netOf(ctx.network.id);
    const url = pick(options.horizonUrl, ctx.network.id) ?? ctx.network.rpcUrls[0] ?? (n ? STELLAR_HORIZON[n] : undefined);
    if (!url) throw new ClipError("No Stellar connection is set up for this network.", "stellar/no-horizon");
    return new Horizon(url, ctx.fetch);
  }

  function rpcFor(ctx: ChainContext): SorobanRpc | null {
    const n = netOf(ctx.network.id);
    const url = pick(options.sorobanRpcUrl, ctx.network.id) ?? (n ? STELLAR_SOROBAN_RPC[n] : undefined);
    return url ? new SorobanRpc(url, ctx.fetch) : null;
  }

  async function tokenMeta(contract: string, ctx: ChainContext): Promise<TokenMeta | null> {
    const key = `${ctx.network.id}:${contract}`;
    if (metaCache.has(key)) return metaCache.get(key) ?? null;
    const rpc = rpcFor(ctx);
    if (!rpc) return null;
    const call = async (fn: string) => {
      const tx = new TransactionBuilder(new Account(ctx.account.address, "0"), { fee: "100", networkPassphrase: networkPassphrase(ctx.network.id) })
        .addOperation(Operation.invokeContractFunction({ contract, function: fn, args: [] }))
        .setTimeout(0)
        .build();
      const sim = await rpc.simulate(tx.toXDR());
      const r = sim.results?.[0]?.xdr;
      if (sim.error || !r) throw new Error(sim.error ?? "no result");
      return scValToNative(xdr.ScVal.fromXDR(r, "base64")) as unknown;
    };
    let meta: TokenMeta | null = null;
    try {
      const decimals = Number(await call("decimals"));
      const symbol = String(await call("symbol"));
      const name = await call("name").then(String).catch(() => symbol);
      if (Number.isInteger(decimals) && decimals >= 0 && decimals <= 38) meta = { decimals, symbol, name };
    } catch {
      meta = null;
    }
    metaCache.set(key, meta);
    return meta;
  }

  function describeCtx(ctx: ChainContext): DescribeContext {
    return {
      networkId: ctx.network.id,
      passphrase: networkPassphrase(ctx.network.id),
      me: ctx.account.address,
      horizon: horizonFor(ctx),
      rpc: rpcFor(ctx),
      simulate: options.simulate ?? true,
      tokenMeta: (c) => tokenMeta(c, ctx),
    };
  }

  async function decode(request: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
    const me = ctx.account.address;
    const n = normalize(request, me);
    const base = { requestId: request.id, networkId: request.networkId };
    const host = hostOf(request.origin);

    if (n.kind === "tx") {
      if (!txSigning(n.tx, me)) throw new ClipError("This transaction doesn't need your signature.", "stellar/not-a-signer");
      const d: Described = await describeTransaction(n.tx, describeCtx(ctx));
      const xlm = xlmAsset(ctx.network.id);
      const lines = [...d.lines, { label: "Network fee", value: `up to ${formatUnits(d.fee, 7)} XLM` }];
      if (!n.submit) lines.push({ label: "Sent by", value: `${host} (it gets the signed transaction)` });
      return { ...base, title: d.title, ...msgOf(d), lines, balanceChanges: d.balanceChanges, fee: { asset: xlm, amount: d.fee.toString() }, simulated: d.simulated, blind: d.blind, warnings: d.warnings };
    }

    if (n.kind === "auth") {
      const lines = describeInvocation(n.preimage.invocation());
      const exp = n.preimage.signatureExpirationLedger();
      let until = `ledger ${exp}`;
      const rpc = rpcFor(ctx);
      let latestSeq: number | null = null;
      if (rpc) {
        const latest = await rpc.latestLedger().catch(() => null);
        latestSeq = latest?.sequence ?? null;
        if (latest && exp > latest.sequence) until += ` (about ${Math.max(1, Math.round(((exp - latest.sequence) * 5) / 60))} min from now)`;
      }
      lines.push({ label: "Valid until", value: until }, { label: "Nonce", value: n.preimage.nonce().toString() });
      // Audit CHAIN-L: an auth entry lets whoever submits it run this call tree as you until it expires, and nothing
      // is previewed, so it always carries a warning (danger when the tree can move or approve assets).
      const warnings: Warning[] = [];
      const fns = invokedFunctions(n.preimage.invocation());
      const movesAssets = fns.some((f) => ASSET_MOVING_FUNCTIONS.has(f)) || fns.includes("");
      warnings.push(
        movesAssets
          ? {
              level: "danger",
              code: "unknown-call",
              message: `This lets ${host} (or whoever it hands it to) move or approve assets from your account through ${fns.filter(Boolean).join(", ") || "a new contract"}, until it expires. Clip Wallet can't preview the result. Only sign it if you trust ${host}.`,
            }
          : {
              level: "caution",
              code: "unknown-call",
              message: `This lets ${host} (or whoever it hands it to) run the contract calls above as you until it expires. Clip Wallet can't preview the result.`,
            },
      );
      if (latestSeq !== null && exp <= latestSeq) {
        warnings.push({ level: "caution", code: "unknown-call", message: "This approval has already expired, so it can't be used. The app may be misconfigured." });
      } else if (latestSeq !== null && exp - latestSeq > LONG_AUTH_LEDGERS) {
        warnings.push({ level: "caution", code: "unknown-call", message: `This approval stays valid for a long time (about ${Math.round(((exp - latestSeq) * 5) / 86400)} days). Apps usually need only minutes.` });
      }
      const root = n.preimage.invocation().function();
      let title = say("bg.req.contractActionFor", { host });
      if (root.switch().name === "sorobanAuthorizedFunctionTypeContractFn") {
        const c = root.contractFn();
        const fn = c.functionName().toString();
        title = say("bg.req.approveFnOnContract", { fn, contract: short(StrKey.encodeContract(c.contractAddress().contractId() as never)) });
      }
      return { ...base, title, lines, balanceChanges: [], simulated: false, blind: false, warnings };
    }

    const readable = textOf(n.message);
    const warnings: Warning[] = readable ? [] : [{ level: "danger", code: "blind-signing", message: "This message isn't readable text. Only sign it if you trust the app." }];
    return {
      ...base,
      ...titled(msg("bg.req.signMessage", { host })),
      lines: [{ label: "Message", value: readable ? n.message : JSON.stringify(n.message) }],
      balanceChanges: [],
      simulated: false,
      blind: !readable,
      warnings,
    };
  }

  async function prepare(request: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
    const bytes = signable(normalize(request, ctx.account.address), ctx.account.address);
    if (!bytes) throw new ClipError("This transaction doesn't need your signature.", "stellar/not-a-signer");
    return [{ accountId: ctx.account.id, scheme: "ed25519", bytes, approvalId }];
  }

  async function finalize(request: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown> {
    const me = ctx.account.address;
    const n = normalize(request, me);
    const bytes = signable(n, me);
    if (!bytes) throw new ClipError("This transaction doesn't need your signature.", "stellar/not-a-signer");
    const sig = signatures[0];
    const pub = asBytes(StrKey.decodeEd25519PublicKey(me));
    if (!sig || sig.scheme !== "ed25519" || sig.bytes.length !== 64 || !ed25519.verify(sig.bytes, bytes, pub)) {
      throw new ClipError("The signature didn't match. Nothing was sent.", "stellar/bad-signature");
    }
    const sigB64 = b64encode(sig.bytes);

    if (n.kind === "message") return { signedMessage: sigB64, signature: sigB64, signerAddress: me };
    if (n.kind === "auth") return { signedAuthEntry: sigB64, signerAddress: me };

    n.tx.addDecoratedSignature(new xdr.DecoratedSignature({ hint: pub.slice(28) as never, signature: sig.bytes as never }));
    const signedXDR = n.tx.toEnvelope().toXDR("base64");
    if (!n.submit) return { signedXDR, signedTxXdr: signedXDR, signerAddress: me };
    const hash = hex(transactionHash(n.tx));
    const status = await submit(signedXDR, isSorobanTx(n.tx), ctx);
    return { status, hash, signedXDR, signedTxXdr: signedXDR };
  }

  async function submit(envelope: string, soroban: boolean, ctx: ChainContext): Promise<"success" | "pending"> {
    const rpc = soroban ? rpcFor(ctx) : null;
    if (!rpc) return (await horizonFor(ctx).submit(envelope)) ? "success" : "pending";
    let sent;
    try {
      sent = await rpc.send(envelope);
    } catch (e) {
      if (e instanceof ClipError) throw e;
      throw new ClipError("Stellar couldn't take this transaction right now. Nothing was sent. Try again.", "stellar/submit-failed", e);
    }
    if (sent.status === "ERROR") throw new ClipError(plainStellarError(resultCode(sent.errorResultXdr)), "stellar/submit-failed", sent);
    if (sent.status === "TRY_AGAIN_LATER") throw new ClipError("The network is busy. Nothing was sent. Try again in a moment.", "stellar/busy");
    const attempts = options.pollAttempts ?? 10;
    for (let i = 0; i < attempts; i++) {
      await sleep(options.pollIntervalMs ?? 1000);
      const r = await rpc.getTransaction(sent.hash).catch(() => null);
      if (r?.status === "SUCCESS") return "success";
      if (r?.status === "FAILED") {
        const code = resultCode(r.resultXdr);
        throw new ClipError(
          code === "tx_failed" ? "The smart contract call failed. Only the network fee was spent." : plainStellarError(code),
          "stellar/transaction-failed",
          r,
        );
      }
    }
    return "pending";
  }

  async function getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
    const acct = await horizonFor(ctx).account(ctx.account.address);
    const xlm = xlmAsset(ctx.network.id);
    if (!acct) return [{ asset: xlm, amount: "0" }];
    const out: TokenBalance[] = [];
    for (const b of acct.balances) {
      if (b.asset_type === "native") out.unshift({ asset: xlm, amount: toBase(b.balance) });
      else if ((b.asset_type === "credit_alphanum4" || b.asset_type === "credit_alphanum12") && b.asset_code && b.asset_issuer) {
        out.push({ asset: classicAsset(ctx.network.id, b.asset_code, b.asset_issuer), amount: toBase(b.balance) });
      }
      // liquidity_pool_shares: not a token balance; skipped.
    }
    if (!out.some((b) => b.asset.key === "xlm")) out.unshift({ asset: xlm, amount: "0" });
    return out;
  }

  async function minimumBalance(acct: HorizonAccount, h: Horizon): Promise<bigint> {
    const reserve = await h.baseReserve();
    const entries = 2n + BigInt(acct.subentry_count) + BigInt(acct.num_sponsoring ?? 0) - BigInt(acct.num_sponsored ?? 0);
    return entries * reserve;
  }

  async function spendableOf(acct: HorizonAccount, h: Horizon): Promise<bigint> {
    const native = acct.balances.find((b) => b.asset_type === "native");
    if (!native) return 0n;
    const v = BigInt(toBase(native.balance)) - BigInt(toBase(native.selling_liabilities ?? "0")) - (await minimumBalance(acct, h));
    return v > 0n ? v : 0n;
  }

  async function spendable(ctx: ChainContext): Promise<string> {
    const h = horizonFor(ctx);
    const acct = await h.account(ctx.account.address);
    return acct ? (await spendableOf(acct, h)).toString() : "0";
  }

  async function baseFee(h: Horizon): Promise<bigint> {
    const s = await h.feeStats();
    const base = BigInt(s?.last_ledger_base_fee ?? "100");
    const p50 = BigInt(s?.fee_charged?.p50 ?? "100");
    const fee = p50 > base ? p50 : base;
    return fee > 100_000n ? 100_000n : fee; // cap 0.01 XLM per operation; you pay at most what the ledger charges
  }

  async function loadMe(h: Horizon, ctx: ChainContext): Promise<HorizonAccount> {
    const acct = await h.account(ctx.account.address);
    if (!acct) throw new ClipError("Your Stellar account isn't open yet. Receive at least 1 XLM to open it.", "stellar/not-activated");
    return acct;
  }

  function request(ctx: ChainContext, envelope: string): DappRequest {
    return {
      id: randomId(),
      origin: "clip-wallet",
      via: "injected",
      family: "stellar",
      networkId: ctx.network.id,
      method: STELLAR_METHODS.signAndSubmitXDR,
      params: { xdr: envelope, networkPassphrase: networkPassphrase(ctx.network.id), address: ctx.account.address },
    };
  }

  function builder(acct: HorizonAccount, fee: bigint, ctx: ChainContext, sorobanData?: string): TransactionBuilder {
    const t = Math.floor(now() / 1000);
    return new TransactionBuilder(new Account(acct.id, acct.sequence), {
      fee: fee.toString(),
      networkPassphrase: networkPassphrase(ctx.network.id),
      timebounds: { minTime: 0, maxTime: t + timeout },
      ...(sorobanData ? { sorobanData } : {}),
    });
  }

  async function buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
    const me = ctx.account.address;
    const to = p.to.trim();
    if (isContract(to)) throw new ClipError("That's a smart contract address. Sending to contracts isn't supported yet.", "stellar/contract-recipient");
    const toG = baseAccount(to);
    if (!toG) throw new ClipError("That doesn't look like a Stellar address.", "stellar/bad-address");
    if (toG === me) throw new ClipError("That's your own address.", "stellar/self-transfer");
    if (!/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "stellar/bad-amount");
    const amount = BigInt(p.amount);
    const h = horizonFor(ctx);
    const mine = await loadMe(h, ctx);
    const fee = await baseFee(h);

    if (p.asset.address && isContract(p.asset.address)) return buildTokenTransfer(p.asset.address, to, amount, mine, fee, ctx);

    const asset = toStellarAsset(p.asset);
    const dest = await h.account(toG);
    let op: xdr.Operation;
    if (asset.isNative()) {
      const free = await spendableOf(mine, h);
      if (amount + fee > free) throw new ClipError("You don't have enough XLM. Your account must keep a small minimum balance.", "stellar/insufficient-balance");
      if (dest) op = Operation.payment({ destination: to, asset, amount: fromStroops(amount) });
      else {
        if (to !== toG) throw new ClipError("That account isn't open yet, and a sub-account address can't open it. Ask for their main address.", "stellar/muxed-unfunded");
        if (amount < MIN_CREATE_ACCOUNT_STROOPS) throw new ClipError("This also opens their Stellar account; it needs at least 1 XLM.", "stellar/below-minimum");
        op = Operation.createAccount({ destination: to, startingBalance: fromStroops(amount) });
      }
    } else {
      const code = asset.getCode();
      const issuer = asset.getIssuer();
      const held = mine.balances.find((b) => b.asset_code === code && b.asset_issuer === issuer);
      if (!held || BigInt(toBase(held.balance)) < amount) throw new ClipError(msg("bg.err.notEnough", { symbol: code }), "stellar/insufficient-token");
      if (!dest) throw new ClipError(`That Stellar account isn't open yet. They need to open it and add ${code} before they can receive it.`, "stellar/no-destination");
      if (toG !== issuer && !dest.balances.some((b) => b.asset_code === code && b.asset_issuer === issuer)) {
        throw new ClipError(`They need to add ${code} to their Stellar account before they can receive it.`, "stellar/no-trustline");
      }
      op = Operation.payment({ destination: to, asset, amount: fromStroops(amount) });
    }
    const tx = builder(mine, fee, ctx).addOperation(op).build();
    return request(ctx, tx.toXDR());
  }

  async function buildTokenTransfer(contract: string, to: string, amount: bigint, mine: HorizonAccount, fee: bigint, ctx: ChainContext): Promise<DappRequest> {
    const rpc = rpcFor(ctx);
    if (!rpc) throw new ClipError("Sending this token needs a smart contract connection that isn't set up.", "stellar/no-rpc");
    const args = [nativeToScVal(ctx.account.address, { type: "address" }), nativeToScVal(to, { type: "address" }), nativeToScVal(amount, { type: "i128" })];
    const raw = builder(mine, fee, ctx).addOperation(Operation.invokeContractFunction({ contract, function: "transfer", args })).build();
    let sim;
    try {
      sim = await rpc.simulate(raw.toXDR());
    } catch (cause) {
      throw new ClipError("Couldn't prepare this token transfer. Try again.", "stellar/simulation-failed", cause);
    }
    if (sim.error || !sim.transactionData || !sim.minResourceFee) {
      throw new ClipError("This token transfer fails in a test run. Check your balance and try again.", "stellar/simulation-failed", sim.error);
    }
    const auth = (sim.results?.[0]?.auth ?? []).map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, "base64"));
    const tx = builder(mine, fee + BigInt(sim.minResourceFee), ctx, sim.transactionData)
      .addOperation(Operation.invokeContractFunction({ contract, function: "transfer", args, auth }))
      .build();
    return request(ctx, tx.toXDR());
  }

  async function changeTrust(asset: Asset, limit: string | undefined, ctx: ChainContext): Promise<DappRequest> {
    const h = horizonFor(ctx);
    const mine = await loadMe(h, ctx);
    const fee = await baseFee(h);
    const held = mine.balances.find((b) => b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer());
    if (limit === "0") {
      if (!held) throw new ClipError(`${asset.getCode()} isn't added to your account.`, "stellar/no-trustline");
      if (BigInt(toBase(held.balance)) > 0n) throw new ClipError(`Send or sell all your ${asset.getCode()} before removing it.`, "stellar/trustline-not-empty");
    } else {
      if (held) throw new ClipError(`${asset.getCode()} is already added to your account.`, "stellar/already-added");
      const free = await spendableOf(mine, h);
      if (free < (await h.baseReserve()) + fee) {
        throw new ClipError(`You need at least 0.5 XLM free to add ${asset.getCode()}.`, "stellar/low-reserve");
      }
    }
    const tx = builder(mine, fee, ctx)
      .addOperation(Operation.changeTrust({ asset, ...(limit !== undefined ? { limit } : {}) }))
      .build();
    return request(ctx, tx.toXDR());
  }

  function classic(a: AssetRef | { code: string; issuer: string }): Asset {
    let asset: Asset;
    try {
      asset = toStellarAsset("key" in a ? a : { code: a.code, issuer: a.issuer });
    } catch {
      throw new ClipError("That isn't a Stellar asset that can be added.", "stellar/bad-asset");
    }
    if (asset.isNative()) throw new ClipError("XLM is always in your account.", "stellar/bad-asset");
    return asset;
  }

  async function getNfts(): Promise<Nft[]> {
    // Stellar has no single NFT standard (SEP-50 for Soroban NFTs is a draft). Nothing to list yet.
    return [];
  }

  return {
    family: "stellar",
    curve: "ed25519",
    /** SEP-0005: m/44'/148'/x' (all hardened, SLIP-10 ed25519). */
    derivationPath: (index: number) => `m/44'/148'/${index}'`,
    addressFromPublicKey(publicKey: Uint8Array, _network: Network): string {
      if (publicKey.length !== 32) throw new Error("ed25519 public key must be 32 bytes");
      return StrKey.encodeEd25519PublicKey(publicKey as never);
    },
    /** G… accounts and M… muxed (sub-)accounts. C… contracts are not payment destinations (see isContractAddress). */
    isAddress: (value: string) => baseAccount(value.trim()) !== null,
    networksForAddress: (value: string, candidates: Network[]) => (baseAccount(value.trim()) ? candidates.filter((c) => c.family === "stellar") : []),
    getBalances,
    getNfts,
    decode,
    prepare,
    finalize,
    buildTransfer,
    normalize,
    spendable,
    buildAddAsset: async (p, ctx) => changeTrust(classic(p.asset), undefined, ctx),
    buildRemoveAsset: async (p, ctx) => changeTrust(classic(p.asset), "0", ctx),
  };
}

/** "12.3400000" → "123400000". */
function toBase(amount: string): string {
  const [w, f = ""] = amount.split(".");
  return (BigInt(w ?? "0") * 10_000_000n + BigInt(f.padEnd(7, "0").slice(0, 7) || "0")).toString();
}

function resultCode(resultXdr?: string): string | undefined {
  if (!resultXdr) return undefined;
  try {
    return xdr.TransactionResult.fromXDR(resultXdr, "base64").result().switch().name;
  } catch {
    return undefined;
  }
}

export function isContractAddress(value: string): boolean {
  return isContract(value.trim());
}

export { HorizonError, RpcError, sep41Asset };

/** The Msg a described title carries (explicit titles keep it through the mapping to a DecodedRequest). */
function msgOf(d: { title: string }): { titleMsg?: Msg } {
  const m = (d as { titleMsg?: Msg }).titleMsg;
  return m ? { titleMsg: m } : {};
}
