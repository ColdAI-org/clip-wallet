import {
  WIRE_LEN,
  Writer,
  asInt32,
  asInt64,
  eachField,
  readRepeatedVarint,
  unzigzag,
  utf8,
} from "./wire.js";

/**
 * Hand-written codec for the Hedera API (HAPI) messages the wallet builds or reads. Field numbers come from
 * hashgraph/hedera-protobufs at tag v0.77.2 (https://github.com/hashgraph/hedera-protobufs/tree/v0.77.2);
 * each block cites its file. Nothing else of HAPI is modelled: unknown fields are skipped when reading and
 * kept byte-for-byte when a body is re-framed (see tx.ts).
 */

/* ----------------------------------------------------------------- basic types (services/basic_types.proto) */

/** AccountID { int64 shardNum = 1; int64 realmNum = 2; oneof account { int64 accountNum = 3; bytes alias = 4; } } */
export interface AccountIdP {
  shard: bigint;
  realm: bigint;
  num?: bigint;
  alias?: Uint8Array;
}

/** TokenID / ScheduleID / TopicID { shardNum = 1; realmNum = 2; <x>Num = 3 }; ContractID adds `bytes evm_address = 4`. */
export interface EntityIdP {
  shard: bigint;
  realm: bigint;
  num: bigint;
  evm?: Uint8Array;
}

/** services/timestamp.proto: Timestamp { int64 seconds = 1; int32 nanos = 2; } */
export interface TimestampP {
  seconds: bigint;
  nanos: number;
}

/** TransactionID { Timestamp transactionValidStart = 1; AccountID accountID = 2; bool scheduled = 3; int32 nonce = 4; } */
export interface TransactionIdP {
  validStart?: TimestampP;
  accountId?: AccountIdP;
  scheduled?: boolean;
  nonce?: number;
}

export function encodeAccountId(a: AccountIdP): Uint8Array {
  // The SDK writes shard/realm always, then the account number or (hollow account) the alias.
  return new Writer().int(1, a.shard).int(2, a.realm).int(3, a.alias ? null : (a.num ?? 0n)).bytes(4, a.alias ?? null).finish();
}

export function decodeAccountId(b: Uint8Array): AccountIdP {
  const a: AccountIdP = { shard: 0n, realm: 0n };
  eachField(b, (f, w, r) => {
    if (f === 1) a.shard = asInt64(r.varint());
    else if (f === 2) a.realm = asInt64(r.varint());
    else if (f === 3) {
      a.num = asInt64(r.varint());
      delete a.alias;
    } else if (f === 4 && w === WIRE_LEN) {
      a.alias = r.bytes();
      delete a.num;
    }
  });
  return a;
}

export function encodeEntityId(e: EntityIdP): Uint8Array {
  return new Writer().int(1, e.shard).int(2, e.realm).int(3, e.evm ? null : e.num).bytes(4, e.evm ?? null).finish();
}

export function decodeEntityId(b: Uint8Array): EntityIdP {
  const e: EntityIdP = { shard: 0n, realm: 0n, num: 0n };
  eachField(b, (f, w, r) => {
    if (f === 1) e.shard = asInt64(r.varint());
    else if (f === 2) e.realm = asInt64(r.varint());
    else if (f === 3) e.num = asInt64(r.varint());
    else if (f === 4 && w === WIRE_LEN) e.evm = r.bytes();
  });
  return e;
}

export function encodeTimestamp(t: TimestampP): Uint8Array {
  return new Writer().int(1, t.seconds).int(2, t.nanos).finish();
}

export function decodeTimestamp(b: Uint8Array): TimestampP {
  const t: TimestampP = { seconds: 0n, nanos: 0 };
  eachField(b, (f, _w, r) => {
    if (f === 1) t.seconds = asInt64(r.varint());
    else if (f === 2) t.nanos = asInt32(r.varint());
  });
  return t;
}

/** services/duration.proto: Duration { int64 seconds = 1; } */
export function encodeDuration(seconds: bigint | number): Uint8Array {
  return new Writer().int(1, seconds).finish();
}

export function decodeDuration(b: Uint8Array): bigint {
  let s = 0n;
  eachField(b, (f, _w, r) => {
    if (f === 1) s = asInt64(r.varint());
  });
  return s;
}

export function encodeTransactionId(t: TransactionIdP): Uint8Array {
  return new Writer()
    .message(1, t.validStart ? encodeTimestamp(t.validStart) : null)
    .message(2, t.accountId ? encodeAccountId(t.accountId) : null)
    .bool(3, t.scheduled ?? false)
    .int(4, t.nonce ?? null)
    .finish();
}

export function decodeTransactionId(b: Uint8Array): TransactionIdP {
  const t: TransactionIdP = {};
  eachField(b, (f, w, r) => {
    if (f === 1 && w === WIRE_LEN) t.validStart = decodeTimestamp(r.bytes());
    else if (f === 2 && w === WIRE_LEN) t.accountId = decodeAccountId(r.bytes());
    else if (f === 3) t.scheduled = r.varint() !== 0n;
    else if (f === 4) t.nonce = asInt32(r.varint());
  });
  return t;
}

