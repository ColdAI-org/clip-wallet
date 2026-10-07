import { C, type CType, type CValue } from "./candid.js";
import { formatUnits } from "./util.js";

/**
 * Candid types of the ledger methods this module calls. ICRC-1: https://github.com/dfinity/ICRC-1/blob/main/standards/ICRC-1/ICRC-1.did
 * (the ICRC-1 ledger's rs/ledger_suite/icrc1/ledger/ledger.did and the ICP ledger's rs/ledger_suite/icp/ledger.did in
 * dfinity/ic). ICP's legacy `transfer` (to a 32-byte account identifier): rs/ledger_suite/icp/ledger.did.
 */
export const Account = C.record({ owner: C.principal, subaccount: C.opt(C.blob) });

export const TransferArg = C.record({
  from_subaccount: C.opt(C.blob),
  to: Account,
  amount: C.nat,
  fee: C.opt(C.nat),
  memo: C.opt(C.blob),
  created_at_time: C.opt(C.nat64),
});

export const TransferError = C.variant({
  BadFee: C.record({ expected_fee: C.nat }),
  BadBurn: C.record({ min_burn_amount: C.nat }),
  InsufficientFunds: C.record({ balance: C.nat }),
  TooOld: C.null,
  CreatedInFuture: C.record({ ledger_time: C.nat64 }),
  TemporarilyUnavailable: C.null,
  Duplicate: C.record({ duplicate_of: C.nat }),
  GenericError: C.record({ error_code: C.nat, message: C.text }),
});

export const TransferResult = C.variant({ Ok: C.nat, Err: TransferError });

const Tokens = C.record({ e8s: C.nat64 });

export const LegacyTransferArgs = C.record({
  memo: C.nat64,
  amount: Tokens,
  fee: Tokens,
  from_subaccount: C.opt(C.blob),
  to: C.blob,
  created_at_time: C.opt(C.record({ timestamp_nanos: C.nat64 })),
});

export const LegacyTransferError = C.variant({
  BadFee: C.record({ expected_fee: Tokens }),
  InsufficientFunds: C.record({ balance: Tokens }),
  TxTooOld: C.record({ allowed_window_nanos: C.nat64 }),
  TxCreatedInFuture: C.null,
  TxDuplicate: C.record({ duplicate_of: C.nat64 }),
});

export const LegacyTransferResult = C.variant({ Ok: C.nat64, Err: LegacyTransferError });

export interface TransferMethod {
  method: "icrc1_transfer" | "transfer";
  arg: CType;
  result: CType;
}

export const METHODS: Record<"icrc1_transfer" | "transfer", TransferMethod> = {
  icrc1_transfer: { method: "icrc1_transfer", arg: TransferArg, result: TransferResult },
  transfer: { method: "transfer", arg: LegacyTransferArgs, result: LegacyTransferResult },
};

/** A ledger's Err case in plain words. */
export function plainTransferError(err: Record<string, CValue>, symbol: string, decimals: number): string {
  const [kind, v] = Object.entries(err)[0] ?? ["", null];
  const rec = (v ?? {}) as Record<string, CValue>;
  const amount = (x: CValue | undefined) => {
    const n = typeof x === "bigint" ? x : x && typeof x === "object" && "e8s" in x ? (x.e8s as bigint) : 0n;
    return `${formatUnits(n, decimals)} ${symbol}`;
  };
  switch (kind) {
    case "InsufficientFunds":
      return `You don't have enough ${symbol} for this and its fee. Your balance is ${amount(rec.balance)}. Nothing was sent.`;
    case "BadFee":
      return `The ${symbol} network fee changed to ${amount(rec.expected_fee)}. Nothing was sent. Try again.`;
    case "TooOld":
    case "TxTooOld":
      return "This transfer waited too long and expired. Nothing was sent. Try again.";
    case "CreatedInFuture":
    case "TxCreatedInFuture":
      return "Your device's clock is ahead of the network's. Nothing was sent. Check your clock and try again.";
    case "Duplicate":
    case "TxDuplicate":
      return "This exact transfer was already sent, so it wasn't sent again.";
    case "TemporarilyUnavailable":
      return "The ledger is busy right now. Nothing was sent. Try again in a minute.";
    case "BadBurn":
      return `That amount is too small to send to the token's minting account. Nothing was sent.`;
    default:
      return `The ${symbol} ledger refused this transfer. Nothing was sent.`;
  }
}
