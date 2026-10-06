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
  msg,
  say,
} from "@clip-wallet/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { addressOfPublicKey, decodeClassic, decodeXAddress, isClassicAddress } from "./address.js";
import { TX_TYPES, UnsupportedField, derSignature, serializeObject, signingDigest, txHash } from "./codec.js";
import { type DescribeContext, LSF, blindOf, describeTx } from "./describe.js";
import { fromChainId, specFor, tokenAsset, xrpAsset } from "./networks.js";
import { type AccountRoot, type Reserves, type Rpc, XrplRpcError, plainXrplError, rpcFor } from "./rpc.js";
import { decimalToUnits, formatUnits, fromHex, hex, hostOf, isObj, randomId, sleep } from "./util.js";

/**
 * Request methods: XLS-72d (Browser Wallet Standard, https://github.com/XRPLF/XRPL-Standards/discussions/206; types
 * in @xrpl-wallet-standard/core, https://github.com/tequdev/xrpl-wallet-standard). Params are the feature's input
 * minus the WalletAccount object: { tx_json, account: "r…", network: "xrpl:1" | "xrpl:testnet", options? }.
 *  - xrpl:signTransaction → { signed_tx_blob }
 *  - xrpl:signAndSubmitTransaction → { tx_hash, tx_json } (tx_json = the `tx` answer once validated)
 * buildTransfer uses xrpl:signAndSubmitTransaction with WALLET_ORIGIN.
 */
export const XRPL_METHODS = {
  signTransaction: "xrpl:signTransaction",
  signAndSubmitTransaction: "xrpl:signAndSubmitTransaction",
} as const;

export interface XrplModuleOptions {
  /** Delay between `tx` polls after submitting (default 1000 ms). */
  confirmPollMs?: number;
  /** `tx` polls before giving up waiting for validation (default 20; the transaction is already submitted by then). */
  confirmAttempts?: number;
  /** Highest fee autofill will set, in drops (default 100,000 = 0.1 XRP; AccountDelete always pays the owner reserve). */
  maxAutoFeeDrops?: bigint;
}

/** XRP split into the part the reserve locks and the part you can spend (drops). */
export interface XrpSpendable {
  balance: string;
  locked: string;
  spendable: string;
  /** Base reserve and per-object reserve, drops. */
  baseReserve: string;
  ownerReserve: string;
  ownerCount: number;
}

interface Normalized {
  tx: Record<string, unknown>;
  submit: boolean;
  /** The dapp left Sequence / Fee / LastLedgerSequence for the wallet to fill. */
  needsFill: boolean;
}

/** Fields only the signer adds (a request carrying them is already signed, or multi-signed). */
const SIGNED_FIELDS = ["TxnSignature", "Signers"];
/** LastLedgerSequence = current + this many ledgers (~1 minute), as xrpl.js autofill. */
const LEDGER_OFFSET = 20;

function paramsOf(request: DappRequest): { tx_json: Record<string, unknown>; account?: unknown; network?: unknown; options?: Record<string, unknown> } {
  const p = request.params;
  if (!isObj(p) || !isObj(p.tx_json)) throw new ClipError("This request from the app is malformed, so we stopped it.", "xrpl/bad-params");
  return p as { tx_json: Record<string, unknown> };
}