/** google/protobuf/wrappers.proto: BoolValue/Int32Value/UInt32Value/StringValue { value = 1; } */
function wrapperVarint(b: Uint8Array): bigint {
  let v = 0n;
  eachField(b, (f, _w, r) => {
    if (f === 1) v = r.varint();
  });
  return v;
}
function wrapperString(b: Uint8Array): string {
  let v = "";
  eachField(b, (f, w, r) => {
    if (f === 1 && w === WIRE_LEN) v = utf8(r.bytes());
  });
  return v;
}

/* ----------------------------------------------------------------- transaction body (services/transaction.proto) */

/**
 * TransactionBody.data oneof field numbers (services/transaction.proto) mapped to the protobufjs names the SDK
 * reports, plus the SchedulableTransactionBody number for the same case (services/schedulable_transaction_body.proto).
 */
export const BODY = {
  contractCall: 7,
  contractCreateInstance: 8,
  contractUpdateInstance: 9,
  cryptoCreateAccount: 11,
  cryptoDelete: 12,
  cryptoTransfer: 14,
  cryptoUpdateAccount: 15,
  consensusSubmitMessage: 27,
  tokenAssociate: 40,
  tokenDissociate: 41,
  scheduleCreate: 42,
  scheduleDelete: 43,
  scheduleSign: 44,
  cryptoApproveAllowance: 48,
  cryptoDeleteAllowance: 49,
} as const;

/** Every TransactionBody data case (services/transaction.proto, `oneof data`), field number → name. */
const BODY_NAMES =
  "7 contractCall,8 contractCreateInstance,9 contractUpdateInstance,10 cryptoAddLiveHash,11 cryptoCreateAccount,12 cryptoDelete," +
  "13 cryptoDeleteLiveHash,14 cryptoTransfer,15 cryptoUpdateAccount,16 fileAppend,17 fileCreate,18 fileDelete,19 fileUpdate," +
  "20 systemDelete,21 systemUndelete,22 contractDeleteInstance,23 freeze,24 consensusCreateTopic,25 consensusUpdateTopic," +
  "26 consensusDeleteTopic,27 consensusSubmitMessage,28 uncheckedSubmit,29 tokenCreation,31 tokenFreeze,32 tokenUnfreeze," +
  "33 tokenGrantKyc,34 tokenRevokeKyc,35 tokenDeletion,36 tokenUpdate,37 tokenMint,38 tokenBurn,39 tokenWipe,40 tokenAssociate," +
  "41 tokenDissociate,42 scheduleCreate,43 scheduleDelete,44 scheduleSign,45 tokenFeeScheduleUpdate,46 tokenPause,47 tokenUnpause," +
  "48 cryptoApproveAllowance,49 cryptoDeleteAllowance,50 ethereumTransaction,51 nodeStakeUpdate,52 utilPrng,53 tokenUpdateNfts," +
  "54 nodeCreate,55 nodeUpdate,56 nodeDelete,57 tokenReject,58 tokenAirdrop,59 tokenCancelAirdrop,60 tokenClaimAirdrop," +
  "65 stateSignatureTransaction,66 hintsPreprocessingVote,67 hintsKeyPublication,68 hintsPartialSignature,69 historyProofSignature," +
  "70 historyProofKeyPublication,71 historyProofVote,72 crsPublication,74 atomicBatch,75 hookStore,76 hookDispatch," +
  "77 ledgerIdPublication,78 registeredNodeCreate,79 registeredNodeUpdate,80 registeredNodeDelete,81 migrationRootHashVote";
export const BODY_NAME = new Map<number, string>(
  BODY_NAMES.split(",").map((s) => {
    const [n, name] = s.split(" ");
    return [Number(n), name!];
  }),
);

/**
 * SchedulableTransactionBody.data field number (services/schedulable_transaction_body.proto) → TransactionBody
 * field number of the same case.
 */
const SCHEDULABLE_TO_BODY = new Map<number, number>(
  (
    "3 7,4 8,5 9,6 22,7 11,8 12,9 14,10 15,11 16,12 17,13 18,14 19,15 20,16 21,17 23,18 24,19 25,20 26,21 27,22 29,23 31,24 32," +
    "25 33,26 34,27 35,28 36,29 37,30 38,31 39,32 40,33 41,34 43,35 46,36 47,37 48,38 49,39 45,40 52,41 53,42 54,43 55,44 56," +
    "45 57,46 59,47 60,48 58,49 78,50 79,51 80"
  )
    .split(",")
    .map((s) => s.split(" ").map(Number) as [number, number]),
);
const BODY_TO_SCHEDULABLE = new Map<number, number>([...SCHEDULABLE_TO_BODY].map(([s, b]) => [b, s]));

/** TransactionBody header fields 1–6 + the data case. Fields we don't model stay in the original bytes. */
export interface BodyP {
  transactionId?: TransactionIdP;
  nodeAccountId?: AccountIdP;
  /** uint64 transactionFee = 3 (tinybars) */
  fee?: bigint;
  /** Duration transactionValidDuration = 4 */
  validDuration?: bigint;
  memo?: string;
  /** TransactionBody data field number (7…81), or 0 when no data field is set. */
  kind: number;
  /** The encoded data message. */
  data: Uint8Array;
}

