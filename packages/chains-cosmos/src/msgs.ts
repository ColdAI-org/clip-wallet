import type { AminoMsg } from "./amino.js";
import { bech32Address } from "./address.js";
import {
  type Any,
  type Coin,
  ProtoError,
  TYPE,
  decodeGenericAuthorization,
  decodeMsgBeginRedelegate,
  decodeMsgDelegate,
  decodeMsgExecuteContract,
  decodeMsgGrant,
  decodeMsgGrantAllowance,
  decodeMsgRevoke,
  decodeMsgSend,
  decodeMsgTransfer,
  decodeMsgWithdrawReward,
  decodeThorMsgSend,
  Msg as ProtoMsg,
  decodeCoin,
} from "./proto.js";
import { isObj } from "./util.js";

/**
 * One understood message, from either signing mode. SIGN_MODE_DIRECT gives protobuf Anys (type URL), Amino JSON gives
 * { type, value } with the SDK's amino names (cosmos-sdk x/<module>/types/codec.go `legacy.RegisterAminoMsg`).
 * Initia replaces x/staking with "mstaking" (amounts are Coins) and has its own distribution module
 * (github.com/initia-labs/initia proto/initia/mstaking/v1/tx.proto, proto/initia/distribution/v1/tx.proto).
 */
export type CosmosMsg =
  | { kind: "send"; from: string; to: string; amount: Coin[] }
  | { kind: "ibc-transfer"; sender: string; receiver: string; token: Coin; port: string; channel: string; memo: string; timeoutTimestamp: bigint }
  | { kind: "delegate"; delegator: string; validator: string; amount: Coin[] }
  | { kind: "undelegate"; delegator: string; validator: string; amount: Coin[] }
  | { kind: "redelegate"; delegator: string; from: string; to: string; amount: Coin[] }
  | { kind: "withdraw-rewards"; delegator: string; validator: string }
  | { kind: "execute"; sender: string; contract: string; msg: unknown; msgText: string; funds: Coin[] }
  | { kind: "authz-grant"; granter: string; grantee: string; authorization: string; expiration?: bigint }
  | { kind: "authz-revoke"; granter: string; grantee: string; msgTypeUrl: string }
  | { kind: "feegrant"; granter: string; grantee: string; allowance: string; spendLimit: Coin[] }
  | { kind: "feegrant-revoke"; granter: string; grantee: string }
  | { kind: "unknown"; type: string };

const INITIA = {
  delegate: "/initia.mstaking.v1.MsgDelegate",
  undelegate: "/initia.mstaking.v1.MsgUndelegate",
  redelegate: "/initia.mstaking.v1.MsgBeginRedelegate",
  withdraw: "/initia.distribution.v1.MsgWithdrawDelegatorReward",
} as const;

/** MsgDelegate-shaped with `repeated Coin amount = 3` (initia mstaking). */
function delegateCoins(b: Uint8Array): { delegator: string; validator: string; amount: Coin[] } {
  const m = new ProtoMsg(b);
  return { delegator: m.string(1), validator: m.string(2), amount: m.repeated(3).map(decodeCoin) };
}

function redelegateCoins(b: Uint8Array): { delegator: string; from: string; to: string; amount: Coin[] } {
  const m = new ProtoMsg(b);
  return { delegator: m.string(1), from: m.string(2), to: m.string(3), amount: m.repeated(4).map(decodeCoin) };
}

/** Decodes the authorization Any of an authz grant into words-for-the-UI input. */
function authorizationOf(a: Any | undefined): string {
  if (!a) return "unknown";
  if (a.typeUrl === TYPE.genericAuthorization) return decodeGenericAuthorization(a.value) || "unknown";
  return a.typeUrl;
}

function allowanceOf(a: Any | undefined): { allowance: string; spendLimit: Coin[] } {
  if (!a) return { allowance: "unknown", spendLimit: [] };
  if (a.typeUrl === TYPE.basicAllowance) return { allowance: a.typeUrl, spendLimit: new ProtoMsg(a.value).repeated(1).map(decodeCoin) };
  return { allowance: a.typeUrl, spendLimit: [] };
}

function parseJson(bytes: Uint8Array): { msg: unknown; text: string } {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  try {
    return { msg: JSON.parse(text), text };
  } catch {
    return { msg: null, text };
  }
}

