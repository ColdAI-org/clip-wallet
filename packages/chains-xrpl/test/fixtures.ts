/**
 * The public "abandon … about" test account at m/44'/144'/0'/0/0 (what xrpl.js Wallet.fromMnemonic gives for the
 * phrase) and the transactions the tests sign. Only public keys, addresses and transaction JSON live here.
 */
import { RLUSD_CODE } from "../src/networks.js";

export const ME = "rHsMGQEkVNJmpGWs8XUBoTBiAAbwxZN5v3";
export const PUB = "031D68BC1A142E6766B2BDFB006CCFE135EF2E0E2E94ABB5CF5C9AB6104776FBAE";
/** Arbitrary valid addresses nobody here holds keys for. */
export const BOB = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe";
export const EXCHANGE = "rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv";
export const NEWBIE = "r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59";
export const RLUSD_ISSUER = "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV";

/** Ledger values the mocked servers answer with. */
export const SEQ = 21000001;
export const LEDGER = 21322680;
export const LLS = LEDGER + 20;
export const OPEN_LEDGER_FEE = "12";

const filled = { Account: ME, Fee: OPEN_LEDGER_FEE, Sequence: SEQ, LastLedgerSequence: LLS, SigningPubKey: PUB, Flags: 0 };

/** buildTransfer: 1.5 XRP to BOB. */
export const XRP_SEND = { TransactionType: "Payment", ...filled, Destination: BOB, Amount: "1500000" };
/** buildTransfer: 2.5 RLUSD to BOB. */
export const RLUSD_SEND = { TransactionType: "Payment", ...filled, Destination: BOB, Amount: { currency: RLUSD_CODE, issuer: RLUSD_ISSUER, value: "2.5" } };
/** A dapp's AccountSet with a memo, left for the wallet to autofill (Sequence, Fee, LastLedgerSequence). */
export const DAPP_UNFILLED = { TransactionType: "AccountSet", Account: ME, Memos: [{ Memo: { MemoData: "68656C6C6F20787270" } }] };
export const DAPP_FILLED = { ...DAPP_UNFILLED, Sequence: SEQ, Fee: OPEN_LEDGER_FEE, LastLedgerSequence: LLS, SigningPubKey: PUB };