/**
 * TransactionBody { TransactionID transactionID = 1; AccountID nodeAccountID = 2; uint64 transactionFee = 3;
 * Duration transactionValidDuration = 4; bool generateRecord = 5 (deprecated); string memo = 6; oneof data { … } }.
 * With `schedulable`, reads a SchedulableTransactionBody { uint64 transactionFee = 1; string memo = 2; oneof data { … } }
 * and reports its data case with the TransactionBody field number.
 */
export function decodeBody(b: Uint8Array, schedulable = false): BodyP {
  const body: BodyP = { kind: 0, data: new Uint8Array() };
  eachField(b, (f, w, r) => {
    if (schedulable) {
      if (f === 1) body.fee = r.varint();
      else if (f === 2 && w === WIRE_LEN) body.memo = utf8(r.bytes());
      else if (w === WIRE_LEN && SCHEDULABLE_TO_BODY.has(f)) {
        body.kind = SCHEDULABLE_TO_BODY.get(f)!;
        body.data = r.bytes();
      }
      return;
    }
    if (f === 1 && w === WIRE_LEN) body.transactionId = decodeTransactionId(r.bytes());
    else if (f === 2 && w === WIRE_LEN) body.nodeAccountId = decodeAccountId(r.bytes());
    else if (f === 3) body.fee = r.varint();
    else if (f === 4 && w === WIRE_LEN) body.validDuration = decodeDuration(r.bytes());
    else if (f === 6 && w === WIRE_LEN) body.memo = utf8(r.bytes());
    else if (w === WIRE_LEN && BODY_NAME.has(f)) {
      body.kind = f;
      body.data = r.bytes();
    }
  });
  return body;
}

/** The SDK's body: transactionID, nodeAccountID, transactionFee, transactionValidDuration, memo, then the data case. */
export function encodeBody(p: {
  transactionId?: TransactionIdP | null;
  nodeAccountId?: AccountIdP | null;
  fee?: bigint | null;
  validDuration?: bigint | number | null;
  memo?: string | null;
  kind: number;
  data: Uint8Array;
}): Uint8Array {
  return new Writer()
    .message(1, p.transactionId ? encodeTransactionId(p.transactionId) : null)
    .message(2, p.nodeAccountId ? encodeAccountId(p.nodeAccountId) : null)
    .int(3, p.fee ?? null)
    .message(4, p.validDuration != null ? encodeDuration(p.validDuration) : null)
    .string(6, p.memo ?? null)
    .message(p.kind, p.data)
    .finish();
}

/** SchedulableTransactionBody as the SDK writes it for ScheduleCreate: fee, memo, data. */
export function encodeSchedulableBody(p: { fee: bigint; memo: string; kind: number; data: Uint8Array }): Uint8Array {
  const n = BODY_TO_SCHEDULABLE.get(p.kind);
  if (n == null) throw new Error(`transaction kind ${p.kind} can't be scheduled`);
  return new Writer().int(1, p.fee).string(2, p.memo).message(n, p.data).finish();
}

/* ----------------------------------------------------------------- transfers (crypto_transfer.proto, basic_types.proto) */

/**
 * AccountAmount { AccountID accountID = 1; sint64 amount = 2; bool is_approval = 3;
 *   oneof hook_call { HookCall pre_tx_allowance_hook = 4; HookCall pre_post_tx_allowance_hook = 5; } }
 */
export interface AccountAmountP {
  accountId?: AccountIdP;
  amount: bigint;
  isApproval: boolean;
  hook: boolean;
}

/**
 * NftTransfer { AccountID senderAccountID = 1; AccountID receiverAccountID = 2; int64 serialNumber = 3; bool is_approval = 4;
 *   sender hooks 5/6, receiver hooks 7/8 }
 */
export interface NftTransferP {
  sender?: AccountIdP;
  receiver?: AccountIdP;
  serial: bigint;
  isApproval: boolean;
  hook: boolean;
}

/** TokenTransferList { TokenID token = 1; repeated AccountAmount transfers = 2; repeated NftTransfer nftTransfers = 3; UInt32Value expected_decimals = 4; } */
export interface TokenTransferListP {
  token?: EntityIdP;
  transfers: AccountAmountP[];
  nfts: NftTransferP[];
  expectedDecimals?: number;
}

/** CryptoTransferTransactionBody { TransferList transfers = 1; repeated TokenTransferList tokenTransfers = 2; }; TransferList { repeated AccountAmount accountAmounts = 1; } */
export interface CryptoTransferP {
  hbar: AccountAmountP[];
  tokens: TokenTransferListP[];
}

function decodeAccountAmount(b: Uint8Array): AccountAmountP {
  const a: AccountAmountP = { amount: 0n, isApproval: false, hook: false };
  eachField(b, (f, w, r) => {
    if (f === 1 && w === WIRE_LEN) a.accountId = decodeAccountId(r.bytes());
    else if (f === 2) a.amount = unzigzag(r.varint());
    else if (f === 3) a.isApproval = r.varint() !== 0n;
    else if (f === 4 || f === 5) a.hook = true;
  });
  return a;
}

