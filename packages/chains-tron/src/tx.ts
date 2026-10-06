import { sha256 } from "@noble/hashes/sha2.js";
import { addressBytes, encodeAddress } from "./address.js";
import { Fields, ProtoError, Writer, varintLength } from "./proto.js";
import { bytesEqual, fromHex, hex, isHex, utf8 } from "./util.js";

/**
 * TRON transactions, hand-written against java-tron's protobuf definitions
 * (https://github.com/tronprotocol/java-tron/tree/develop/protocol/src/main/protos/core: Tron.proto `Transaction`,
 * contract/balance_contract.proto, smart_contract.proto, asset_issue_contract.proto, witness_contract.proto,
 * account_contract.proto, common.proto `ResourceCode`).
 *
 *   Transaction.raw { bytes ref_block_bytes = 1; int64 ref_block_num = 3; bytes ref_block_hash = 4; int64 expiration = 8;
 *                     repeated authority auths = 9; bytes data = 10; repeated Contract contract = 11; bytes scripts = 12;
 *                     int64 timestamp = 14; int64 fee_limit = 18; }
 *   Contract { ContractType type = 1; google.protobuf.Any parameter = 2; bytes provider = 3; bytes ContractName = 4;
 *              int32 Permission_id = 5; }      Any { string type_url = 1; bytes value = 2; }
 *
 * txID = sha256(raw_data bytes) (what TronWeb calls `txID`); the signature covers exactly that digest.
 */

export const CONTRACT_TYPES = {
  AccountCreateContract: 0,
  TransferContract: 1,
  TransferAssetContract: 2,
  VoteAssetContract: 3,
  VoteWitnessContract: 4,
  WitnessCreateContract: 5,
  AssetIssueContract: 6,
  WitnessUpdateContract: 8,
  ParticipateAssetIssueContract: 9,
  AccountUpdateContract: 10,
  FreezeBalanceContract: 11,
  UnfreezeBalanceContract: 12,
  WithdrawBalanceContract: 13,
  UnfreezeAssetContract: 14,
  UpdateAssetContract: 15,
  ProposalCreateContract: 16,
  ProposalApproveContract: 17,
  ProposalDeleteContract: 18,
  SetAccountIdContract: 19,
  CustomContract: 20,
  CreateSmartContract: 30,
  TriggerSmartContract: 31,
  GetContract: 32,
  UpdateSettingContract: 33,
  ExchangeCreateContract: 41,
  ExchangeInjectContract: 42,
  ExchangeWithdrawContract: 43,
  ExchangeTransactionContract: 44,
  UpdateEnergyLimitContract: 45,
  AccountPermissionUpdateContract: 46,
  ClearABIContract: 48,
  UpdateBrokerageContract: 49,
  ShieldedTransferContract: 51,
  MarketSellAssetContract: 52,
  MarketCancelOrderContract: 53,
  FreezeBalanceV2Contract: 54,
  UnfreezeBalanceV2Contract: 55,
  WithdrawExpireUnfreezeContract: 56,
  DelegateResourceContract: 57,
  UnDelegateResourceContract: 58,
  CancelAllUnfreezeV2Contract: 59,
} as const;

export type ContractName = keyof typeof CONTRACT_TYPES;
const NAME_OF = new Map<number, ContractName>(Object.entries(CONTRACT_TYPES).map(([k, v]) => [v, k as ContractName]));
export const contractName = (type: number): ContractName | undefined => NAME_OF.get(type);
export const typeUrlOf = (name: ContractName) => `type.googleapis.com/protocol.${name}`;

/** common.proto ResourceCode. */
export const RESOURCES = ["BANDWIDTH", "ENERGY", "TRON_POWER"] as const;
export type Resource = (typeof RESOURCES)[number];
export const resourceName = (code: bigint): Resource | null => RESOURCES[Number(code)] ?? null;

export interface ContractEntry {
  type: number;
  name?: ContractName;
  typeUrl: string;
  value: Uint8Array;
  permissionId: number;
  /** provider / ContractName set (never set by TronWeb or java-tron's builders). */
  extra: boolean;
}