/** SIGN_MODE_DIRECT message → CosmosMsg. `prefix` turns THORChain's raw-bytes addresses into thor1… */
export function fromAny(a: Any, prefix: string): CosmosMsg {
  try {
    switch (a.typeUrl) {
      case TYPE.msgSend: {
        const m = decodeMsgSend(a.value);
        return { kind: "send", from: m.fromAddress, to: m.toAddress, amount: m.amount };
      }
      case TYPE.thorMsgSend: {
        const m = decodeThorMsgSend(a.value);
        if (m.fromAddress.length !== 20 || m.toAddress.length !== 20) return { kind: "unknown", type: a.typeUrl };
        return { kind: "send", from: bech32Address(prefix, m.fromAddress), to: bech32Address(prefix, m.toAddress), amount: m.amount };
      }
      case TYPE.msgTransfer: {
        const m = decodeMsgTransfer(a.value);
        return { kind: "ibc-transfer", sender: m.sender, receiver: m.receiver, token: m.token, port: m.sourcePort, channel: m.sourceChannel, memo: m.memo, timeoutTimestamp: m.timeoutTimestamp };
      }
      case TYPE.msgDelegate:
      case TYPE.msgUndelegate: {
        const m = decodeMsgDelegate(a.value);
        return { kind: a.typeUrl === TYPE.msgDelegate ? "delegate" : "undelegate", delegator: m.delegator, validator: m.validator, amount: [m.amount] };
      }
      case INITIA.delegate:
      case INITIA.undelegate: {
        const m = delegateCoins(a.value);
        return { kind: a.typeUrl === INITIA.delegate ? "delegate" : "undelegate", ...m };
      }
      case TYPE.msgBeginRedelegate: {
        const m = decodeMsgBeginRedelegate(a.value);
        return { kind: "redelegate", delegator: m.delegator, from: m.from, to: m.to, amount: [m.amount] };
      }
      case INITIA.redelegate:
        return { kind: "redelegate", ...redelegateCoins(a.value) };
      case TYPE.msgWithdrawReward:
      case INITIA.withdraw: {
        const m = decodeMsgWithdrawReward(a.value);
        return { kind: "withdraw-rewards", delegator: m.delegator, validator: m.validator };
      }
      case TYPE.msgExecuteContract: {
        const m = decodeMsgExecuteContract(a.value);
        const j = parseJson(m.msg);
        return { kind: "execute", sender: m.sender, contract: m.contract, msg: j.msg, msgText: j.text, funds: m.funds };
      }
      case TYPE.msgGrant: {
        const m = decodeMsgGrant(a.value);
        const out: CosmosMsg = { kind: "authz-grant", granter: m.granter, grantee: m.grantee, authorization: authorizationOf(m.authorization) };
        if (m.expiration !== undefined) out.expiration = m.expiration;
        return out;
      }
      case TYPE.msgRevoke: {
        const m = decodeMsgRevoke(a.value);
        return { kind: "authz-revoke", granter: m.granter, grantee: m.grantee, msgTypeUrl: m.msgTypeUrl };
      }
      case TYPE.msgGrantAllowance: {
        const m = decodeMsgGrantAllowance(a.value);
        return { kind: "feegrant", granter: m.granter, grantee: m.grantee, ...allowanceOf(m.allowance) };
      }
      case TYPE.msgRevokeAllowance: {
        const m = decodeMsgRevoke(a.value);
        return { kind: "feegrant-revoke", granter: m.granter, grantee: m.grantee };
      }
    }
  } catch (e) {
    if (e instanceof ProtoError) return { kind: "unknown", type: a.typeUrl };
    throw e;
  }
  return { kind: "unknown", type: a.typeUrl };
}

/* ------------------------------------------------------------------ amino */

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function coins(v: unknown): Coin[] | null {
  if (!Array.isArray(v)) return null;
  const out: Coin[] = [];
  for (const c of v) {
    if (!isObj(c) || typeof c.denom !== "string" || typeof c.amount !== "string" || !/^\d+$/.test(c.amount)) return null;
    out.push({ denom: c.denom, amount: c.amount });
  }
  return out;
}

function coin(v: unknown): Coin | null {
  const c = coins([v]);
  return c ? c[0]! : null;
}

/**
 * Amino JSON message → CosmosMsg. Names from cosmos-sdk codecs (bank "cosmos-sdk/MsgSend", staking
 * "cosmos-sdk/MsgDelegate" / "cosmos-sdk/MsgUndelegate" / "cosmos-sdk/MsgBeginRedelegate", distribution
 * "cosmos-sdk/MsgWithdrawDelegationReward", authz "cosmos-sdk/MsgGrant" / "cosmos-sdk/MsgRevoke", feegrant
 * "cosmos-sdk/MsgGrantAllowance" / "cosmos-sdk/MsgRevokeAllowance"), ibc-go "cosmos-sdk/MsgTransfer", wasmd
 * "wasm/MsgExecuteContract" (msg is inline JSON), THORChain "thorchain/MsgSend" (bech32 strings in amino JSON),
 * Initia "mstaking/MsgDelegate" / "mstaking/MsgUndelegate" / "mstaking/MsgBeginRedelegate" and
 * "distribution/MsgWithdrawDelegatorReward".
 */
