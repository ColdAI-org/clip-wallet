import {
  type AssetRef,
  type BalanceChange,
  type ChainContext,
  type ChainModule,
  ClipError,
  type DappRequest,
  type DecodedRequest,
  type Msg,
  type Network,
  type Nft,
  type Signature,
  type SignablePayload,
  type TokenBalance,
  WALLET_ORIGIN,
  isWalletOrigin,
  msg,
} from "@clip-wallet/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { type CashPrefix, PREFIXES, addressOfScript, decodeCashAddress, lockingBytecodeOf, p2pkhAddress, p2pkhScript } from "./cashaddr.js";
import { type Call, type ElectrumBalance, ElectrumError, type ElectrumOptions, type ElectrumUtxo, withElectrum } from "./electrum.js";
import { compactSignatureBase64, messageHash } from "./message.js";
import { BCH_NETS, type BchNet, bchAsset, cashTokenAsset, netOf } from "./networks.js";
import { type BchTx, DUST, type TokenData, decodeTx, encodeTx, estimateSize, p2pkhUnlocking, sighash, txidOf } from "./tx.js";
import { type SourceOutput, parseSourceOutputs, parseTransaction, sourceOutputJson, stringifyExtended } from "./wc.js";
import { bytesEqual, formatUnits, fromHex, hash160, hex, hostOf, randomId, reversed, short, textOf } from "./util.js";

/**
 * Request methods: the BCH WalletConnect spec's (wc2-bch-bcr, https://github.com/mainnet-pat/wc2-bch-bcr), so a
 * WalletConnect session hands them to this module unchanged. Wallet sends use bch_signTransaction too (with
 * `broadcast: true`).
 */
export const BCH_METHODS = {
  signTransaction: "bch_signTransaction",
  signMessage: "bch_signMessage",
  /** Answered by the 1Mask background (the account's address on the session's network), never by this module. */
  getAddresses: "bch_getAddresses",
} as const;

export interface BitcoinCashModuleOptions extends ElectrumOptions {
  /** Electrum (Fulcrum) WebSocket URLs per NetworkId, overriding `network.rpcUrls`. */
  electrumUrls?: Record<string, string[]>;
  /** Minimum fee rate in satoshis per byte (default 1; the network's relay fee if higher). */
  minFeeRate?: number;
}

type Op =
  | { kind: "message"; text: string; prompt?: string }
  | { kind: "tx"; tx: BchTx; sources: SourceOutput[]; broadcast: boolean; prompt?: string }
  | { kind: "unreadable"; reason: unknown };

const obj = (p: unknown): Record<string, unknown> => (p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {});
const fmt = (sats: bigint) => `${formatUnits(sats, 8)} BCH`;

function netName(networkId: string): BchNet {
  const n = netOf(networkId);
  if (!n) throw new ClipError("That network isn't available in this wallet.", "bitcoincash/unknown-network");
  return n;
}

function publicKeyOf(ctx: ChainContext): Uint8Array {
  const raw = fromHex(ctx.account.publicKey);
  return raw.length === 33 ? raw : secp256k1.Point.fromBytes(raw).toBytes(true);
}

/** This account's P2PKH locking bytecode (the same on every network). */
export function ownScript(ctx: ChainContext): Uint8Array {
  return p2pkhScript(hash160(publicKeyOf(ctx)));
}

/** Electrum scripthash: SHA-256 of the locking bytecode, byte-reversed, hex. */
export function scripthash(locking: Uint8Array): string {
  return hex(reversed(sha256(locking)));
}

/** Checks method and network, and parses the request. Unparseable transactions become "unreadable" (blind). */
export function normalize(request: DappRequest, ctx: ChainContext): Op {
  if (!netOf(request.networkId) || request.networkId !== ctx.network.id) {
    throw new ClipError("This app is asking for a different Bitcoin Cash network than the one it's connected to.", "bitcoincash/network-mismatch");
  }
  const p = obj(request.params);
  const prompt = typeof p.userPrompt === "string" && p.userPrompt ? p.userPrompt.slice(0, 200) : undefined;
  if (request.method === BCH_METHODS.signMessage) {
    if (typeof p.message !== "string") throw new ClipError("This request is missing its message.", "bitcoincash/bad-params");
    return { kind: "message", text: p.message, ...(prompt ? { prompt } : {}) };
  }
  if (request.method === BCH_METHODS.signTransaction) {
    try {
      const tx = parseTransaction(p.transaction);
      const sources = parseSourceOutputs(p.sourceOutputs);
      if (sources.length !== tx.inputs.length) throw new Error("source outputs don't match inputs");
      tx.inputs.forEach((i, k) => {
        if (sources[k]!.outpoint !== `${hex(i.txid)}:${i.vout}`) throw new Error("source output order");
      });
      return { kind: "tx", tx, sources, broadcast: p.broadcast !== false, ...(prompt ? { prompt } : {}) };
    } catch (reason) {
      return { kind: "unreadable", reason };
    }
  }
  throw new ClipError("Clip Wallet doesn't support this Bitcoin Cash request yet.", "bitcoincash/unsupported-method");
}

