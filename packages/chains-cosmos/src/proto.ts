/**
 * The protobuf this module needs, by hand (proto3 wire format: https://protobuf.dev/programming-guides/encoding/).
 * Writers emit fields in field-number order and skip proto3 defaults (0, "", empty bytes), exactly as gogoproto /
 * cosmjs-types do, so the bytes match what the chain re-encodes (tests compare against cosmjs-types).
 *
 * Messages (cosmos-sdk proto, https://github.com/cosmos/cosmos-sdk/tree/main/proto):
 *  - cosmos.tx.v1beta1: TxBody, AuthInfo, SignerInfo, ModeInfo, Fee, SignDoc, TxRaw (tx.proto)
 *  - cosmos.base.v1beta1.Coin, google.protobuf.Any
 *  - cosmos.bank.v1beta1.MsgSend, cosmos.staking.v1beta1.MsgDelegate/MsgUndelegate/MsgBeginRedelegate,
 *    cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward, ibc.applications.transfer.v1.MsgTransfer,
 *    cosmwasm.wasm.v1.MsgExecuteContract, cosmos.authz.v1beta1.MsgGrant/MsgExec/MsgRevoke,
 *    cosmos.feegrant.v1beta1.MsgGrantAllowance/MsgRevokeAllowance
 *  - THORChain types.MsgSend / types.MsgDeposit (thornode proto/thorchain/v1/types/msg_send.proto, msg_deposit.proto)
 */

/* ------------------------------------------------------------------ writer */

export class Writer {
  private parts: number[] = [];

  private varint(v: bigint): void {
    if (v < 0n) v &= (1n << 64n) - 1n; // int64 negative: two's complement, 10 bytes
    while (v > 0x7fn) {
      this.parts.push(Number(v & 0x7fn) | 0x80);
      v >>= 7n;
    }
    this.parts.push(Number(v));
  }

  private tag(field: number, wire: number): void {
    this.varint(BigInt((field << 3) | wire));
  }

  /** uint64/int64/uint32/bool/enum; skipped when 0 (proto3 default). */
  uint(field: number, v: bigint | number | boolean | undefined): this {
    const n = typeof v === "boolean" ? (v ? 1n : 0n) : BigInt(v ?? 0);
    if (n === 0n) return this;
    this.tag(field, 0);
    this.varint(n);
    return this;
  }

  bytes(field: number, v: Uint8Array | undefined): this {
    if (!v || v.length === 0) return this;
    this.tag(field, 2);
    this.varint(BigInt(v.length));
    for (const b of v) this.parts.push(b);
    return this;
  }

  /** Embedded message: written even when empty if `always` (e.g. a ModeInfo's `single {}`). */
  message(field: number, v: Uint8Array | undefined, always = false): this {
    if (!v) return this;
    if (v.length === 0 && !always) return this;
    this.tag(field, 2);
    this.varint(BigInt(v.length));
    for (const b of v) this.parts.push(b);
    return this;
  }

