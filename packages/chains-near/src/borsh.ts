/**
 * Hand-rolled borsh for NEAR transactions (no borsh dependency).
 *
 * Layouts follow nearcore (core/primitives/src/transaction.rs `TransactionV0`, core/primitives/src/action/mod.rs
 * `Action`, core/primitives-core/src/account.rs `AccessKeyPermission`) and match @near-js/transactions' SCHEMA:
 *
 *   Transaction (V0) = signerId: string, publicKey: PublicKey, nonce: u64, receiverId: string,
 *                      blockHash: [u8; 32], actions: Vec<Action>
 *   SignedTransaction = transaction, signature: Signature (u8 keyType 0 + 64 bytes for ed25519)
 *   PublicKey = u8 keyType (0 ed25519 → 32 bytes, 1 secp256k1 → 64 bytes)
 *   Action = u8 tag: CreateAccount 0, DeployContract 1, FunctionCall 2, Transfer 3, Stake 4, AddKey 5,
 *            DeleteKey 6, DeleteAccount 7, Delegate 8, DeployGlobalContract 9, UseGlobalContract 10,
 *            (11+ newer variants: decoded as unknown → blind)
 *   AccessKey = nonce: u64, permission: u8 (0 FunctionCall { allowance: Option<u128>, receiverId, methodNames },
 *               1 FullAccess; 2/3 gas keys → unknown)
 *
 * A TransactionV1 (1u8 tag + struct + nonce mode) is recognised but not decoded.
 */
import { base58 } from "@scure/base";
import { concat } from "./util.js";

export interface PublicKey {
  keyType: 0 | 1;
  data: Uint8Array;
}

export type AccessKeyPermission = "FullAccess" | { allowance: bigint | null; receiverId: string; methodNames: string[] };

export interface DelegateAction {
  senderId: string;
  receiverId: string;
  actions: Action[];
  nonce: bigint;
  maxBlockHeight: bigint;
  publicKey: PublicKey;
}

export type Action =
  | { kind: "CreateAccount" }
  | { kind: "DeployContract"; code: Uint8Array }
  | { kind: "FunctionCall"; methodName: string; args: Uint8Array; gas: bigint; deposit: bigint }
  | { kind: "Transfer"; deposit: bigint }
  | { kind: "Stake"; stake: bigint; publicKey: PublicKey }
  | { kind: "AddKey"; publicKey: PublicKey; accessKey: { nonce: bigint; permission: AccessKeyPermission } }
  | { kind: "DeleteKey"; publicKey: PublicKey }
  | { kind: "DeleteAccount"; beneficiaryId: string }
  | { kind: "Delegate"; delegateAction: DelegateAction; signature: { keyType: number; data: Uint8Array } }
  | { kind: "DeployGlobalContract"; code: Uint8Array; deployMode: "CodeHash" | "AccountId" }
  | { kind: "UseGlobalContract"; contractIdentifier: { codeHash: Uint8Array } | { accountId: string } }
  /** Only produced by decoding: an action this module can't read. Everything after it is unreadable too. */
  | { kind: "Unknown"; tag: number };

export interface Transaction {
  signerId: string;
  publicKey: PublicKey;
  nonce: bigint;
  receiverId: string;
  blockHash: Uint8Array;
  actions: Action[];
}

/* ------------------------------------------------------------------ public keys */

export function publicKeyToString(pk: PublicKey): string {
  return `${pk.keyType === 0 ? "ed25519" : "secp256k1"}:${base58.encode(pk.data)}`;
}

export function parsePublicKey(s: string): PublicKey {
  const m = /^(?:(ed25519|secp256k1):)?([1-9A-HJ-NP-Za-km-z]+)$/.exec(s.trim());
  if (!m) throw new Error("bad public key");
  const keyType = m[1] === "secp256k1" ? 1 : 0;
  const data = base58.decode(m[2]!);
  if (data.length !== (keyType === 0 ? 32 : 64)) throw new Error("bad public key length");
  return { keyType, data };
}

export function samePublicKey(a: PublicKey, b: PublicKey): boolean {
  return a.keyType === b.keyType && a.data.length === b.data.length && a.data.every((x, i) => x === b.data[i]);
}

/* ------------------------------------------------------------------ writer */

class Writer {
  private parts: Uint8Array[] = [];
  u8(v: number) {
    this.parts.push(Uint8Array.of(v));
  }
  u32(v: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, true);
    this.parts.push(b);
  }
  uint(v: bigint, bytes: number) {
    if (v < 0n || v >= 1n << BigInt(bytes * 8)) throw new Error("integer out of range");
    const b = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i++) b[i] = Number((v >> BigInt(8 * i)) & 0xffn);
    this.parts.push(b);
  }
  u64(v: bigint) {
    this.uint(v, 8);
  }
  u128(v: bigint) {
    this.uint(v, 16);
  }
  fixed(b: Uint8Array) {
    this.parts.push(b);
  }
  bytes(b: Uint8Array) {
    this.u32(b.length);
    this.parts.push(b);
  }
  string(s: string) {
    this.bytes(new TextEncoder().encode(s));
  }
  done(): Uint8Array {
    return concat(...this.parts);
  }
}