export interface RawTx {
  bytes: Uint8Array;
  refBlockBytes: Uint8Array;
  refBlockNum: bigint;
  refBlockHash: Uint8Array;
  expiration: bigint;
  /** Transaction memo (raw.data). */
  data: Uint8Array;
  contracts: ContractEntry[];
  timestamp: bigint;
  feeLimit: bigint;
  /** auths / scripts / unknown fields present: java-tron ignores them, but Clip doesn't explain them. */
  oddities: string[];
}

const RAW_FIELDS = [1, 3, 4, 8, 9, 10, 11, 12, 14, 18] as const;

export function parseRaw(bytes: Uint8Array): RawTx {
  const f = Fields.parse(bytes);
  const oddities: string[] = [];
  if (f.has(9)) oddities.push("auths");
  if (f.has(12)) oddities.push("scripts");
  for (const n of f.unknown(RAW_FIELDS)) oddities.push(`field ${n}`);
  const contracts = f.repeated(11).map((c): ContractEntry => {
    const cf = Fields.parse(c);
    const any = Fields.parse(cf.bytes(2));
    const type = Number(cf.int(1));
    const name = contractName(type);
    return {
      type,
      ...(name ? { name } : {}),
      typeUrl: any.string(1),
      value: any.bytes(2),
      permissionId: Number(cf.int(5)),
      extra: cf.has(3) || cf.has(4) || cf.unknown([1, 2, 3, 4, 5]).length > 0 || any.unknown([1, 2]).length > 0,
    };
  });
  return {
    bytes,
    refBlockBytes: f.bytes(1),
    refBlockNum: f.int(3),
    refBlockHash: f.bytes(4),
    expiration: f.int(8),
    data: f.bytes(10),
    contracts,
    timestamp: f.int(14),
    feeLimit: f.int(18),
    oddities,
  };
}

export const txIdOf = (raw: Uint8Array): Uint8Array => sha256(raw);

/** Bytes of bandwidth a signed transaction uses (java-tron BandwidthProcessor: size without `ret`, + 64 per contract). */
export function bandwidthBytes(rawLength: number, signatures = 1, contracts = 1): number {
  return 1 + varintLength(rawLength) + rawLength + signatures * 67 + contracts * 64;
}

/* ------------------------------------------------------------------ contract parameters */

const owner1 = (f: Fields) => f.bytes(1);

export interface TransferParams { owner: Uint8Array; to: Uint8Array; amount: bigint }
export interface TransferAssetParams { assetName: string; owner: Uint8Array; to: Uint8Array; amount: bigint }
export interface TriggerParams { owner: Uint8Array; contract: Uint8Array; callValue: bigint; data: Uint8Array; callTokenValue: bigint; tokenId: bigint }
export interface ResourceParams { owner: Uint8Array; amount: bigint; resource: bigint }
export interface DelegateParams { owner: Uint8Array; resource: bigint; balance: bigint; receiver: Uint8Array; lock: boolean; lockPeriod: bigint }
export interface VoteParams { owner: Uint8Array; votes: { address: Uint8Array; count: bigint }[] }
export interface PermissionKey { address: Uint8Array; weight: bigint }
export interface PermissionParams { type: bigint; id: bigint; name: string; threshold: bigint; operations: Uint8Array; keys: PermissionKey[] }
export interface PermissionUpdateParams { owner: Uint8Array; ownerPermission: PermissionParams | null; witness: PermissionParams | null; actives: PermissionParams[] }