export function fromAmino(m: AminoMsg): CosmosMsg {
  const v = isObj(m.value) ? m.value : {};
  const unknown: CosmosMsg = { kind: "unknown", type: m.type };
  switch (m.type) {
    case "cosmos-sdk/MsgSend":
    case "thorchain/MsgSend":
    case "bank/MsgSend": {
      const amount = coins(v.amount);
      if (!amount) return unknown;
      return { kind: "send", from: str(v.from_address), to: str(v.to_address), amount };
    }
    case "cosmos-sdk/MsgTransfer": {
      const token = coin(v.token);
      if (!token) return unknown;
      return {
        kind: "ibc-transfer",
        sender: str(v.sender),
        receiver: str(v.receiver),
        token,
        port: str(v.source_port),
        channel: str(v.source_channel),
        memo: str(v.memo),
        timeoutTimestamp: /^\d+$/.test(str(v.timeout_timestamp)) ? BigInt(str(v.timeout_timestamp)) : 0n,
      };
    }
    case "cosmos-sdk/MsgDelegate":
    case "cosmos-sdk/MsgUndelegate":
    case "mstaking/MsgDelegate":
    case "mstaking/MsgUndelegate": {
      const amount = Array.isArray(v.amount) ? coins(v.amount) : coin(v.amount) ? [coin(v.amount)!] : null;
      if (!amount) return unknown;
      return { kind: /Undelegate$/.test(m.type) ? "undelegate" : "delegate", delegator: str(v.delegator_address), validator: str(v.validator_address), amount };
    }
    case "cosmos-sdk/MsgBeginRedelegate":
    case "mstaking/MsgBeginRedelegate": {
      const amount = Array.isArray(v.amount) ? coins(v.amount) : coin(v.amount) ? [coin(v.amount)!] : null;
      if (!amount) return unknown;
      return { kind: "redelegate", delegator: str(v.delegator_address), from: str(v.validator_src_address), to: str(v.validator_dst_address), amount };
    }
    case "cosmos-sdk/MsgWithdrawDelegationReward":
    case "distribution/MsgWithdrawDelegatorReward":
      return { kind: "withdraw-rewards", delegator: str(v.delegator_address), validator: str(v.validator_address) };
    case "wasm/MsgExecuteContract": {
      const funds = coins(v.funds ?? []);
      if (!funds) return unknown;
      return { kind: "execute", sender: str(v.sender), contract: str(v.contract), msg: v.msg ?? null, msgText: JSON.stringify(v.msg ?? null), funds };
    }
    case "cosmos-sdk/MsgGrant": {
      const g = isObj(v.grant) ? v.grant : {};
      const a = isObj(g.authorization) ? g.authorization : {};
      const av = isObj(a.value) ? a.value : {};
      const authorization = a.type === "cosmos-sdk/GenericAuthorization" ? str(av.msg) || "unknown" : str(a.type) || "unknown";
      return { kind: "authz-grant", granter: str(v.granter), grantee: str(v.grantee), authorization };
    }
    case "cosmos-sdk/MsgRevoke":
      return { kind: "authz-revoke", granter: str(v.granter), grantee: str(v.grantee), msgTypeUrl: str(v.msg_type_url) };
    case "cosmos-sdk/MsgGrantAllowance": {
      const a = isObj(v.allowance) ? v.allowance : {};
      const av = isObj(a.value) ? a.value : {};
      return { kind: "feegrant", granter: str(v.granter), grantee: str(v.grantee), allowance: str(a.type) || "unknown", spendLimit: coins(av.spend_limit ?? []) ?? [] };
    }
    case "cosmos-sdk/MsgRevokeAllowance":
      return { kind: "feegrant-revoke", granter: str(v.granter), grantee: str(v.grantee) };
  }
  return unknown;
}

/** The account a message needs a signature from (its first signer, cosmos.msg.v1.signer), when known. */
export function signerOf(m: CosmosMsg): string | undefined {
  switch (m.kind) {
    case "send":
      return m.from;
    case "ibc-transfer":
      return m.sender;
    case "delegate":
    case "undelegate":
    case "redelegate":
    case "withdraw-rewards":
      return m.delegator;
    case "execute":
      return m.sender;
    case "authz-grant":
    case "authz-revoke":
    case "feegrant":
    case "feegrant-revoke":
      return m.granter;
    default:
      return undefined;
  }
}