function decodeNftTransfer(b: Uint8Array): NftTransferP {
  const n: NftTransferP = { serial: 0n, isApproval: false, hook: false };
  eachField(b, (f, w, r) => {
    if (f === 1 && w === WIRE_LEN) n.sender = decodeAccountId(r.bytes());
    else if (f === 2 && w === WIRE_LEN) n.receiver = decodeAccountId(r.bytes());
    else if (f === 3) n.serial = asInt64(r.varint());
    else if (f === 4) n.isApproval = r.varint() !== 0n;
    else if (f >= 5 && f <= 8) n.hook = true;
  });
  return n;
}

export function decodeCryptoTransfer(b: Uint8Array): CryptoTransferP {
  const out: CryptoTransferP = { hbar: [], tokens: [] };
  eachField(b, (f, w, r) => {
    if (f === 1 && w === WIRE_LEN) {
      eachField(r.bytes(), (f2, w2, r2) => {
        if (f2 === 1 && w2 === WIRE_LEN) out.hbar.push(decodeAccountAmount(r2.bytes()));
      });
    } else if (f === 2 && w === WIRE_LEN) {
      const t: TokenTransferListP = { transfers: [], nfts: [] };
      eachField(r.bytes(), (f2, w2, r2) => {
        if (f2 === 1 && w2 === WIRE_LEN) t.token = decodeEntityId(r2.bytes());
        else if (f2 === 2 && w2 === WIRE_LEN) t.transfers.push(decodeAccountAmount(r2.bytes()));
        else if (f2 === 3 && w2 === WIRE_LEN) t.nfts.push(decodeNftTransfer(r2.bytes()));
        else if (f2 === 4 && w2 === WIRE_LEN) t.expectedDecimals = Number(wrapperVarint(r2.bytes()));
      });
      out.tokens.push(t);
    }
  });
  return out;
}

export function encodeAccountAmount(a: { accountId: AccountIdP; amount: bigint; isApproval: boolean }): Uint8Array {
  return new Writer().message(1, encodeAccountId(a.accountId)).sint64(2, a.amount).bool(3, a.isApproval).finish();
}

export function encodeNftTransfer(n: { sender: AccountIdP; receiver: AccountIdP; serial: bigint; isApproval: boolean }): Uint8Array {
  return new Writer()
    .message(1, encodeAccountId(n.sender))
    .message(2, encodeAccountId(n.receiver))
    .int(3, n.serial)
    .bool(4, n.isApproval)
    .finish();
}

export interface TokenTransferListIn {
  token: EntityIdP;
  expectedDecimals: number | null;
  transfers: { accountId: AccountIdP; amount: bigint; isApproval: boolean }[];
  nfts: { sender: AccountIdP; receiver: AccountIdP; serial: bigint; isApproval: boolean }[];
}

export function encodeCryptoTransfer(p: { hbar: { accountId: AccountIdP; amount: bigint; isApproval: boolean }[]; tokens: TokenTransferListIn[] }): Uint8Array {
  const transfers = new Writer();
  for (const a of p.hbar) transfers.message(1, encodeAccountAmount(a));
  const w = new Writer().message(1, transfers.finish()); // the SDK always sets `transfers`, even when empty
  for (const t of p.tokens) {
    const tw = new Writer().message(1, encodeEntityId(t.token));
    for (const a of t.transfers) tw.message(2, encodeAccountAmount(a));
    for (const n of t.nfts) tw.message(3, encodeNftTransfer(n));
    if (t.expectedDecimals != null) tw.message(4, new Writer().int(1, t.expectedDecimals).finish());
    w.message(2, tw.finish());
  }
  return w.finish();
}

/* ----------------------------------------------------------------- token association (token_associate.proto, token_dissociate.proto) */

/** Token(Dis)associateTransactionBody { AccountID account = 1; repeated TokenID tokens = 2; } */
export interface AssociateP {
  account?: AccountIdP;
  tokens: EntityIdP[];
}

export function decodeAssociate(b: Uint8Array): AssociateP {
  const out: AssociateP = { tokens: [] };
  eachField(b, (f, w, r) => {
    if (f === 1 && w === WIRE_LEN) out.account = decodeAccountId(r.bytes());
    else if (f === 2 && w === WIRE_LEN) out.tokens.push(decodeEntityId(r.bytes()));
  });
  return out;
}

export function encodeAssociate(p: { account: AccountIdP; tokens: EntityIdP[] }): Uint8Array {
  const w = new Writer().message(1, encodeAccountId(p.account));
  for (const t of p.tokens) w.message(2, encodeEntityId(t));
  return w.finish();
}

/* ----------------------------------------------------------------- allowances (crypto_approve_allowance.proto, crypto_delete_allowance.proto) */