export const parseTransfer = (v: Uint8Array): TransferParams => {
  const f = Fields.parse(v);
  return { owner: owner1(f), to: f.bytes(2), amount: f.int(3) };
};
export const parseTransferAsset = (v: Uint8Array): TransferAssetParams => {
  const f = Fields.parse(v);
  return { assetName: f.string(1), owner: f.bytes(2), to: f.bytes(3), amount: f.int(4) };
};
export const parseTrigger = (v: Uint8Array): TriggerParams => {
  const f = Fields.parse(v);
  return { owner: owner1(f), contract: f.bytes(2), callValue: f.int(3), data: f.bytes(4), callTokenValue: f.int(5), tokenId: f.int(6) };
};
/** FreezeBalanceV2 (frozen_balance = 2, resource = 3) and UnfreezeBalanceV2 (unfreeze_balance = 2, resource = 3). */
export const parseResource = (v: Uint8Array): ResourceParams => {
  const f = Fields.parse(v);
  return { owner: owner1(f), amount: f.int(2), resource: f.int(3) };
};
export const parseDelegate = (v: Uint8Array): DelegateParams => {
  const f = Fields.parse(v);
  return { owner: owner1(f), resource: f.int(2), balance: f.int(3), receiver: f.bytes(4), lock: f.bool(5), lockPeriod: f.int(6) };
};
export const parseVote = (v: Uint8Array): VoteParams => {
  const f = Fields.parse(v);
  return {
    owner: owner1(f),
    votes: f.repeated(2).map((x) => {
      const vf = Fields.parse(x);
      return { address: vf.bytes(1), count: vf.int(2) };
    }),
  };
};
export const parseOwnerOnly = (v: Uint8Array): { owner: Uint8Array } => ({ owner: owner1(Fields.parse(v)) });

function parsePermission(b: Uint8Array): PermissionParams {
  const f = Fields.parse(b);
  return {
    type: f.int(1),
    id: f.int(2),
    name: f.string(3),
    threshold: f.int(4),
    operations: f.bytes(6),
    keys: f.repeated(7).map((k) => {
      const kf = Fields.parse(k);
      return { address: kf.bytes(1), weight: kf.int(2) };
    }),
  };
}

export const parsePermissionUpdate = (v: Uint8Array): PermissionUpdateParams => {
  const f = Fields.parse(v);
  return {
    owner: owner1(f),
    ownerPermission: f.has(2) ? parsePermission(f.bytes(2)) : null,
    witness: f.has(3) ? parsePermission(f.bytes(3)) : null,
    actives: f.repeated(4).map(parsePermission),
  };
};

/** The account a contract acts for (its owner_address), or null for a type Clip doesn't explain. */
export function ownerOf(c: ContractEntry): Uint8Array | null {
  if (!c.name || !VALUE_FIELDS[c.name]) return null;
  return Fields.parse(c.value).bytes(VALUE_FIELDS[c.name]!.owner_address![0]);
}

/* ------------------------------------------------------------------ building */

export interface RefBlock {
  /** Block number. */
  number: bigint;
  /** 32-byte block id (hex). */
  blockId: string;
  /** Block timestamp (ms). */
  timestamp: bigint;
}

export interface BuildSpec {
  ref: RefBlock;
  expiration: bigint;
  timestamp: bigint;
  feeLimit?: bigint;
  memo?: string;
  name: ContractName;
  value: Uint8Array;
}

/** ref_block_bytes = bytes 6..8 of the 8-byte big-endian block number; ref_block_hash = bytes 8..16 of the block id. */
export function refBlockFields(ref: RefBlock): { refBlockBytes: Uint8Array; refBlockHash: Uint8Array } {
  const n = BigInt.asUintN(64, ref.number);
  const num = new Uint8Array(8);
  for (let i = 0; i < 8; i++) num[7 - i] = Number((n >> BigInt(8 * i)) & 0xffn);
  return { refBlockBytes: num.subarray(6, 8), refBlockHash: fromHex(ref.blockId).subarray(8, 16) };
}

export function encodeRaw(spec: BuildSpec): Uint8Array {
  const { refBlockBytes, refBlockHash } = refBlockFields(spec.ref);
  const any = new Writer().string(1, typeUrlOf(spec.name)).bytes(2, spec.value).finish();
  const contract = new Writer().int(1, CONTRACT_TYPES[spec.name]).message(2, any).finish();
  return new Writer()
    .bytes(1, refBlockBytes)
    .bytes(4, refBlockHash)
    .int(8, spec.expiration)
    .bytes(10, spec.memo ? utf8(spec.memo) : undefined)
    .message(11, contract)
    .int(14, spec.timestamp)
    .int(18, spec.feeLimit ?? 0n)
    .finish();
}