export function normalize(request: DappRequest, ctx: ChainContext): Normalized {
  if (request.method !== XRPL_METHODS.signTransaction && request.method !== XRPL_METHODS.signAndSubmitTransaction) {
    throw new ClipError("Clip Wallet doesn't support this kind of request yet.", "xrpl/unsupported-method");
  }
  const spec = specFor(request.networkId);
  const p = paramsOf(request);
  if (!spec || request.networkId !== ctx.network.id || (p.network !== undefined && fromChainId(String(p.network)) !== ctx.network.id)) {
    throw new ClipError(msg("bg.xrpl.err.wrongNetwork"), "xrpl/network-mismatch");
  }
  if (isObj(p.options) && p.options.multisig) throw new ClipError(msg("bg.xrpl.err.multisig"), "xrpl/unsupported");
  const me = ctx.account.address;
  const named = isObj(p.account) ? p.account.address : p.account;
  const tx: Record<string, unknown> = { ...p.tx_json };
  if (tx.Account === undefined) tx.Account = me;
  if ((named !== undefined && named !== me) || tx.Account !== me) {
    throw new ClipError("This request is for a different account than the one you're using.", "xrpl/wrong-account");
  }
  if (SIGNED_FIELDS.some((k) => tx[k] !== undefined)) throw new ClipError(msg("bg.xrpl.err.alreadySigned"), "xrpl/bad-params");
  const pub = ctx.account.publicKey.toUpperCase();
  if (typeof tx.SigningPubKey === "string" && tx.SigningPubKey !== "" && tx.SigningPubKey.toUpperCase() !== pub) {
    throw new ClipError("This request is for a different account than the one you're using.", "xrpl/wrong-account");
  }
  if (tx.SigningPubKey === "") throw new ClipError(msg("bg.xrpl.err.multisig"), "xrpl/unsupported");
  tx.SigningPubKey = pub;
  // NetworkID must be present above network 1024 and absent at or below it (rippled telREQUIRES_NETWORK_ID /
  // telNETWORK_ID_MAKES_TX_NON_CANONICAL).
  if (tx.NetworkID !== undefined) {
    if (Number(tx.NetworkID) !== spec.networkId) throw new ClipError(msg("bg.xrpl.err.wrongNetwork"), "xrpl/network-mismatch");
    if (spec.networkId <= 1024) delete tx.NetworkID;
  } else if (spec.networkId > 1024) {
    tx.NetworkID = spec.networkId;
  }
  // API v2 spells Payment.Amount "DeliverMax" in JSON; the binary field is Amount.
  if (tx.DeliverMax !== undefined) {
    if (tx.Amount !== undefined && JSON.stringify(tx.Amount) !== JSON.stringify(tx.DeliverMax)) throw new ClipError("This request from the app is malformed, so we stopped it.", "xrpl/bad-params");
    tx.Amount = tx.DeliverMax;
    delete tx.DeliverMax;
  }
  const needsFill = tx.Sequence === undefined || tx.Fee === undefined || tx.LastLedgerSequence === undefined;
  return { tx, submit: request.method === XRPL_METHODS.signAndSubmitTransaction, needsFill };
}

function unsupported(e: unknown): never {
  if (e instanceof UnsupportedField) throw new ClipError(msg("bg.xrpl.err.cantRead", { field: e.field }), "xrpl/unreadable-operation", e);
  throw e;
}