/** CryptoAllowance { AccountID owner = 1; AccountID spender = 2; int64 amount = 3; } */
export interface CryptoAllowanceP {
  owner?: AccountIdP;
  spender?: AccountIdP;
  amount: bigint;
}
/** TokenAllowance { TokenID tokenId = 1; AccountID owner = 2; AccountID spender = 3; int64 amount = 4; } */
export interface TokenAllowanceP {
  tokenId?: EntityIdP;
  owner?: AccountIdP;
  spender?: AccountIdP;
  amount: bigint;
}
/**
 * NftAllowance { TokenID tokenId = 1; AccountID owner = 2; AccountID spender = 3; repeated int64 serial_numbers = 4;
 *   BoolValue approved_for_all = 5; AccountID delegating_spender = 6; }
 */
export interface NftAllowanceP {
  tokenId?: EntityIdP;
  owner?: AccountIdP;
  spender?: AccountIdP;
  serials: bigint[];
  approvedForAll?: boolean;
}
/** CryptoApproveAllowanceTransactionBody { repeated CryptoAllowance cryptoAllowances = 1; repeated NftAllowance nftAllowances = 2; repeated TokenAllowance tokenAllowances = 3; } */
export interface ApproveAllowanceP {
  hbar: CryptoAllowanceP[];
  nft: NftAllowanceP[];
  token: TokenAllowanceP[];
}

export function decodeApproveAllowance(b: Uint8Array): ApproveAllowanceP {
  const out: ApproveAllowanceP = { hbar: [], nft: [], token: [] };
  eachField(b, (f, w, r) => {
    if (w !== WIRE_LEN) return;
    const m = r.bytes();
    if (f === 1) {
      const a: CryptoAllowanceP = { amount: 0n };
      eachField(m, (g, gw, gr) => {
        if (g === 1 && gw === WIRE_LEN) a.owner = decodeAccountId(gr.bytes());
        else if (g === 2 && gw === WIRE_LEN) a.spender = decodeAccountId(gr.bytes());
        else if (g === 3) a.amount = asInt64(gr.varint());
      });
      out.hbar.push(a);
    } else if (f === 2) {
      const a: NftAllowanceP = { serials: [] };
      eachField(m, (g, gw, gr) => {
        if (g === 1 && gw === WIRE_LEN) a.tokenId = decodeEntityId(gr.bytes());
        else if (g === 2 && gw === WIRE_LEN) a.owner = decodeAccountId(gr.bytes());
        else if (g === 3 && gw === WIRE_LEN) a.spender = decodeAccountId(gr.bytes());
        else if (g === 4) readRepeatedVarint(gw, gr, a.serials);
        else if (g === 5 && gw === WIRE_LEN) a.approvedForAll = wrapperVarint(gr.bytes()) !== 0n;
      });
      out.nft.push(a);
    } else if (f === 3) {
      const a: TokenAllowanceP = { amount: 0n };
      eachField(m, (g, gw, gr) => {
        if (g === 1 && gw === WIRE_LEN) a.tokenId = decodeEntityId(gr.bytes());
        else if (g === 2 && gw === WIRE_LEN) a.owner = decodeAccountId(gr.bytes());
        else if (g === 3 && gw === WIRE_LEN) a.spender = decodeAccountId(gr.bytes());
        else if (g === 4) a.amount = asInt64(gr.varint());
      });
      out.token.push(a);
    }
  });
  return out;
}

export function encodeApproveAllowance(p: {
  hbar?: { owner: AccountIdP | null; spender: AccountIdP | null; amount: bigint | null }[];
  token?: { tokenId: EntityIdP; owner: AccountIdP | null; spender: AccountIdP | null; amount: bigint }[];
}): Uint8Array {
  const w = new Writer();
  for (const a of p.hbar ?? []) {
    w.message(
      1,
      new Writer()
        .message(1, a.owner ? encodeAccountId(a.owner) : null)
        .message(2, a.spender ? encodeAccountId(a.spender) : null)
        .int(3, a.amount)
        .finish(),
    );
  }
  for (const a of p.token ?? []) {
    w.message(
      3,
      new Writer()
        .message(1, encodeEntityId(a.tokenId))
        .message(2, a.owner ? encodeAccountId(a.owner) : null)
        .message(3, a.spender ? encodeAccountId(a.spender) : null)
        .int(4, a.amount)
        .finish(),
    );
  }
  return w.finish();
}

/** CryptoDeleteAllowanceTransactionBody { repeated NftRemoveAllowance nftAllowances = 2; }; NftRemoveAllowance { TokenID token_id = 1; AccountID owner = 2; repeated int64 serial_numbers = 3; } */
export function decodeDeleteAllowance(b: Uint8Array): { tokenId?: EntityIdP; owner?: AccountIdP; serials: bigint[] }[] {
  const out: { tokenId?: EntityIdP; owner?: AccountIdP; serials: bigint[] }[] = [];
  eachField(b, (f, w, r) => {
    if (f !== 2 || w !== WIRE_LEN) return;
    const a: { tokenId?: EntityIdP; owner?: AccountIdP; serials: bigint[] } = { serials: [] };
    eachField(r.bytes(), (g, gw, gr) => {
      if (g === 1 && gw === WIRE_LEN) a.tokenId = decodeEntityId(gr.bytes());
      else if (g === 2 && gw === WIRE_LEN) a.owner = decodeAccountId(gr.bytes());
      else if (g === 3) readRepeatedVarint(gw, gr, a.serials);
    });
    out.push(a);
  });
  return out;
}