export const encodeTransfer = (owner: Uint8Array, to: Uint8Array, amount: bigint): Uint8Array => new Writer().bytes(1, owner).bytes(2, to).int(3, amount).finish();
export const encodeTrigger = (owner: Uint8Array, contract: Uint8Array, data: Uint8Array, callValue = 0n): Uint8Array =>
  new Writer().bytes(1, owner).bytes(2, contract).int(3, callValue).bytes(4, data).finish();

/* ------------------------------------------------------------------ TronWeb transaction objects */

/** A TronWeb transaction object (what `tronWeb.transactionBuilder.*` and /wallet/createtransaction return). */
export interface TronWebTx {
  txID?: string;
  raw_data?: Record<string, unknown>;
  raw_data_hex: string;
  visible?: boolean;
  signature?: string[];
}

export class TxShapeError extends Error {}

/**
 * The transaction a dapp handed over, from the Reown params ({ transaction }, or the legacy nested
 * { transaction: { transaction } }), or a TronWeb object directly.
 */
export function txObjectOf(x: unknown): TronWebTx {
  let t = x as Record<string, unknown> | null;
  for (let depth = 0; depth < 3 && t && typeof t === "object" && !("raw_data_hex" in t) && t.transaction && typeof t.transaction === "object"; depth++) {
    t = t.transaction as Record<string, unknown>;
  }
  if (!t || typeof t !== "object" || !isHex(t.raw_data_hex) || !(t.raw_data_hex as string).replace(/^0x/, "").length) {
    throw new TxShapeError("Expected a TRON transaction with raw_data_hex.");
  }
  if (t.txID !== undefined && !(typeof t.txID === "string" && /^(0x)?[0-9a-f]{64}$/i.test(t.txID))) throw new TxShapeError("txID isn't a 32-byte hash.");
  if (t.signature !== undefined && !(Array.isArray(t.signature) && t.signature.every((s) => isHex(s)))) throw new TxShapeError("signature isn't a list of hex strings.");
  return t as unknown as TronWebTx;
}

/**
 * Checks the JSON a dapp sent against the bytes that get signed. Only the hex is trusted (it's what the txID covers);
 * a JSON field that says something else means the request is lying about itself. Returns the mismatching fields.
 */
export function jsonMismatches(json: Record<string, unknown> | undefined, raw: RawTx): string[] {
  if (!json) return [];
  const bad: string[] = [];
  const eqHex = (k: string, want: Uint8Array) => {
    const v = json[k];
    if (v === undefined) return;
    if (!isHex(v) || !bytesEqual(fromHex(v), want)) bad.push(k);
  };
  const eqInt = (obj: Record<string, unknown>, k: string, want: bigint, label = k) => {
    const v = obj[k];
    if (v === undefined || v === null) {
      if (want !== 0n && k in obj) bad.push(label);
      return;
    }
    if (typeof v === "boolean" ? (v ? 1n : 0n) !== want : !(typeof v === "number" || typeof v === "string") || !/^-?\d+$/.test(String(v)) || BigInt(String(v)) !== want) bad.push(label);
  };
  eqHex("ref_block_bytes", raw.refBlockBytes);
  eqHex("ref_block_hash", raw.refBlockHash);
  eqHex("data", raw.data);
  eqInt(json, "expiration", raw.expiration);
  eqInt(json, "timestamp", raw.timestamp);
  eqInt(json, "fee_limit", raw.feeLimit);
  eqInt(json, "ref_block_num", raw.refBlockNum);
  const list = json.contract;
  if (list === undefined) return bad;
  if (!Array.isArray(list) || list.length !== raw.contracts.length) return [...bad, "contract"];
  list.forEach((c, i) => {
    const want = raw.contracts[i]!;
    const cj = (c ?? {}) as Record<string, unknown>;
    if (cj.type !== undefined && cj.type !== want.name && cj.type !== want.type) bad.push(`contract[${i}].type`);
    eqInt(cj, "Permission_id", BigInt(want.permissionId), `contract[${i}].Permission_id`);
    const p = (cj.parameter ?? {}) as Record<string, unknown>;
    if (p.type_url !== undefined && p.type_url !== want.typeUrl) bad.push(`contract[${i}].type_url`);
    const value = p.value;
    if (value === undefined || !want.name) return;
    if (!value || typeof value !== "object") {
      bad.push(`contract[${i}].value`);
      return;
    }
    for (const k of valueMismatches(want.name, want.value, value as Record<string, unknown>)) bad.push(`contract[${i}].${k}`);
  });
  return bad;
}