export function createXrplModule(options: XrplModuleOptions = {}): ChainModule & {
  normalize: typeof normalize;
  spendable(ctx: ChainContext): Promise<XrpSpendable>;
  buildTrustLine(p: { asset: AssetRef }, ctx: ChainContext): Promise<DappRequest>;
} {
  const pollMs = options.confirmPollMs ?? 1000;
  const attempts = options.confirmAttempts ?? 20;
  const maxAutoFee = options.maxAutoFeeDrops ?? 100_000n;

  /**
   * The transaction as signed, per request: autofill reads the ledger (sequence, fee, ledger index), so decode,
   * prepare and finalize must all use the one decode filled in, or the signature wouldn't match what was shown.
   */
  const filled = new Map<string, Record<string, unknown>>();
  const remember = (id: string, tx: Record<string, unknown>) => {
    filled.set(id, tx);
    if (filled.size > 64) filled.delete(filled.keys().next().value!);
  };

  async function fill(n: Normalized, rpc: Rpc, account: AccountRoot | null, reserves: Reserves | null): Promise<Record<string, unknown>> {
    const tx = { ...n.tx };
    if (!n.needsFill) return tx;
    if (tx.Sequence === undefined) {
      if (tx.TicketSequence !== undefined) tx.Sequence = 0;
      else if (!account) throw notActivated(reserves);
      else tx.Sequence = account.Sequence;
    }
    if (tx.Fee === undefined || tx.LastLedgerSequence === undefined) {
      const fee = await rpc.fee();
      if (tx.Fee === undefined) {
        if (tx.TransactionType === "AccountDelete") tx.Fee = (reserves ?? (await rpc.reserves())).inc.toString();
        else {
          const want = fee.openLedger > fee.base ? fee.openLedger : fee.base;
          tx.Fee = (want > maxAutoFee ? maxAutoFee : want).toString();
        }
      }
      if (tx.LastLedgerSequence === undefined) tx.LastLedgerSequence = fee.ledger + LEDGER_OFFSET;
    }
    return tx;
  }

  function notActivated(reserves: Reserves | null): ClipError {
    return new ClipError(msg("bg.xrpl.err.notActivated", { reserve: formatUnits(reserves?.base ?? 1_000_000n, 6) }), "xrpl/not-activated");
  }

  async function decode(req: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
    const n = normalize(req, ctx);
    const rpc = rpcFor(ctx);
    const me = ctx.account.address;
    const xrp = xrpAsset(ctx.network.id);
    const [account, reserves] = await Promise.all([rpc.accountInfo(me).catch(() => undefined), rpc.reserves().catch(() => null)]);
    const warnings: Warning[] = [];
    let tx = n.tx;
    try {
      tx = await fill(n, rpc, account ?? null, reserves);
      remember(req.id, tx);
    } catch (e) {
      if (!(e instanceof ClipError)) throw e;
      warnings.push({ level: "danger", code: "simulation-failed", message: e.userMessage, ...(e.msg ? { msg: e.msg } : {}) });
    }
    // A type or field this codec can't serialise can't be signed either: blind, and the reason says so.
    let unreadable: string | null = TX_TYPES[String(tx.TransactionType)] === undefined ? String(tx.TransactionType) : null;
    if (!unreadable) {
      try {
        serializeObject(tx);
      } catch (e) {
        if (!(e instanceof UnsupportedField)) throw e;
        unreadable = e.field;
      }
    }
    if (unreadable) {
      const m = msg("bg.xrpl.err.cantRead", { field: unreadable });
      warnings.push({ level: "danger", code: "blind-signing", message: m.fallback, msg: m });
    }
    if (account && account.Flags & LSF.disableMaster) {
      throw new ClipError(msg("bg.xrpl.err.otherKey"), "xrpl/master-disabled");
    }
    const dc: DescribeContext = { networkId: ctx.network.id, me, rpc, reserves, account: account ?? null };
    const d = unreadable ? blindOf(tx) : await describeTx(tx, dc);
    const fee = typeof tx.Fee === "string" && /^\d+$/.test(tx.Fee) ? BigInt(tx.Fee) : 0n;
    const lines = [...d.lines];
    if (tx.Fee !== undefined) lines.push({ label: "Network fee", value: `${formatUnits(fee, 6)} XRP` });
    if (fee > maxAutoFee && tx.TransactionType !== "AccountDelete") warnings.push({ level: "caution", code: "high-fee", message: say("bg.xrpl.highFee", { fee: `${formatUnits(fee, 6)} XRP` }) });
    if (account && reserves) {
      const locked = reserves.base + reserves.inc * BigInt(account.OwnerCount);
      const out = d.balanceChanges.filter((c) => c.asset.key === "xrp").reduce((s, c) => s - BigInt(c.delta), 0n);
      const balance = BigInt(account.Balance);
      if (tx.TransactionType !== "AccountDelete" && out + fee > 0n && out + fee > balance - locked) {
        warnings.push({ level: "danger", code: "simulation-failed", message: say("bg.xrpl.notEnoughXrp", { reserve: `${formatUnits(locked, 6)} XRP` }) });
      }
    }
    if (!n.submit) lines.push({ label: "Sent by", value: say("bg.xrpl.appSends", { host: hostOf(req.origin) }) });
    return {
      requestId: req.id,
      networkId: req.networkId,
      title: d.title,
      lines,
      balanceChanges: d.balanceChanges,
      ...(tx.Fee !== undefined ? { fee: { asset: xrp, amount: fee.toString() } } : {}),
      simulated: false,
      blind: d.blind,
      warnings: [...d.warnings, ...warnings],
    };
  }

  async function txFor(req: DappRequest, ctx: ChainContext): Promise<Record<string, unknown>> {
    const n = normalize(req, ctx);
    const cached = filled.get(req.id);
    if (cached) return cached;
    if (n.needsFill) {
      const rpc = rpcFor(ctx);
      const tx = await fill(n, rpc, await rpc.accountInfo(ctx.account.address), null);
      remember(req.id, tx);
      return tx;
    }
    return n.tx;
  }

  async function prepare(req: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
    const tx = await txFor(req, ctx);
    let bytes: Uint8Array;
    try {
      bytes = signingDigest(tx);
    } catch (e) {
      unsupported(e);
    }
    return [{ accountId: ctx.account.id, scheme: "ecdsa-secp256k1", bytes, approvalId }];
  }

  async function confirm(rpc: Rpc, hash: string): Promise<Record<string, unknown> | null> {
    let last: Record<string, unknown> | null = null;
    for (let k = 0; k < attempts; k++) {
      try {
        last = await rpc.call<Record<string, unknown>>("tx", { transaction: hash, binary: false, api_version: 2 });
        if (last.validated === true) return last;
      } catch (e) {
        if (!(e instanceof XrplRpcError) || e.error !== "txnNotFound") throw e;
      }
      if (pollMs > 0) await sleep(pollMs);
    }
    return last;
  }

  async function finalize(req: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown> {
    const n = normalize(req, ctx);
    const tx = filled.get(req.id) ?? (n.needsFill ? null : n.tx);
    if (!tx) throw new ClipError("This request expired. Please try again from the app.", "xrpl/not-prepared");
    const sig = signatures[0];
    const digest = signingDigest(tx);
    const pub = fromHex(ctx.account.publicKey);
    if (signatures.length !== 1 || !sig || sig.scheme !== "ecdsa-secp256k1" || sig.bytes.length !== 64 || !secp256k1.verify(sig.bytes, digest, pub, { prehash: false })) {
      throw new ClipError("The signature didn't match. Nothing was sent.", "xrpl/bad-signature");
    }
    const signed = { ...tx, TxnSignature: hex(derSignature(sig.bytes)).toUpperCase() };
    const blob = serializeObject(signed);
    const blobHex = hex(blob).toUpperCase();
    const hash = txHash(blob);
    filled.delete(req.id);
    if (!n.submit) return { signed_tx_blob: blobHex };

    const rpc = rpcFor(ctx);
    let engine: string;
    try {
      const r = await rpc.call<{ engine_result: string; engine_result_message?: string; accepted?: boolean }>("submit", { tx_blob: blobHex });
      engine = r.engine_result;
    } catch (e) {
      if (e instanceof ClipError) throw e;
      throw new ClipError("The network rejected this. Nothing was sent.", "xrpl/send-failed", e);
    }
    // tes/tec/terQUEUED: in the ledger (or queued for it); tem/tef/tel/ter: not applied, nothing sent.
    if (!(engine === "tesSUCCESS" || engine === "terQUEUED" || engine.startsWith("tec"))) {
      throw new ClipError(plainXrplError(engine), "xrpl/send-failed");
    }
    const result = await confirm(rpc, hash);
    const meta = result && isObj(result.meta) ? result.meta : null;
    const code = meta && typeof meta.TransactionResult === "string" ? meta.TransactionResult : null;
    if (result?.validated === true && code && code !== "tesSUCCESS") {
      throw new ClipError(`${plainXrplError(code)} ${say("bg.xrpl.feeCharged")}`, "xrpl/failed");
    }
    return { tx_hash: hash, tx_json: result ?? { hash, validated: false, tx_json: signed } };
  }

  async function spendableOf(rpc: Rpc, me: string): Promise<{ account: AccountRoot | null; reserves: Reserves; balance: bigint; locked: bigint; spendable: bigint }> {
    const [account, reserves] = await Promise.all([rpc.accountInfo(me), rpc.reserves()]);
    const balance = account ? BigInt(account.Balance) : 0n;
    const locked = account ? reserves.base + reserves.inc * BigInt(account.OwnerCount) : 0n;
    return { account, reserves, balance, locked, spendable: balance > locked ? balance - locked : 0n };
  }

  async function getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
    const rpc = rpcFor(ctx);
    const me = ctx.account.address;
    const account = await rpc.accountInfo(me);
    const out: TokenBalance[] = [{ asset: xrpAsset(ctx.network.id), amount: account ? account.Balance : "0" }];
    if (!account) return out;
    for (const l of await rpc.lines(me)) {
      const asset = tokenAsset(ctx.network.id, l.currency, l.account);
      let units: bigint;
      try {
        units = decimalToUnits(l.balance, asset.decimals);
      } catch {
        continue;
      }
      if (units < 0n) continue; // we issued it: an obligation, not a holding
      out.push({ asset, amount: units.toString() });
    }
    return out;
  }

  /** NFTs (XLS-20) need an `Nft.standard` value core doesn't have yet ("xls20"), so none are listed. */
  async function getNfts(_ctx: ChainContext): Promise<Nft[]> {
    return [];
  }

  function parseRecipient(to: string, net: Network): { address: string; tag: number | null } {
    const t = to.trim();
    if (isClassicAddress(t)) return { address: t, tag: null };
    const x = decodeXAddress(t);
    if (x) {
      if (x.test !== net.testnet) throw new ClipError(msg("bg.xrpl.err.xAddressNetwork"), "xrpl/network-mismatch");
      return { address: x.classic, tag: x.tag };
    }
    throw new ClipError(msg("bg.xrpl.err.badAddress"), "xrpl/bad-address");
  }

  function request(ctx: ChainContext, tx: Record<string, unknown>): DappRequest {
    return {
      id: randomId(),
      origin: WALLET_ORIGIN,
      via: "injected",
      family: "xrpl",
      networkId: ctx.network.id,
      method: XRPL_METHODS.signAndSubmitTransaction,
      params: { tx_json: tx, account: ctx.account.address, network: ctx.network.id },
    };
  }

  async function base(rpc: Rpc, ctx: ChainContext, mine: { account: AccountRoot | null; reserves: Reserves }, type: string) {
    if (!mine.account) throw notActivated(mine.reserves);
    if (mine.account.Flags & LSF.disableMaster) throw new ClipError(msg("bg.xrpl.err.otherKey"), "xrpl/master-disabled");
    const fee = await rpc.fee();
    const want = fee.openLedger > fee.base ? fee.openLedger : fee.base;
    return {
      TransactionType: type,
      Account: ctx.account.address,
      Fee: (want > maxAutoFee ? maxAutoFee : want).toString(),
      Sequence: mine.account.Sequence,
      LastLedgerSequence: fee.ledger + LEDGER_OFFSET,
      SigningPubKey: ctx.account.publicKey.toUpperCase(),
      Flags: 0,
    };
  }

  function tokenOf(asset: AssetRef): { currency: string; issuer: string } {
    const [currency, issuer] = (asset.address ?? "").split(".");
    if (!currency || !issuer || !decodeClassic(issuer)) throw new ClipError(msg("bg.xrpl.err.notToken"), "xrpl/bad-asset");
    return { currency, issuer };
  }

  async function buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
    const me = ctx.account.address;
    const { address: to, tag } = parseRecipient(p.to, ctx.network);
    if (to === me) throw new ClipError("That's your own address.", "xrpl/self-transfer");
    if (!/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "xrpl/bad-amount");
    const amount = BigInt(p.amount);
    const rpc = rpcFor(ctx);
    const mine = await spendableOf(rpc, me);
    const tx: Record<string, unknown> = await base(rpc, ctx, mine, "Payment");
    const fee = BigInt(tx.Fee as string);
    const dest = await rpc.accountInfo(to);
    const reserve = formatUnits(mine.reserves.base, 6);
    if (dest && dest.Flags & LSF.requireDestTag && tag === null) throw new ClipError(msg("bg.xrpl.err.tagNeeded"), "xrpl/memo-required");

    if (!p.asset.address) {
      if (amount + fee > mine.spendable) {
        throw new ClipError(msg("bg.xrpl.err.notEnoughXrp", { reserve: formatUnits(mine.locked, 6), fee: formatUnits(fee, 6) }), "xrpl/insufficient-funds");
      }
      if (!dest && amount < mine.reserves.base) throw new ClipError(msg("bg.xrpl.err.newAccount", { reserve }), "xrpl/too-small");
      tx.Destination = to;
      tx.Amount = amount.toString();
    } else {
      const { currency, issuer } = tokenOf(p.asset);
      const ref = tokenAsset(ctx.network.id, currency, issuer);
      const value = formatUnits(amount, ref.decimals);
      if (fee > mine.spendable) throw new ClipError(msg("bg.xrpl.err.feeOnly"), "xrpl/insufficient-funds");
      if (issuer !== me) {
        const held = (await rpc.lines(me, issuer)).find((l) => l.currency.toUpperCase() === currency.toUpperCase());
        if (!held || decimalToUnits(held.balance, ref.decimals) < amount) throw new ClipError(msg("bg.err.notEnough", { symbol: ref.symbol }), "xrpl/insufficient-token");
      }
      if (!dest) throw new ClipError(msg("bg.xrpl.noRecipientAccount"), "xrpl/bad-recipient");
      if (to !== issuer) {
        const theirs = (await rpc.lines(to, issuer)).find((l) => l.currency.toUpperCase() === currency.toUpperCase());
        if (!theirs) throw new ClipError(msg("bg.xrpl.err.noTrustLine", { symbol: ref.symbol }), "xrpl/no-trust-line");
      }
      tx.Destination = to;
      tx.Amount = { currency, issuer, value };
      // An issuer's transfer fee (TransferRate, 1e9 = none) comes out of the sender: allow for it with SendMax.
      if (issuer !== me && to !== issuer) {
        const iss = await rpc.accountInfo(issuer);
        const rate = BigInt((iss as { TransferRate?: number } | null)?.TransferRate ?? 0);
        if (rate > 1_000_000_000n) tx.SendMax = { currency, issuer, value: formatUnits((amount * rate + 999_999_999n) / 1_000_000_000n, ref.decimals) };
      }
    }
    if (tag !== null) tx.DestinationTag = tag;
    return request(ctx, tx);
  }

  /** Adds RLUSD, USDC or another token to the account (TrustSet with a high limit; locks one owner reserve). */
  async function buildTrustLine(p: { asset: AssetRef }, ctx: ChainContext): Promise<DappRequest> {
    const { currency, issuer } = tokenOf(p.asset);
    const rpc = rpcFor(ctx);
    const mine = await spendableOf(rpc, ctx.account.address);
    const tx: Record<string, unknown> = await base(rpc, ctx, mine, "TrustSet");
    if (mine.spendable < mine.reserves.inc + BigInt(tx.Fee as string)) {
      throw new ClipError(msg("bg.xrpl.err.reserveForToken", { amount: formatUnits(mine.reserves.inc, 6) }), "xrpl/insufficient-funds");
    }
    tx.LimitAmount = { currency, issuer, value: "1000000000000" };
    tx.Flags = 0x00020000; // tfSetNoRipple, as wallets set it for holders
    return request(ctx, tx);
  }

  async function spendable(ctx: ChainContext): Promise<XrpSpendable> {
    const s = await spendableOf(rpcFor(ctx), ctx.account.address);
    return {
      balance: s.balance.toString(),
      locked: s.locked.toString(),
      spendable: s.spendable.toString(),
      baseReserve: s.reserves.base.toString(),
      ownerReserve: s.reserves.inc.toString(),
      ownerCount: s.account?.OwnerCount ?? 0,
    };
  }

  return {
    family: "xrpl",
    curve: "secp256k1",
    /** xrpl.js Wallet.fromMnemonic (i = 0), Ledger Live, GemWallet: account i at m/44'/144'/i'/0/0. */
    derivationPath: (index: number) => `m/44'/144'/${index}'/0/0`,
    addressFromPublicKey(publicKey: Uint8Array, _network: Network): string {
      return addressOfPublicKey(publicKey);
    },
    isAddress: (value: string) => isClassicAddress(value.trim()) || decodeXAddress(value.trim()) !== null,
    /** Classic addresses work on every XRPL network; X-addresses say whether they are for mainnet or a test network. */
    networksForAddress(value: string, candidates: Network[]): Network[] {
      const v = value.trim();
      const mine = candidates.filter((c) => c.family === "xrpl");
      if (isClassicAddress(v)) return mine;
      const x = decodeXAddress(v);
      return x ? mine.filter((c) => c.testnet === x.test) : [];
    },
    getBalances,
    getNfts,
    decode,
    prepare,
    finalize,
    buildTransfer,
    buildTrustLine,
    spendable,
    normalize,
  };
}