const ZERO33 = new Uint8Array(33);
const ZERO65 = new Uint8Array(65);
function hasPlaceholder(b: Uint8Array): boolean {
  const find = (n: Uint8Array) => {
    outer: for (let i = 0; i + n.length <= b.length; i++) {
      for (let j = 0; j < n.length; j++) if (b[i + j] !== 0) continue outer;
      return true;
    }
    return false;
  };
  return b.length >= 33 && (find(ZERO65) || find(ZERO33));
}

/** Indexes of the inputs this account signs: our P2PKH coin with an empty unlocking bytecode. */
function signingInputs(op: Extract<Op, { kind: "tx" }>, ctx: ChainContext): number[] {
  const mine = ownScript(ctx);
  const out: number[] = [];
  op.tx.inputs.forEach((input, i) => {
    const src = op.sources[i]!;
    if (input.unlocking.length === 0 && bytesEqual(src.locking, mine)) out.push(i);
    else if (input.unlocking.length && hasPlaceholder(input.unlocking)) {
      // wc2-bch-bcr: zero-filled 33/65-byte placeholders ask the wallet to insert its key / a Schnorr signature
      // into a CashScript contract's unlocking data. Not supported: refuse in plain words instead of guessing.
      throw new ClipError(msg("bg.bch.contractPlaceholders"), "bitcoincash/unsupported-contract");
    }
  });
  if (!out.length) throw new ClipError("This transaction doesn't need your signature.", "bitcoincash/not-a-signer");
  return out;
}