/* ----------------------------------------------------------------- contract call (contract_call.proto) */

/** ContractCallTransactionBody { ContractID contractID = 1; int64 gas = 2; int64 amount = 3; bytes functionParameters = 4; } */
export interface ContractCallP {
  contractId?: EntityIdP;
  gas: bigint;
  amount: bigint;
  params: Uint8Array;
}

export function decodeContractCall(b: Uint8Array): ContractCallP {
  const c: ContractCallP = { gas: 0n, amount: 0n, params: new Uint8Array() };
  eachField(b, (f, w, r) => {
    if (f === 1 && w === WIRE_LEN) c.contractId = decodeEntityId(r.bytes());
    else if (f === 2) c.gas = asInt64(r.varint());
    else if (f === 3) c.amount = asInt64(r.varint());
    else if (f === 4 && w === WIRE_LEN) c.params = r.bytes();
  });
  return c;
}

export function encodeContractCall(p: { contractId: EntityIdP; gas: bigint | null; amount: bigint | null; params: Uint8Array | null }): Uint8Array {
  return new Writer().message(1, encodeEntityId(p.contractId)).int(2, p.gas).int(3, p.amount).bytes(4, p.params).finish();
}

/* ----------------------------------------------------------------- account update (crypto_update.proto) */

/**
 * CryptoUpdateTransactionBody { AccountID accountIDToUpdate = 2; Key key = 3; …; Duration autoRenewPeriod = 8;
 *   Timestamp expirationTime = 9; bool receiverSigRequired = 10 (deprecated); BoolValue receiverSigRequiredWrapper = 13;
 *   StringValue memo = 14; Int32Value max_automatic_token_associations = 15;
 *   oneof staked_id { AccountID staked_account_id = 16; int64 staked_node_id = 17; } BoolValue decline_reward = 18;
 *   repeated int64 hook_ids_to_delete = 19; repeated HookCreationDetails hook_creation_details = 20; bytes delegation_address = 21; }
 */
export interface CryptoUpdateP {
  account?: AccountIdP;
  hasKey: boolean;
  autoRenewSeconds?: bigint;
  expiration?: TimestampP;
  receiverSigRequired?: boolean;
  memo?: string;
  maxAutoAssociations?: number;
  stakedAccount?: AccountIdP;
  stakedNode?: bigint;
  declineReward?: boolean;
  hooksCreated: number;
  hooksDeleted: number;
  delegation: boolean;
}

export function decodeCryptoUpdate(b: Uint8Array): CryptoUpdateP {
  const u: CryptoUpdateP = { hasKey: false, hooksCreated: 0, hooksDeleted: 0, delegation: false };
  eachField(b, (f, w, r) => {
    if (f === 2 && w === WIRE_LEN) u.account = decodeAccountId(r.bytes());
    else if (f === 3) u.hasKey = true;
    else if (f === 8 && w === WIRE_LEN) u.autoRenewSeconds = decodeDuration(r.bytes());
    else if (f === 9 && w === WIRE_LEN) u.expiration = decodeTimestamp(r.bytes());
    else if (f === 10) u.receiverSigRequired = r.varint() !== 0n;
    else if (f === 13 && w === WIRE_LEN) u.receiverSigRequired = wrapperVarint(r.bytes()) !== 0n;
    else if (f === 14 && w === WIRE_LEN) u.memo = wrapperString(r.bytes());
    else if (f === 15 && w === WIRE_LEN) u.maxAutoAssociations = asInt32(wrapperVarint(r.bytes()));
    else if (f === 16 && w === WIRE_LEN) {
      u.stakedAccount = decodeAccountId(r.bytes());
      delete u.stakedNode;
    } else if (f === 17) {
      u.stakedNode = asInt64(r.varint());
      delete u.stakedAccount;
    } else if (f === 18 && w === WIRE_LEN) u.declineReward = wrapperVarint(r.bytes()) !== 0n;
    else if (f === 19) {
      const ids: bigint[] = [];
      readRepeatedVarint(w, r, ids);
      u.hooksDeleted += ids.length;
    } else if (f === 20) u.hooksCreated++;
    else if (f === 21 && w === WIRE_LEN) u.delegation = r.bytes().length > 0;
  });
  return u;
}

/** Only the fields the wallet sets (staking). Written in field order like the SDK. */
export function encodeCryptoUpdate(p: { account: AccountIdP; stakedAccount?: AccountIdP | null; stakedNode?: bigint | null; declineReward?: boolean | null }): Uint8Array {
  return new Writer()
    .message(2, encodeAccountId(p.account))
    .message(16, p.stakedAccount ? encodeAccountId(p.stakedAccount) : null)
    .int(17, p.stakedNode ?? null)
    .message(18, p.declineReward != null ? new Writer().bool(1, p.declineReward).finish() : null)
    .finish();
}

/* ----------------------------------------------------------------- schedules (schedule_create.proto, schedule_sign.proto) */