/** Field name → (field number, kind) for the contract values Clip explains. */
const VALUE_FIELDS: Partial<Record<ContractName, Record<string, [number, "addr" | "int" | "bytes" | "asset" | "resource" | "bool"]>>> = {
  TransferContract: { owner_address: [1, "addr"], to_address: [2, "addr"], amount: [3, "int"] },
  TransferAssetContract: { asset_name: [1, "asset"], owner_address: [2, "addr"], to_address: [3, "addr"], amount: [4, "int"] },
  TriggerSmartContract: { owner_address: [1, "addr"], contract_address: [2, "addr"], call_value: [3, "int"], data: [4, "bytes"], call_token_value: [5, "int"], token_id: [6, "int"] },
  FreezeBalanceV2Contract: { owner_address: [1, "addr"], frozen_balance: [2, "int"], resource: [3, "resource"] },
  UnfreezeBalanceV2Contract: { owner_address: [1, "addr"], unfreeze_balance: [2, "int"], resource: [3, "resource"] },
  WithdrawExpireUnfreezeContract: { owner_address: [1, "addr"] },
  CancelAllUnfreezeV2Contract: { owner_address: [1, "addr"] },
  WithdrawBalanceContract: { owner_address: [1, "addr"] },
  DelegateResourceContract: { owner_address: [1, "addr"], resource: [2, "resource"], balance: [3, "int"], receiver_address: [4, "addr"], lock: [5, "bool"], lock_period: [6, "int"] },
  UnDelegateResourceContract: { owner_address: [1, "addr"], resource: [2, "resource"], balance: [3, "int"], receiver_address: [4, "addr"] },
  VoteWitnessContract: { owner_address: [1, "addr"] },
  AccountPermissionUpdateContract: { owner_address: [1, "addr"] },
};

function valueMismatches(name: ContractName, value: Uint8Array, json: Record<string, unknown>): string[] {
  const spec = VALUE_FIELDS[name];
  if (!spec) return [];
  const f = Fields.parse(value);
  const bad: string[] = [];
  for (const [k, [no, kind]] of Object.entries(spec)) {
    const v = json[k];
    if (v === undefined || v === null) {
      // Absent in JSON = proto3 default. Only a non-default value in the bytes is a mismatch.
      const present = kind === "addr" || kind === "bytes" || kind === "asset" ? f.bytes(no).length > 0 : f.int(no) !== 0n;
      if (present && k in json) bad.push(k);
      continue;
    }
    switch (kind) {
      case "addr": {
        const b = typeof v === "string" ? addressBytes(v) : null;
        if (!b || !bytesEqual(b, f.bytes(no))) bad.push(k);
        break;
      }
      case "bytes":
        if (!isHex(v) || !bytesEqual(fromHex(v), f.bytes(no))) bad.push(k);
        break;
      case "asset": {
        // visible=true: the token id as text; visible=false: its hex.
        const want = f.bytes(no);
        if (typeof v !== "string" || !(bytesEqual(utf8(v), want) || (isHex(v) && bytesEqual(fromHex(v), want)))) bad.push(k);
        break;
      }
      case "resource": {
        const want = f.int(no);
        if (!(v === resourceName(want) || v === Number(want))) bad.push(k);
        break;
      }
      case "bool":
        if (typeof v !== "boolean" || v !== f.bool(no)) bad.push(k);
        break;
      case "int":
        if (!(typeof v === "number" || typeof v === "string") || !/^-?\d+$/.test(String(v)) || BigInt(String(v)) !== f.int(no)) bad.push(k);
        break;
    }
  }
  return bad;
}

/** "T…" for 21 address bytes, or the hex if they aren't a TRON address. */
export function showAddress(b: Uint8Array): string {
  try {
    return encodeAddress(b);
  } catch {
    return hex(b);
  }
}

export { ProtoError };