function tokenText(t: TokenData): string {
  const cat = hex(t.category);
  const parts = [] as string[];
  if (t.amount > 0n) parts.push(`${t.amount} × CT-${cat.slice(0, 6)}`);
  if (t.nft) parts.push(`NFT CT-${cat.slice(0, 6)}${t.nft.commitment.length ? ` #${hex(t.nft.commitment).slice(0, 16)}` : ""}${t.nft.capability !== "none" ? ` (${t.nft.capability})` : ""}`);
  return parts.join(" + ");
}

export interface BitcoinCashModule extends ChainModule {
  normalize: typeof normalize;
  receiveAddress(ctx: ChainContext): Promise<string>;
  /** Satoshis: confirmed and unconfirmed (may be negative while a spend is unconfirmed). */
  bchBalance(ctx: ChainContext): Promise<{ confirmed: string; unconfirmed: string }>;
}

export function createBitcoinCashModule(options: BitcoinCashModuleOptions = {}): BitcoinCashModule {
  function prefixOf(networkId: string): CashPrefix {
    return BCH_NETS[netName(networkId)].prefix;
  }

  function electrum<T>(ctx: ChainContext, fn: (call: Call) => Promise<T>): Promise<T> {
    const urls = options.electrumUrls?.[ctx.network.id] ?? (ctx.network.rpcUrls.length ? ctx.network.rpcUrls : BCH_NETS[netName(ctx.network.id)].electrum);
    return withElectrum(urls, options, fn);
  }

  function addressOn(ctx: ChainContext): string {
    return p2pkhAddress(publicKeyOf(ctx), prefixOf(ctx.network.id));
  }

  async function feeRate(call: Call): Promise<bigint> {
    const min = BigInt(Math.max(1, Math.ceil(options.minFeeRate ?? 1)));
    const relay = await call<number>("blockchain.relayfee").catch(() => 0);
    // BCH per kB → satoshis per byte (round to whole satoshis first: 0.00001 * 1e8 isn't exactly 1000 in floats).
    const perByte = typeof relay === "number" && relay > 0 ? (BigInt(Math.round(relay * 1e8)) + 999n) / 1000n : 1n;
    return perByte > min ? perByte : min;
  }

  /* ---------------------------------------------------------------- decode */

  function describeTx(req: DappRequest, op: Extract<Op, { kind: "tx" }>, ctx: ChainContext): Omit<DecodedRequest, "requestId" | "networkId" | "simulated" | "blind"> {
    const prefix = prefixOf(ctx.network.id);
    const mine = ownScript(ctx);
    const me = addressOn(ctx);
    const host = hostOf(req.origin);
    const signing = new Set(signingInputs(op, ctx));
    const lines: DecodedRequest["lines"] = [];
    const warnings: DecodedRequest["warnings"] = [];
    const changes: BalanceChange[] = [];

    let inTotal = 0n;
    let ourIn = 0n;
    /** Per token category: fungible amount and NFT count leaving this account (inputs − outputs back to it). */
    const tokensOut = new Map<string, { t: TokenData; n: bigint; nft: number }>();
    op.sources.forEach((s) => {
      inTotal += s.value;
      if (bytesEqual(s.locking, mine)) {
        ourIn += s.value;
        if (s.token) {
          const k = hex(s.token.category);
          const prev = tokensOut.get(k);
          tokensOut.set(k, { t: s.token, n: (prev?.n ?? 0n) + s.token.amount, nft: (prev?.nft ?? 0) + (s.token.nft ? 1 : 0) });
        }
      }
    });

    let outTotal = 0n;
    let ourOut = 0n;
    const external: { to: string; value: bigint; token?: TokenData }[] = [];
    for (const o of op.tx.outputs) {
      outTotal += o.value;
      if (bytesEqual(o.locking, mine)) {
        ourOut += o.value;
        if (o.token) {
          const k = hex(o.token.category);
          const prev = tokensOut.get(k);
          tokensOut.set(k, { t: o.token, n: (prev?.n ?? 0n) - o.token.amount, nft: (prev?.nft ?? 0) - (o.token.nft ? 1 : 0) });
        }
        continue;
      }
      if (o.locking[0] === 0x6a) {
        const text = textOf(o.locking.subarray(o.locking[1]! <= 75 ? 2 : 3));
        lines.push({ label: text ? "Data" : "Data (not text)", value: text || hex(o.locking.subarray(1)).slice(0, 120) });
        continue;
      }
      const to = addressOfScript(o.locking, prefix, !!o.token) ?? `script ${hex(o.locking).slice(0, 40)}…`;
      external.push({ to, value: o.value, ...(o.token ? { token: o.token } : {}) });
    }

    const fee = inTotal - outTotal;
    if (fee < 0n) throw new ClipError("This transaction can't be read.", "bitcoincash/bad-transaction");
    const delta = ourOut - ourIn;
    if (delta !== 0n) changes.push({ asset: bchAsset(ctx.network.id), delta: delta.toString() });
    for (const [k, v] of tokensOut) {
      if (v.n !== 0n) changes.push({ asset: cashTokenAsset(ctx.network.id, k), delta: (-v.n).toString() });
      if (v.n > 0n || v.nft > 0) warnings.push({ level: "caution", code: "inscribed-utxo", ...warn(msg("bg.bch.spendsTokens", { tokens: tokenText({ ...v.t, amount: v.n > 0n ? v.n : 0n }) })) });
    }

    let title: Msg;
    const sent = external.reduce((n, e) => n + e.value, 0n);
    if (external.length === 1 && !external[0]!.token) title = msg("bg.req.sendTo", { amount: fmt(external[0]!.value), to: short(external[0]!.to) });
    else if (external.length === 1) title = msg("bg.req.sendToOnly", { to: short(external[0]!.to) });
    else if (external.length > 1) title = msg("bg.req.sendToMany", { amount: fmt(sent), count: external.length });
    else title = isWalletOrigin(req.origin) ? msg("bg.req.moveBetweenOwn", { symbol: "BCH" }) : msg("bg.req.approveTxFor", { host });

    external.forEach((e, i) => {
      lines.push({ label: i === 0 ? "To" : "Also", value: e.to });
      lines.push({ label: "Amount", value: e.token ? `${fmt(e.value)} + ${tokenText(e.token)}` : fmt(e.value) });
    });
    if (ourOut > 0n && external.length) lines.push({ label: "You get back", value: `${fmt(ourOut)} (${short(me)}, the same address)` });
    lines.push({ label: "Network fee", value: fmt(fee) });
    const size = encodeTx(op.tx).length + signing.size * 107;
    if (fee > BigInt(size) * 20n && fee > 10_000n) warnings.push({ level: "caution", code: "high-fee", ...warn(msg("bg.bch.highFee", { fee: fmt(fee) })) });
    if (op.sources.some((s) => s.contractName)) lines.push({ label: "App contract", value: op.sources.find((s) => s.contractName)!.contractName! });
    if (op.tx.inputs.length > signing.size) {
      const m = msg("bg.bch.othersInputs", { count: op.tx.inputs.length - signing.size });
      lines.push({ label: "Also", value: m.fallback, valueMsg: m });
    }
    if (op.prompt && !isWalletOrigin(req.origin)) lines.push({ label: "App says (unverified)", value: op.prompt });
    if (!op.broadcast) lines.push({ label: "Sent by", value: `${host} (it gets the signed transaction)` });
    return { title: title.fallback, titleMsg: title, lines, balanceChanges: changes, fee: { asset: bchAsset(ctx.network.id), amount: fee.toString() }, warnings };
  }

  async function decode(req: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
    const op = normalize(req, ctx);
    const host = hostOf(req.origin);
    const base = { requestId: req.id, networkId: req.networkId, simulated: false };
    if (op.kind === "message") {
      const title = msg("bg.req.signMessage", { host });
      const lines = [{ label: "Message", value: op.text }];
      if (op.prompt) lines.push({ label: "App says (unverified)", value: op.prompt });
      return { ...base, title: title.fallback, titleMsg: title, lines, balanceChanges: [], blind: false, warnings: [] };
    }
    if (op.kind === "unreadable") {
      const title = msg("bg.req.unreadableFrom", { host });
      return { ...base, title: title.fallback, titleMsg: title, lines: [], balanceChanges: [], blind: true, warnings: [{ level: "danger", code: "blind-signing", message: "Clip Wallet can't read this transaction." }] };
    }
    return { ...base, ...describeTx(req, op, ctx), blind: false };
  }

  /* ---------------------------------------------------------------- sign */

  async function prepare(req: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
    const op = normalize(req, ctx);
    if (op.kind === "message") return [{ accountId: ctx.account.id, scheme: "ecdsa-secp256k1", bytes: messageHash(op.text), approvalId }];
    if (op.kind === "unreadable") throw new ClipError("This transaction can't be read.", "bitcoincash/bad-transaction", op.reason);
    const script = ownScript(ctx);
    return signingInputs(op, ctx).map((i) => ({
      accountId: ctx.account.id,
      scheme: "ecdsa-secp256k1" as const,
      bytes: sighash(op.tx, i, op.sources[i]!, script),
      approvalId,
    }));
  }

  function checkSignature(sig: Signature | undefined, digest: Uint8Array, pub: Uint8Array): { rs: Uint8Array; recovery: number } {
    if (!sig || sig.scheme !== "ecdsa-secp256k1" || sig.bytes.length !== 64) throw new ClipError("The signature didn't match. Nothing was sent.", "bitcoincash/bad-signature");
    let s = secp256k1.Signature.fromBytes(sig.bytes, "compact");
    if (s.hasHighS()) s = new secp256k1.Signature(s.r, secp256k1.Point.CURVE().n - s.s);
    const rs = s.toBytes("compact");
    if (!secp256k1.verify(rs, digest, pub, { prehash: false })) throw new ClipError("The signature didn't match. Nothing was sent.", "bitcoincash/bad-signature");
    for (const rec of [0, 1]) {
      try {
        if (bytesEqual(s.addRecoveryBit(rec).recoverPublicKey(digest).toBytes(true), pub)) return { rs, recovery: rec };
      } catch {
        /* next */
      }
    }
    throw new ClipError("The signature didn't match. Nothing was sent.", "bitcoincash/bad-signature");
  }

  async function finalize(req: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown> {
    const op = normalize(req, ctx);
    const pub = publicKeyOf(ctx);
    if (op.kind === "message") {
      const { rs, recovery } = checkSignature(signatures[0], messageHash(op.text), pub);
      return compactSignatureBase64(rs, recovery);
    }
    if (op.kind === "unreadable") throw new ClipError("This transaction can't be read.", "bitcoincash/bad-transaction", op.reason);
    const idx = signingInputs(op, ctx);
    if (signatures.length !== idx.length) throw new ClipError("Some signatures are missing. Nothing was sent.", "bitcoincash/bad-signature");
    const script = ownScript(ctx);
    const inputs = op.tx.inputs.map((i) => ({ ...i }));
    idx.forEach((i, k) => {
      const { rs } = checkSignature(signatures[k], sighash(op.tx, i, op.sources[i]!, script), pub);
      inputs[i] = { ...inputs[i]!, unlocking: p2pkhUnlocking(rs, pub) };
    });
    const signed: BchTx = { ...op.tx, inputs };
    const raw = encodeTx(signed);
    const txid = hex(txidOf(raw));
    if (!op.broadcast) return { signedTransaction: hex(raw), signedTransactionHash: txid };
    const sent = await electrum(ctx, (call) => call<string>("blockchain.transaction.broadcast", [hex(raw)])).catch((e: unknown) => {
      throw plainBchError(e);
    });
    if (typeof sent === "string" && /^[0-9a-f]{64}$/i.test(sent) && sent.toLowerCase() !== txid) {
      throw new ClipError("Something went wrong. Please try again.", "bitcoincash/txid-mismatch");
    }
    return { signedTransaction: hex(raw), signedTransactionHash: txid };
  }

  /* ---------------------------------------------------------------- balances and sends */

  async function getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
    const sh = scripthash(ownScript(ctx));
    return electrum(ctx, async (call) => {
      const b = await call<ElectrumBalance>("blockchain.scripthash.get_balance", [sh]);
      const out: TokenBalance[] = [{ asset: bchAsset(ctx.network.id), amount: (BigInt(b.confirmed ?? 0) + BigInt(b.unconfirmed ?? 0)).toString() }];
      // CashTokens (fungible part): listunspent already carries token_data, so it's one more call.
      const utxos = await call<ElectrumUtxo[]>("blockchain.scripthash.listunspent", [sh, "include_tokens"]).catch(() => [] as ElectrumUtxo[]);
      const ft = new Map<string, bigint>();
      for (const u of utxos) {
        const t = u.token_data;
        if (!t || !/^[0-9a-f]{64}$/.test(t.category) || !t.amount || !/^\d+$/.test(t.amount)) continue;
        ft.set(t.category, (ft.get(t.category) ?? 0n) + BigInt(t.amount));
      }
      for (const [category, amount] of ft) if (amount > 0n) out.push({ asset: cashTokenAsset(ctx.network.id, category), amount: amount.toString() });
      return out;
    });
  }

  async function bchBalance(ctx: ChainContext) {
    const b = await electrum(ctx, (call) => call<ElectrumBalance>("blockchain.scripthash.get_balance", [scripthash(ownScript(ctx))]));
    return { confirmed: String(b.confirmed ?? 0), unconfirmed: String(b.unconfirmed ?? 0) };
  }

  function recipientScript(to: string, ctx: ChainContext): Uint8Array {
    const prefix = prefixOf(ctx.network.id);
    const a = decodeCashAddress(to, prefix);
    if (!a) throw new ClipError(msg("bg.bch.notCashAddr"), "bitcoincash/bad-address");
    if (a.prefix !== prefix) {
      throw new ClipError(msg(prefix === "bitcoincash" ? "bg.bch.testAddressOnMainnet" : "bg.bch.mainAddressOnTestnet"), "bitcoincash/network-mismatch");
    }
    const script = lockingBytecodeOf(a);
    if (bytesEqual(script, ownScript(ctx))) throw new ClipError("That's your own address.", "bitcoincash/self-transfer");
    return script;
  }

  async function buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
    if (p.asset.address) throw new ClipError(msg("bg.bch.tokenSendUnavailable"), "bitcoincash/unsupported-token");
    const to = recipientScript(p.to, ctx);
    if (!/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "bitcoincash/bad-amount");
    const amount = BigInt(p.amount);
    if (amount < DUST) throw new ClipError(msg("bg.bch.belowDust", { amount: fmt(DUST) }), "bitcoincash/too-small");
    const mine = ownScript(ctx);
    const { utxos, rate } = await electrum(ctx, async (call) => ({
      utxos: await call<ElectrumUtxo[]>("blockchain.scripthash.listunspent", [scripthash(mine), "include_tokens"]),
      rate: await feeRate(call),
    }));
    // Never spend a coin that carries CashTokens in a plain BCH send: the tokens would be burned.
    const coins = utxos
      .filter((u) => !u.token_data && /^[0-9a-f]{64}$/i.test(u.tx_hash) && Number.isSafeInteger(u.value) && u.value > 0)
      .sort((a, b) => b.value - a.value || (a.tx_hash < b.tx_hash ? -1 : 1));
    const picked: ElectrumUtxo[] = [];
    let total = 0n;
    let fee = 0n;
    let change = 0n;
    for (const c of coins) {
      picked.push(c);
      total += BigInt(c.value);
      const withChange = BigInt(estimateSize(picked.length, [{ locking: to }, { locking: mine }])) * rate;
      if (total >= amount + withChange) {
        fee = withChange;
        change = total - amount - fee;
        if (change < DUST) {
          fee = total - amount; // too small to keep: it goes to the fee
          change = 0n;
        }
        break;
      }
    }
    if (!picked.length || total < amount + fee || fee === 0n) {
      throw new ClipError(msg("bg.err.notEnoughForFee", { symbol: "BCH" }), "bitcoincash/insufficient-funds");
    }
    const tx: BchTx = {
      version: 2,
      locktime: 0,
      inputs: picked.map((c) => ({ txid: fromHex(c.tx_hash), vout: c.tx_pos, unlocking: new Uint8Array(), sequence: 0xffffffff })),
      outputs: [{ value: amount, locking: to }, ...(change > 0n ? [{ value: change, locking: mine }] : [])],
    };
    const sources = picked.map((c) => sourceOutputJson(fromHex(c.tx_hash), c.tx_pos, 0xffffffff, mine, BigInt(c.value)));
    return {
      id: randomId(),
      origin: WALLET_ORIGIN,
      via: "injected",
      family: "bitcoincash",
      networkId: ctx.network.id,
      method: BCH_METHODS.signTransaction,
      params: { transaction: hex(encodeTx(tx)), sourceOutputs: stringifyExtended(sources), broadcast: true },
    };
  }

  function prefixesFor(value: string): CashPrefix[] {
    const v = value.trim();
    if (v.includes(":")) {
      const a = decodeCashAddress(v);
      return a ? [a.prefix] : [];
    }
    return PREFIXES.filter((p) => decodeCashAddress(v, p));
  }

  return {
    family: "bitcoincash",
    curve: "secp256k1",
    /** Electron Cash, Paytaca, Cashonize: BIP-44 coin 145, the same key on every network. */
    derivationPath: (index: number) => `m/44'/145'/0'/0/${index}`,
    addressFromPublicKey(publicKey: Uint8Array, network: Network): string {
      const key = publicKey.length === 33 ? publicKey : secp256k1.Point.fromBytes(publicKey).toBytes(true);
      return p2pkhAddress(key, prefixOf(network.id));
    },
    /** CashAddr (P2PKH, P2SH, token-aware), with or without its prefix, checksum verified. Legacy base58 isn't accepted. */
    isAddress: (value: string) => prefixesFor(value).length > 0,
    /** bitcoincash: → mainnet; bchtest: → chipnet and testnet4 (the same spelling). */
    networksForAddress: (value: string, candidates: Network[]) => {
      const ps = prefixesFor(value);
      return candidates.filter((c) => c.family === "bitcoincash" && netOf(c.id) && ps.includes(BCH_NETS[netOf(c.id)!].prefix));
    },
    getBalances,
    getNfts: async (): Promise<Nft[]> => [],
    decode,
    prepare,
    finalize,
    buildTransfer,
    /** "bitcoincash:q…" on mainnet, "bchtest:q…" on chipnet / testnet4: same key and coins' script. */
    receiveAddress: async (ctx: ChainContext) => addressOn(ctx),
    normalize,
    bchBalance,
  };
}

function warn(m: Msg): { message: string; msg: Msg } {
  return { message: m.fallback, msg: m };
}

/** Node rejection reasons (bchn `RejectCode` texts relayed by Fulcrum) in plain words. */
export function plainBchError(e: unknown): ClipError {
  if (e instanceof ClipError) return e;
  const text = e instanceof ElectrumError ? e.message : "";
  if (/insufficient fee|min relay fee|mempool min fee/i.test(text)) return new ClipError(msg("bg.bch.feeTooLow"), "bitcoincash/fee-too-low", e);
  if (/missing inputs|missingorspent|txn-mempool-conflict|bad-txns-inputs-missingorspent/i.test(text)) return new ClipError(msg("bg.bch.coinsSpent"), "bitcoincash/inputs-spent", e);
  if (/dust/i.test(text)) return new ClipError(msg("bg.bch.belowDust", { amount: fmt(DUST) }), "bitcoincash/too-small", e);
  return new ClipError("The network rejected this. Nothing was sent.", "bitcoincash/rejected", e);
}

export { decodeTx };