/**
 * ScheduleCreateTransactionBody { SchedulableTransactionBody scheduledTransactionBody = 1; string memo = 2; Key adminKey = 3;
 *   AccountID payerAccountID = 4; Timestamp expiration_time = 5; bool wait_for_expiry = 13; }
 */
export interface ScheduleCreateP {
  scheduled?: Uint8Array;
  memo?: string;
  hasAdminKey: boolean;
  payer?: AccountIdP;
  expiration?: TimestampP;
  waitForExpiry?: boolean;
}

export function decodeScheduleCreate(b: Uint8Array): ScheduleCreateP {
  const s: ScheduleCreateP = { hasAdminKey: false };
  eachField(b, (f, w, r) => {
    if (f === 1 && w === WIRE_LEN) s.scheduled = r.bytes();
    else if (f === 2 && w === WIRE_LEN) s.memo = utf8(r.bytes());
    else if (f === 3) s.hasAdminKey = true;
    else if (f === 4 && w === WIRE_LEN) s.payer = decodeAccountId(r.bytes());
    else if (f === 5 && w === WIRE_LEN) s.expiration = decodeTimestamp(r.bytes());
    else if (f === 13) s.waitForExpiry = r.varint() !== 0n;
  });
  return s;
}

export function encodeScheduleCreate(p: { scheduled: Uint8Array; memo: string | null; payer: AccountIdP | null; expiration: TimestampP | null; waitForExpiry: boolean | null }): Uint8Array {
  return new Writer()
    .message(1, p.scheduled)
    .string(2, p.memo)
    .message(4, p.payer ? encodeAccountId(p.payer) : null)
    .message(5, p.expiration ? encodeTimestamp(p.expiration) : null)
    .bool(13, p.waitForExpiry)
    .finish();
}

/** ScheduleSignTransactionBody { ScheduleID scheduleID = 1; } */
export function decodeScheduleSign(b: Uint8Array): EntityIdP | undefined {
  let id: EntityIdP | undefined;
  eachField(b, (f, w, r) => {
    if (f === 1 && w === WIRE_LEN) id = decodeEntityId(r.bytes());
  });
  return id;
}

export function encodeScheduleSign(id: EntityIdP): Uint8Array {
  return new Writer().message(1, encodeEntityId(id)).finish();
}

/* ----------------------------------------------------------------- consensus & delete (consensus_submit_message.proto, crypto_delete.proto) */

/** ConsensusSubmitMessageTransactionBody { TopicID topicID = 1; bytes message = 2; ConsensusMessageChunkInfo chunkInfo = 3; } */
export function decodeSubmitMessage(b: Uint8Array): { topicId?: EntityIdP; message: Uint8Array } {
  const out: { topicId?: EntityIdP; message: Uint8Array } = { message: new Uint8Array() };
  eachField(b, (f, w, r) => {
    if (f === 1 && w === WIRE_LEN) out.topicId = decodeEntityId(r.bytes());
    else if (f === 2 && w === WIRE_LEN) out.message = r.bytes();
  });
  return out;
}

/** CryptoDeleteTransactionBody { AccountID transferAccountID = 1; AccountID deleteAccountID = 2; } */
export function decodeCryptoDelete(b: Uint8Array): { transferAccount?: AccountIdP; deleteAccount?: AccountIdP } {
  const out: { transferAccount?: AccountIdP; deleteAccount?: AccountIdP } = {};
  eachField(b, (f, w, r) => {
    if (f === 1 && w === WIRE_LEN) out.transferAccount = decodeAccountId(r.bytes());
    else if (f === 2 && w === WIRE_LEN) out.deleteAccount = decodeAccountId(r.bytes());
  });
  return out;
}

/* ----------------------------------------------------------------- signatures & envelopes */

/**
 * SignaturePair { bytes pubKeyPrefix = 1; oneof signature { bytes contract = 2; bytes ed25519 = 3; bytes RSA_3072 = 4;
 *   bytes ECDSA_384 = 5; bytes ECDSA_secp256k1 = 6; } }  (basic_types.proto)
 */
export function encodeEcdsaSignaturePair(prefix: Uint8Array, signature: Uint8Array): Uint8Array {
  return new Writer().bytes(1, prefix).bytes(6, signature).finish();
}

export function signaturePairPrefix(pair: Uint8Array): Uint8Array {
  let prefix: Uint8Array = new Uint8Array();
  eachField(pair, (f, w, r) => {
    if (f === 1 && w === WIRE_LEN) prefix = r.bytes();
  });
  return prefix;
}

/** The ECDSA_secp256k1 signature of a pair, if that's what it holds. */
export function signaturePairEcdsa(pair: Uint8Array): Uint8Array | null {
  let sig: Uint8Array | null = null;
  eachField(pair, (f, w, r) => {
    if (f === 6 && w === WIRE_LEN) sig = r.bytes();
  });
  return sig;
}

/** SignatureMap { repeated SignaturePair sigPair = 1; } → the encoded pairs. */
export function decodeSignatureMap(b: Uint8Array): Uint8Array[] {
  const pairs: Uint8Array[] = [];
  eachField(b, (f, w, r) => {
    if (f === 1 && w === WIRE_LEN) pairs.push(r.bytes());
  });
  return pairs;
}