  string(field: number, v: string | undefined): this {
    return this.bytes(field, v ? new TextEncoder().encode(v) : undefined);
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

/* ------------------------------------------------------------------ reader */

export interface Field {
  no: number;
  wire: number;
  /** varint value (wire 0) */
  int?: bigint;
  /** length-delimited payload (wire 2) */
  bytes?: Uint8Array;
}

export class ProtoError extends Error {}

/** Splits a message into fields. Throws ProtoError on anything malformed (groups, truncation, bad wire types). */
export function readFields(buf: Uint8Array): Field[] {
  const out: Field[] = [];
  let at = 0;
  const varint = (): bigint => {
    let v = 0n;
    let shift = 0n;
    for (;;) {
      if (at >= buf.length) throw new ProtoError("truncated varint");
      const b = buf[at++]!;
      v |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return v;
      shift += 7n;
      if (shift > 63n) throw new ProtoError("varint too long");
    }
  };
  while (at < buf.length) {
    const key = varint();
    const no = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (no === 0) throw new ProtoError("field 0");
    switch (wire) {
      case 0:
        out.push({ no, wire, int: varint() });
        break;
      case 1:
        if (at + 8 > buf.length) throw new ProtoError("truncated fixed64");
        out.push({ no, wire, bytes: buf.subarray(at, at + 8) });
        at += 8;
        break;
      case 2: {
        const len = Number(varint());
        if (at + len > buf.length) throw new ProtoError("truncated bytes");
        out.push({ no, wire, bytes: buf.subarray(at, at + len) });
        at += len;
        break;
      }
      case 5:
        if (at + 4 > buf.length) throw new ProtoError("truncated fixed32");
        out.push({ no, wire, bytes: buf.subarray(at, at + 4) });
        at += 4;
        break;
      default:
        throw new ProtoError(`wire type ${wire}`);
    }
  }
  return out;
}

const dec = new TextDecoder("utf-8", { fatal: true });

/** A read view over one message's fields. Last value wins for scalars (proto3), all values for repeated. */
export class Msg {
  readonly fields: Field[];
  constructor(buf: Uint8Array) {
    this.fields = readFields(buf);
  }
  private last(no: number, wire: number): Field | undefined {
    let f: Field | undefined;
    for (const x of this.fields) if (x.no === no) {
      if (x.wire !== wire) throw new ProtoError(`field ${no}: wire ${x.wire}, expected ${wire}`);
      f = x;
    }
    return f;
  }
  uint(no: number): bigint {
    return this.last(no, 0)?.int ?? 0n;
  }
  bool(no: number): boolean {
    return this.uint(no) !== 0n;
  }
  bytes(no: number): Uint8Array {
    return this.last(no, 2)?.bytes ?? new Uint8Array();
  }
  has(no: number): boolean {
    return this.fields.some((f) => f.no === no);
  }
  string(no: number): string {
    try {
      return dec.decode(this.bytes(no));
    } catch {
      throw new ProtoError(`field ${no}: not UTF-8`);
    }
  }
  repeated(no: number): Uint8Array[] {
    return this.fields.filter((f) => f.no === no).map((f) => {
      if (f.wire !== 2) throw new ProtoError(`field ${no}: wire ${f.wire}`);
      return f.bytes!;
    });
  }
  /** Field numbers present that aren't in `known` (used to refuse what we can't show). */
  unknown(known: number[]): number[] {
    return [...new Set(this.fields.map((f) => f.no).filter((n) => !known.includes(n)))];
  }
}

/* ------------------------------------------------------------------ common types */

export interface Coin {
  denom: string;
  amount: string;
}

export interface Any {
  typeUrl: string;
  value: Uint8Array;
}

export const encodeCoin = (c: Coin): Uint8Array => new Writer().string(1, c.denom).string(2, c.amount).finish();
export function decodeCoin(b: Uint8Array): Coin {
  const m = new Msg(b);
  const amount = m.string(2);
  if (amount && !/^\d+$/.test(amount)) throw new ProtoError("bad coin amount");
  return { denom: m.string(1), amount: amount || "0" };
}

export const encodeAny = (a: Any): Uint8Array => new Writer().string(1, a.typeUrl).bytes(2, a.value).finish();
export function decodeAny(b: Uint8Array): Any {
  const m = new Msg(b);
  return { typeUrl: m.string(1), value: m.bytes(2) };
}

/* ------------------------------------------------------------------ tx */

export interface TxBody {
  messages: Any[];
  memo: string;
  timeoutHeight: bigint;
  /** extension_options (1023) / non_critical_extension_options (2047): kept so a re-encode is exact. */
  extensionOptions: Any[];
  nonCriticalExtensionOptions: Any[];
  /** SDK 0.50+: unordered (4), timeout_timestamp (5). Present = shown, not understood. */
  unordered: boolean;
  timeoutTimestamp?: Uint8Array;
}

export function encodeTxBody(b: Pick<TxBody, "messages" | "memo"> & Partial<TxBody>): Uint8Array {
  const w = new Writer();
  for (const m of b.messages) w.message(1, encodeAny(m), true);
  w.string(2, b.memo);
  w.uint(3, b.timeoutHeight ?? 0n);
  for (const e of b.extensionOptions ?? []) w.message(1023, encodeAny(e), true);
  for (const e of b.nonCriticalExtensionOptions ?? []) w.message(2047, encodeAny(e), true);
  return w.finish();
}

export function decodeTxBody(bytes: Uint8Array): TxBody {
  const m = new Msg(bytes);
  const body: TxBody = {
    messages: m.repeated(1).map(decodeAny),
    memo: m.string(2),
    timeoutHeight: m.uint(3),
    extensionOptions: m.repeated(1023).map(decodeAny),
    nonCriticalExtensionOptions: m.repeated(2047).map(decodeAny),
    unordered: m.has(4) ? m.bool(4) : false,
  };
  if (m.has(5)) body.timeoutTimestamp = m.bytes(5);
  const extra = m.unknown([1, 2, 3, 4, 5, 1023, 2047]);
  if (extra.length) throw new ProtoError(`TxBody field ${extra[0]}`);
  return body;
}

export const SIGN_MODE_DIRECT = 1;
export const SIGN_MODE_LEGACY_AMINO_JSON = 127;

export interface SignerInfo {
  publicKey?: Any;
  /** single.mode, or undefined for multisig mode info */
  mode?: number;
  multi: boolean;
  sequence: bigint;
}

export interface Fee {
  amount: Coin[];
  gasLimit: bigint;
  payer: string;
  granter: string;
}

export interface AuthInfo {
  signerInfos: SignerInfo[];
  fee: Fee;
  /** AuthInfo.tip (3), deprecated: present = refused. */
  hasTip: boolean;
}

export function encodeSignerInfo(s: { publicKey: Any; mode: number; sequence: bigint }): Uint8Array {
  const single = new Writer().uint(1, s.mode).finish();
  const modeInfo = new Writer().message(1, single, true).finish();
  return new Writer().message(1, encodeAny(s.publicKey), true).message(2, modeInfo, true).uint(3, s.sequence).finish();
}

export function encodeFee(f: { amount: Coin[]; gasLimit: bigint; payer?: string; granter?: string }): Uint8Array {
  const w = new Writer();
  for (const c of f.amount) w.message(1, encodeCoin(c), true);
  w.uint(2, f.gasLimit);
  w.string(3, f.payer);
  w.string(4, f.granter);
  return w.finish();
}

export function encodeAuthInfo(a: { signerInfos: { publicKey: Any; mode: number; sequence: bigint }[]; fee: { amount: Coin[]; gasLimit: bigint; payer?: string; granter?: string } }): Uint8Array {
  const w = new Writer();
  for (const s of a.signerInfos) w.message(1, encodeSignerInfo(s), true);
  w.message(2, encodeFee(a.fee), true);
  return w.finish();
}

export function decodeAuthInfo(bytes: Uint8Array): AuthInfo {
  const m = new Msg(bytes);
  const signerInfos = m.repeated(1).map((b): SignerInfo => {
    const s = new Msg(b);
    const info: SignerInfo = { multi: false, sequence: s.uint(3) };
    if (s.has(1)) info.publicKey = decodeAny(s.bytes(1));
    if (s.has(2)) {
      const mi = new Msg(s.bytes(2));
      if (mi.has(1)) info.mode = Number(new Msg(mi.bytes(1)).uint(1));
      else if (mi.has(2)) info.multi = true;
    }
    return info;
  });
  const f = new Msg(m.bytes(2));
  return {
    signerInfos,
    fee: { amount: f.repeated(1).map(decodeCoin), gasLimit: f.uint(2), payer: f.string(3), granter: f.string(4) },
    hasTip: m.has(3),
  };
}

export interface SignDoc {
  bodyBytes: Uint8Array;
  authInfoBytes: Uint8Array;
  chainId: string;
  accountNumber: bigint;
}

/** cosmos.tx.v1beta1.SignDoc: what SIGN_MODE_DIRECT signs. */
export function encodeSignDoc(d: SignDoc): Uint8Array {
  return new Writer().bytes(1, d.bodyBytes).bytes(2, d.authInfoBytes).string(3, d.chainId).uint(4, d.accountNumber).finish();
}

export function encodeTxRaw(t: { bodyBytes: Uint8Array; authInfoBytes: Uint8Array; signatures: Uint8Array[] }): Uint8Array {
  const w = new Writer().bytes(1, t.bodyBytes).bytes(2, t.authInfoBytes);
  for (const s of t.signatures) w.message(3, s, true);
  return w.finish();
}

export function decodeTxRaw(bytes: Uint8Array): { bodyBytes: Uint8Array; authInfoBytes: Uint8Array; signatures: Uint8Array[] } {
  const m = new Msg(bytes);
  return { bodyBytes: m.bytes(1), authInfoBytes: m.bytes(2), signatures: m.repeated(3) };
}

/* ------------------------------------------------------------------ public keys */

/** cosmos.crypto.secp256k1.PubKey and initia.crypto.v1beta1.ethsecp256k1.PubKey both are `bytes key = 1`. */
export const encodePubKey = (key: Uint8Array): Uint8Array => new Writer().bytes(1, key).finish();
export const decodePubKey = (b: Uint8Array): Uint8Array => new Msg(b).bytes(1);

/* ------------------------------------------------------------------ messages */

export const TYPE = {
  msgSend: "/cosmos.bank.v1beta1.MsgSend",
  msgMultiSend: "/cosmos.bank.v1beta1.MsgMultiSend",
  msgTransfer: "/ibc.applications.transfer.v1.MsgTransfer",
  msgDelegate: "/cosmos.staking.v1beta1.MsgDelegate",
  msgUndelegate: "/cosmos.staking.v1beta1.MsgUndelegate",
  msgBeginRedelegate: "/cosmos.staking.v1beta1.MsgBeginRedelegate",
  msgWithdrawReward: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
  msgExecuteContract: "/cosmwasm.wasm.v1.MsgExecuteContract",
  msgGrant: "/cosmos.authz.v1beta1.MsgGrant",
  msgExec: "/cosmos.authz.v1beta1.MsgExec",
  msgRevoke: "/cosmos.authz.v1beta1.MsgRevoke",
  msgGrantAllowance: "/cosmos.feegrant.v1beta1.MsgGrantAllowance",
  msgRevokeAllowance: "/cosmos.feegrant.v1beta1.MsgRevokeAllowance",
  thorMsgSend: "/types.MsgSend",
  thorMsgDeposit: "/types.MsgDeposit",
  genericAuthorization: "/cosmos.authz.v1beta1.GenericAuthorization",
  sendAuthorization: "/cosmos.bank.v1beta1.SendAuthorization",
  stakeAuthorization: "/cosmos.staking.v1beta1.StakeAuthorization",
  basicAllowance: "/cosmos.feegrant.v1beta1.BasicAllowance",
  periodicAllowance: "/cosmos.feegrant.v1beta1.PeriodicAllowance",
  allowedMsgAllowance: "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
} as const;

export interface MsgSendValue {
  fromAddress: string;
  toAddress: string;
  amount: Coin[];
}

export function encodeMsgSend(m: MsgSendValue): Uint8Array {
  const w = new Writer().string(1, m.fromAddress).string(2, m.toAddress);
  for (const c of m.amount) w.message(3, encodeCoin(c), true);
  return w.finish();
}

export function decodeMsgSend(b: Uint8Array): MsgSendValue {
  const m = new Msg(b);
  return { fromAddress: m.string(1), toAddress: m.string(2), amount: m.repeated(3).map(decodeCoin) };
}

/**
 * THORChain types.MsgSend { bytes from_address = 1 (AccAddress); bytes to_address = 2; repeated Coin amount = 3;
 * bytes signer = 4? } — thornode proto/thorchain/v1/types/msg_send.proto: from_address and to_address are
 * `bytes` cast to cosmos AccAddress (raw 20 bytes), amount is cosmos.base.v1beta1.Coin.
 */
export interface ThorMsgSendValue {
  fromAddress: Uint8Array;
  toAddress: Uint8Array;
  amount: Coin[];
}

export function encodeThorMsgSend(m: ThorMsgSendValue): Uint8Array {
  const w = new Writer().bytes(1, m.fromAddress).bytes(2, m.toAddress);
  for (const c of m.amount) w.message(3, encodeCoin(c), true);
  return w.finish();
}

export function decodeThorMsgSend(b: Uint8Array): ThorMsgSendValue {
  const m = new Msg(b);
  return { fromAddress: m.bytes(1), toAddress: m.bytes(2), amount: m.repeated(3).map(decodeCoin) };
}

/**
 * THORChain types.MsgDeposit { repeated common.Coin coins = 1; string memo = 2; bytes signer = 3 }, common.Coin
 * { common.Asset asset = 1; string amount = 2; int64 decimals = 3 }, common.Asset { chain = 1; symbol = 2; ticker = 3;
 * synth = 4; trade = 5; secured = 6 } (thornode proto/thorchain/v1/types/msg_deposit.proto, common/common.proto).
 */
export function decodeThorMsgDeposit(b: Uint8Array): { coins: { asset: string; amount: string }[]; memo: string; signer: Uint8Array } {
  const m = new Msg(b);
  const coins = m.repeated(1).map((cb) => {
    const c = new Msg(cb);
    const a = new Msg(c.bytes(1));
    const chain = a.string(1);
    const symbol = a.string(2);
    const sep = a.bool(4) ? "/" : a.bool(5) ? "~" : a.bool(6) ? "-" : ".";
    return { asset: chain && symbol ? `${chain}${sep}${symbol}` : symbol || chain, amount: c.string(2) || "0" };
  });
  return { coins, memo: m.string(2), signer: m.bytes(3) };
}

export interface MsgTransferValue {
  sourcePort: string;
  sourceChannel: string;
  token: Coin;
  sender: string;
  receiver: string;
  timeoutHeight: { revisionNumber: bigint; revisionHeight: bigint };
  timeoutTimestamp: bigint;
  memo: string;
}

export function decodeMsgTransfer(b: Uint8Array): MsgTransferValue {
  const m = new Msg(b);
  const h = new Msg(m.bytes(6));
  return {
    sourcePort: m.string(1),
    sourceChannel: m.string(2),
    token: decodeCoin(m.bytes(3)),
    sender: m.string(4),
    receiver: m.string(5),
    timeoutHeight: { revisionNumber: h.uint(1), revisionHeight: h.uint(2) },
    timeoutTimestamp: m.uint(7),
    memo: m.string(8),
  };
}

/** MsgDelegate / MsgUndelegate { delegator_address = 1; validator_address = 2; Coin amount = 3 }. */
export function decodeMsgDelegate(b: Uint8Array): { delegator: string; validator: string; amount: Coin } {
  const m = new Msg(b);
  return { delegator: m.string(1), validator: m.string(2), amount: decodeCoin(m.bytes(3)) };
}

/** MsgBeginRedelegate { delegator = 1; validator_src = 2; validator_dst = 3; Coin amount = 4 }. */
export function decodeMsgBeginRedelegate(b: Uint8Array): { delegator: string; from: string; to: string; amount: Coin } {
  const m = new Msg(b);
  return { delegator: m.string(1), from: m.string(2), to: m.string(3), amount: decodeCoin(m.bytes(4)) };
}

/** MsgWithdrawDelegatorReward { delegator_address = 1; validator_address = 2 }. */
export function decodeMsgWithdrawReward(b: Uint8Array): { delegator: string; validator: string } {
  const m = new Msg(b);
  return { delegator: m.string(1), validator: m.string(2) };
}

/** cosmwasm.wasm.v1.MsgExecuteContract { sender = 1; contract = 2; bytes msg = 3 (JSON); repeated Coin funds = 5 }. */
export function decodeMsgExecuteContract(b: Uint8Array): { sender: string; contract: string; msg: Uint8Array; funds: Coin[] } {
  const m = new Msg(b);
  return { sender: m.string(1), contract: m.string(2), msg: m.bytes(3), funds: m.repeated(5).map(decodeCoin) };
}

/** authz MsgGrant { granter = 1; grantee = 2; Grant grant = 3 { Any authorization = 1; Timestamp expiration = 2 } }. */
export function decodeMsgGrant(b: Uint8Array): { granter: string; grantee: string; authorization?: Any; expiration?: bigint } {
  const m = new Msg(b);
  const g = new Msg(m.bytes(3));
  const out: { granter: string; grantee: string; authorization?: Any; expiration?: bigint } = { granter: m.string(1), grantee: m.string(2) };
  if (g.has(1)) out.authorization = decodeAny(g.bytes(1));
  if (g.has(2)) out.expiration = new Msg(g.bytes(2)).uint(1);
  return out;
}

/** authz GenericAuthorization { string msg = 1 }. */
export const decodeGenericAuthorization = (b: Uint8Array): string => new Msg(b).string(1);

/** feegrant MsgGrantAllowance { granter = 1; grantee = 2; Any allowance = 3 }. */
export function decodeMsgGrantAllowance(b: Uint8Array): { granter: string; grantee: string; allowance?: Any } {
  const m = new Msg(b);
  const out: { granter: string; grantee: string; allowance?: Any } = { granter: m.string(1), grantee: m.string(2) };
  if (m.has(3)) out.allowance = decodeAny(m.bytes(3));
  return out;
}

/** authz MsgRevoke { granter = 1; grantee = 2; msg_type_url = 3 }; feegrant MsgRevokeAllowance { granter = 1; grantee = 2 }. */
export function decodeMsgRevoke(b: Uint8Array): { granter: string; grantee: string; msgTypeUrl: string } {
  const m = new Msg(b);
  return { granter: m.string(1), grantee: m.string(2), msgTypeUrl: m.string(3) };
}

/** authz MsgExec { grantee = 1; repeated Any msgs = 2 }. */
export function decodeMsgExec(b: Uint8Array): { grantee: string; msgs: Any[] } {
  const m = new Msg(b);
  return { grantee: m.string(1), msgs: m.repeated(2).map(decodeAny) };
}