function writePublicKey(w: Writer, pk: PublicKey) {
  w.u8(pk.keyType);
  w.fixed(pk.data);
}

function writeAction(w: Writer, a: Action) {
  switch (a.kind) {
    case "CreateAccount":
      w.u8(0);
      return;
    case "DeployContract":
      w.u8(1);
      w.bytes(a.code);
      return;
    case "FunctionCall":
      w.u8(2);
      w.string(a.methodName);
      w.bytes(a.args);
      w.u64(a.gas);
      w.u128(a.deposit);
      return;
    case "Transfer":
      w.u8(3);
      w.u128(a.deposit);
      return;
    case "Stake":
      w.u8(4);
      w.u128(a.stake);
      writePublicKey(w, a.publicKey);
      return;
    case "AddKey": {
      w.u8(5);
      writePublicKey(w, a.publicKey);
      w.u64(a.accessKey.nonce);
      const p = a.accessKey.permission;
      if (p === "FullAccess") w.u8(1);
      else {
        w.u8(0);
        if (p.allowance === null) w.u8(0);
        else {
          w.u8(1);
          w.u128(p.allowance);
        }
        w.string(p.receiverId);
        w.u32(p.methodNames.length);
        for (const m of p.methodNames) w.string(m);
      }
      return;
    }
    case "DeleteKey":
      w.u8(6);
      writePublicKey(w, a.publicKey);
      return;
    case "DeleteAccount":
      w.u8(7);
      w.string(a.beneficiaryId);
      return;
    case "Delegate": {
      w.u8(8);
      const d = a.delegateAction;
      w.string(d.senderId);
      w.string(d.receiverId);
      w.u32(d.actions.length);
      for (const x of d.actions) writeAction(w, x);
      w.u64(d.nonce);
      w.u64(d.maxBlockHeight);
      writePublicKey(w, d.publicKey);
      w.u8(a.signature.keyType);
      w.fixed(a.signature.data);
      return;
    }
    case "DeployGlobalContract":
      w.u8(9);
      w.bytes(a.code);
      w.u8(a.deployMode === "CodeHash" ? 0 : 1);
      return;
    case "UseGlobalContract":
      w.u8(10);
      if ("codeHash" in a.contractIdentifier) {
        w.u8(0);
        w.fixed(a.contractIdentifier.codeHash);
      } else {
        w.u8(1);
        w.string(a.contractIdentifier.accountId);
      }
      return;
    case "Unknown":
      throw new Error("can't encode an unknown action");
  }
}

export function encodeTransaction(tx: Transaction): Uint8Array {
  if (tx.blockHash.length !== 32) throw new Error("block hash must be 32 bytes");
  const w = new Writer();
  w.string(tx.signerId);
  writePublicKey(w, tx.publicKey);
  w.u64(tx.nonce);
  w.string(tx.receiverId);
  w.fixed(tx.blockHash);
  w.u32(tx.actions.length);
  for (const a of tx.actions) writeAction(w, a);
  return w.done();
}

/** SignedTransaction = borsh(tx) || keyType 0 || 64-byte ed25519 signature. */
export function encodeSignedTransaction(txBytes: Uint8Array, signature: Uint8Array): Uint8Array {
  if (signature.length !== 64) throw new Error("ed25519 signature must be 64 bytes");
  return concat(txBytes, Uint8Array.of(0), signature);
}

/* ------------------------------------------------------------------ reader */

class Reader {
  o = 0;
  constructor(private readonly b: Uint8Array) {}
  private need(n: number) {
    if (this.o + n > this.b.length) throw new Error("unexpected end of data");
  }
  u8(): number {
    this.need(1);
    return this.b[this.o++]!;
  }
  u32(): number {
    this.need(4);
    const v = new DataView(this.b.buffer, this.b.byteOffset + this.o, 4).getUint32(0, true);
    this.o += 4;
    return v;
  }
  uint(bytes: number): bigint {
    this.need(bytes);
    let v = 0n;
    for (let i = bytes - 1; i >= 0; i--) v = (v << 8n) | BigInt(this.b[this.o + i]!);
    this.o += bytes;
    return v;
  }
  fixed(n: number): Uint8Array {
    this.need(n);
    const out = this.b.slice(this.o, this.o + n);
    this.o += n;
    return out;
  }
  bytes(): Uint8Array {
    return this.fixed(this.u32());
  }
  string(): string {
    return new TextDecoder("utf-8", { fatal: true }).decode(this.bytes());
  }
  get rest(): number {
    return this.b.length - this.o;
  }
}