export function encodeSignatureMap(pairs: Uint8Array[]): Uint8Array {
  const w = new Writer();
  for (const p of pairs) w.message(1, p);
  return w.finish();
}

/** services/transaction_contents.proto: SignedTransaction { bytes bodyBytes = 1; SignatureMap sigMap = 2; bool use_serialized_tx_message_hash_algorithm = 3; } */
export interface SignedTransactionP {
  bodyBytes: Uint8Array;
  sigPairs: Uint8Array[];
  hasSigMap: boolean;
  useSerializedHash?: boolean;
}

export function decodeSignedTransaction(b: Uint8Array): SignedTransactionP {
  const s: SignedTransactionP = { bodyBytes: new Uint8Array(), sigPairs: [], hasSigMap: false };
  eachField(b, (f, w, r) => {
    if (f === 1 && w === WIRE_LEN) s.bodyBytes = r.bytes();
    else if (f === 2 && w === WIRE_LEN) {
      s.hasSigMap = true;
      s.sigPairs.push(...decodeSignatureMap(r.bytes()));
    } else if (f === 3) s.useSerializedHash = r.varint() !== 0n;
  });
  return s;
}

export function encodeSignedTransaction(s: { bodyBytes: Uint8Array; sigPairs: Uint8Array[]; useSerializedHash?: boolean }): Uint8Array {
  return new Writer().bytes(1, s.bodyBytes).message(2, encodeSignatureMap(s.sigPairs)).bool(3, s.useSerializedHash ?? null).finish();
}

/**
 * services/transaction.proto: Transaction { TransactionBody body = 1 (deprecated); SignatureList sigs = 2 (deprecated);
 *   SignatureMap sigMap = 3 (deprecated); bytes bodyBytes = 4 (deprecated); bytes signedTransactionBytes = 5; }
 */
export interface TransactionP {
  signedTransactionBytes?: Uint8Array;
  bodyBytes?: Uint8Array;
  sigMap?: Uint8Array;
  hasBody: boolean;
}

export function decodeTransaction(b: Uint8Array): TransactionP {
  const t: TransactionP = { hasBody: false };
  eachField(b, (f, w, r) => {
    if (w !== WIRE_LEN) return;
    if (f === 1) {
      t.hasBody = true;
      r.bytes();
    } else if (f === 3) t.sigMap = r.bytes();
    else if (f === 4) t.bodyBytes = r.bytes();
    else if (f === 5) t.signedTransactionBytes = r.bytes();
  });
  return t;
}

export function encodeTransaction(signedTransactionBytes: Uint8Array): Uint8Array {
  return new Writer().bytes(5, signedTransactionBytes).finish();
}

/** sdk/transaction_list.proto: TransactionList { repeated Transaction transaction_list = 1; } */
export function decodeTransactionList(b: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  eachField(b, (f, w, r) => {
    if (f === 1 && w === WIRE_LEN) out.push(r.bytes());
  });
  return out;
}

export function encodeTransactionList(signedTransactions: Uint8Array[]): Uint8Array {
  const w = new Writer();
  for (const s of signedTransactions) w.message(1, encodeTransaction(s));
  return w.finish();
}

/** services/transaction_response.proto: TransactionResponse { ResponseCodeEnum nodeTransactionPrecheckCode = 1; uint64 cost = 2; } */
export function decodeTransactionResponse(b: Uint8Array): { precheckCode: number; cost: bigint } {
  const out = { precheckCode: 0, cost: 0n };
  eachField(b, (f, _w, r) => {
    if (f === 1) out.precheckCode = asInt32(r.varint());
    else if (f === 2) out.cost = r.varint();
  });
  return out;
}

/** services/query.proto `oneof query` field number → name (what hedera_signAndExecuteQuery asks for). */
const QUERY_NAMES =
  "1 getByKey,2 getBySolidityID,3 contractCallLocal,4 contractGetInfo,5 contractGetBytecode,6 ContractGetRecords," +
  "7 cryptogetAccountBalance,8 cryptoGetAccountRecords,9 cryptoGetInfo,10 cryptoGetLiveHash,11 cryptoGetProxyStakers," +
  "12 fileGetContents,13 fileGetInfo,14 transactionGetReceipt,15 transactionGetRecord,16 transactionGetFastRecord," +
  "50 consensusGetTopicInfo,51 networkGetVersionInfo,52 tokenGetInfo,53 scheduleGetInfo,54 tokenGetAccountNftInfos," +
  "55 tokenGetNftInfo,56 tokenGetNftInfos,57 networkGetExecutionTime,58 accountDetails";
const QUERY_NAME = new Map<number, string>(
  QUERY_NAMES.split(",").map((s) => {
    const [n, name] = s.split(" ");
    return [Number(n), name!];
  }),
);

export function queryKind(b: Uint8Array): string | null {
  let kind: string | null = null;
  eachField(b, (f) => {
    kind = QUERY_NAME.get(f) ?? kind;
  });
  return kind;
}