function readPublicKey(r: Reader): PublicKey {
  const t = r.u8();
  if (t === 0) return { keyType: 0, data: r.fixed(32) };
  if (t === 1) return { keyType: 1, data: r.fixed(64) };
  throw new Error(`unknown key type ${t}`);
}

class UnknownAction extends Error {
  constructor(public readonly tag: number) {
    super(`unknown action ${tag}`);
  }
}

function readAction(r: Reader): Action {
  const tag = r.u8();
  switch (tag) {
    case 0:
      return { kind: "CreateAccount" };
    case 1:
      return { kind: "DeployContract", code: r.bytes() };
    case 2:
      return { kind: "FunctionCall", methodName: r.string(), args: r.bytes(), gas: r.uint(8), deposit: r.uint(16) };
    case 3:
      return { kind: "Transfer", deposit: r.uint(16) };
    case 4:
      return { kind: "Stake", stake: r.uint(16), publicKey: readPublicKey(r) };
    case 5: {
      const publicKey = readPublicKey(r);
      const nonce = r.uint(8);
      const p = r.u8();
      if (p === 1) return { kind: "AddKey", publicKey, accessKey: { nonce, permission: "FullAccess" } };
      if (p !== 0) throw new UnknownAction(5);
      const allowance = r.u8() === 1 ? r.uint(16) : null;
      const receiverId = r.string();
      const n = r.u32();
      const methodNames: string[] = [];
      for (let i = 0; i < n; i++) methodNames.push(r.string());
      return { kind: "AddKey", publicKey, accessKey: { nonce, permission: { allowance, receiverId, methodNames } } };
    }
    case 6:
      return { kind: "DeleteKey", publicKey: readPublicKey(r) };
    case 7:
      return { kind: "DeleteAccount", beneficiaryId: r.string() };
    case 8: {
      const senderId = r.string();
      const receiverId = r.string();
      const n = r.u32();
      const actions: Action[] = [];
      for (let i = 0; i < n; i++) actions.push(readAction(r));
      const nonce = r.uint(8);
      const maxBlockHeight = r.uint(8);
      const publicKey = readPublicKey(r);
      const keyType = r.u8();
      const signature = { keyType, data: r.fixed(keyType === 0 ? 64 : 65) };
      return { kind: "Delegate", delegateAction: { senderId, receiverId, actions, nonce, maxBlockHeight, publicKey }, signature };
    }
    case 9: {
      const code = r.bytes();
      const m = r.u8();
      if (m > 1) throw new UnknownAction(9);
      return { kind: "DeployGlobalContract", code, deployMode: m === 0 ? "CodeHash" : "AccountId" };
    }
    case 10: {
      const t = r.u8();
      if (t === 0) return { kind: "UseGlobalContract", contractIdentifier: { codeHash: r.fixed(32) } };
      if (t === 1) return { kind: "UseGlobalContract", contractIdentifier: { accountId: r.string() } };
      throw new UnknownAction(10);
    }
    default:
      throw new UnknownAction(tag);
  }
}

/**
 * Decodes a borsh TransactionV0. Malformed bytes throw. An action the module doesn't know ends the action list
 * with `{ kind: "Unknown" }` (the transaction is still signable; decode() marks it blind).
 */
export function decodeTransaction(bytes: Uint8Array): Transaction {
  if (bytes.length > 1 && bytes[1] !== 0 && bytes[0] === 1) throw new Error("TransactionV1 isn't supported");
  const r = new Reader(bytes);
  const signerId = r.string();
  const publicKey = readPublicKey(r);
  const nonce = r.uint(8);
  const receiverId = r.string();
  const blockHash = r.fixed(32);
  const n = r.u32();
  const actions: Action[] = [];
  for (let i = 0; i < n; i++) {
    try {
      actions.push(readAction(r));
    } catch (e) {
      if (e instanceof UnknownAction) {
        actions.push({ kind: "Unknown", tag: e.tag });
        return { signerId, publicKey, nonce, receiverId, blockHash, actions };
      }
      throw e;
    }
  }
  if (r.rest !== 0) throw new Error("trailing bytes after the transaction");
  return { signerId, publicKey, nonce, receiverId, blockHash, actions };
}

/** Splits a borsh SignedTransaction into its transaction bytes and ed25519 signature. */
export function decodeSignedTransaction(bytes: Uint8Array): { tx: Transaction; txBytes: Uint8Array; signature: Uint8Array } {
  if (bytes.length < 65 || bytes[bytes.length - 65] !== 0) throw new Error("not an ed25519-signed transaction");
  const txBytes = bytes.slice(0, bytes.length - 65);
  return { tx: decodeTransaction(txBytes), txBytes, signature: bytes.slice(bytes.length - 64) };
}

