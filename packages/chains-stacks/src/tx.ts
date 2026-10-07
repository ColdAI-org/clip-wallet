import { sha512_256 } from "@noble/hashes/sha2.js";
import { c32address, parseAddress, parseAssetId, parseContractId, CLARITY_NAME, CONTRACT_NAME } from "./c32.js";
import { type CV, principalBytes, readCV, serializeCV } from "./clarity.js";
import { Reader, concat, uintBE, utf8 } from "./util.js";

/**
 * Stacks transactions, hand-written from SIP-005 ("Transaction Encoding",
 * https://github.com/stacksgov/sips/blob/main/sips/sip-005/sip-005-blocks-and-transactions.md) and cross-checked
 * byte for byte against @stacks/transactions 7.6 in the tests (serializeTransaction, txid, sigHashPreSign).
 *
 *   version(1: 0x00 mainnet, 0x80 testnet) ‖ chain id(4) ‖ authorization ‖ anchor mode(1) ‖ post-condition mode(1)
 *   ‖ post-conditions(u32 count + each) ‖ payload
 */

export const AUTH_STANDARD = 0x04;
export const AUTH_SPONSORED = 0x05;
export const HASH_MODE_P2PKH = 0x00;
export const KEY_COMPRESSED = 0x00;
export const ANCHOR_ANY = 0x03;
export const PC_MODE = { allow: 0x01, deny: 0x02, originator: 0x03 } as const;
export const MEMO_BYTES = 34;

export const FT_CODES = { eq: 0x01, gt: 0x02, gte: 0x03, lt: 0x04, lte: 0x05 } as const;
export const NFT_CODES = { sent: 0x10, "not-sent": 0x11, "maybe-sent": 0x12 } as const;
export const POX_CODES = { "will-not-perform": 0x30, "may-perform": 0x31, "will-perform": 0x32 } as const;

export interface SingleSig {
  hashMode: number;
  signer: Uint8Array;
  nonce: bigint;
  fee: bigint;
  keyEncoding: number;
  /** 65 bytes, recovery id ‖ r ‖ s ("VRS", stacks.js `createMessageSignature`); all zero before signing. */
  signature: Uint8Array;
}

export interface MultiSig {
  hashMode: number;
  signer: Uint8Array;
  nonce: bigint;
  fee: bigint;
  fields: { type: number; data: Uint8Array }[];
  required: number;
}

export type SpendingCondition = ({ kind: "single" } & SingleSig) | ({ kind: "multi" } & MultiSig);

export interface Auth {
  type: typeof AUTH_STANDARD | typeof AUTH_SPONSORED;
  origin: SpendingCondition;
  sponsor?: SpendingCondition;
}

export type PcPrincipal = { kind: "origin" } | { kind: "standard"; address: string } | { kind: "contract"; contract: string };

export interface AssetInfo {
  /** "SP….contract" */
  contract: string;
  assetName: string;
}

export type PostCondition =
  | { type: "stx"; principal: PcPrincipal; code: number; amount: bigint }
  | { type: "ft"; principal: PcPrincipal; asset: AssetInfo; code: number; amount: bigint }
  | { type: "nft"; principal: PcPrincipal; asset: AssetInfo; assetId: CV; code: number }
  /** SIP-045 (Epoch 4.0): staking (code + µSTX) and PoX (code only). */
  | { type: "staking"; principal: PcPrincipal; code: number; amount: bigint }
  | { type: "pox"; principal: PcPrincipal; code: number };

export type Payload =
  | { type: "token-transfer"; recipient: CV; amount: bigint; memo: Uint8Array }
  | { type: "contract-call"; contract: string; functionName: string; args: CV[] }
  | { type: "smart-contract"; name: string; code: string; clarityVersion?: number };

export interface StacksTx {
  version: number;
  chainId: number;
  auth: Auth;
  anchorMode: number;
  postConditionMode: number;
  postConditions: PostCondition[];
  payload: Payload;
}

const EMPTY_SIG = () => new Uint8Array(65);

/* ------------------------------------------------------------------ serialize */

function lp1(s: string): Uint8Array {
  const b = utf8(s);
  if (b.length > 128) throw new Error("name too long");
  return concat(new Uint8Array([b.length]), b);
}

function serializeCondition(c: SpendingCondition): Uint8Array {
  const head = concat(new Uint8Array([c.hashMode]), c.signer, uintBE(c.nonce, 8), uintBE(c.fee, 8));
  if (c.kind === "single") {
    if (c.signature.length !== 65) throw new Error("bad signature length");
    return concat(head, new Uint8Array([c.keyEncoding]), c.signature);
  }
  return concat(
    head,
    uintBE(BigInt(c.fields.length), 4),
    ...c.fields.map((f) => concat(new Uint8Array([f.type]), f.data)),
    uintBE(BigInt(c.required), 2),
  );
}

function serializeAuth(a: Auth): Uint8Array {
  if (a.type === AUTH_SPONSORED) {
    if (!a.sponsor) throw new Error("sponsored transaction without a sponsor condition");
    return concat(new Uint8Array([a.type]), serializeCondition(a.origin), serializeCondition(a.sponsor));
  }
  return concat(new Uint8Array([a.type]), serializeCondition(a.origin));
}

function serializePcPrincipal(p: PcPrincipal): Uint8Array {
  if (p.kind === "origin") return new Uint8Array([0x01]);
  if (p.kind === "standard") return concat(new Uint8Array([0x02]), principalBytes(p.address));
  const c = parseContractId(p.contract);
  if (!c) throw new Error("bad contract principal");
  return concat(new Uint8Array([0x03, c.version]), c.hash160, lp1(c.name));
}

function serializeAsset(a: AssetInfo): Uint8Array {
  const c = parseContractId(a.contract);
  if (!c) throw new Error("bad asset contract");
  return concat(new Uint8Array([c.version]), c.hash160, lp1(c.name), lp1(a.assetName));
}

export function serializePostCondition(pc: PostCondition): Uint8Array {
  const typeByte = { stx: 0x00, ft: 0x01, nft: 0x02, staking: 0x03, pox: 0x04 }[pc.type];
  const parts = [new Uint8Array([typeByte]), serializePcPrincipal(pc.principal)];
  if (pc.type === "ft" || pc.type === "nft") parts.push(serializeAsset(pc.asset));
  if (pc.type === "nft") parts.push(serializeCV(pc.assetId));
  parts.push(new Uint8Array([pc.code]));
  if (pc.type === "stx" || pc.type === "ft" || pc.type === "staking") parts.push(uintBE(pc.amount, 8));
  return concat(...parts);
}

export function serializePayload(p: Payload): Uint8Array {
  switch (p.type) {
    case "token-transfer": {
      if (p.memo.length !== MEMO_BYTES) throw new Error("memo must be 34 bytes");
      return concat(new Uint8Array([0x00]), serializeCV(p.recipient), uintBE(p.amount, 8), p.memo);
    }
    case "contract-call": {
      const c = parseContractId(p.contract);
      if (!c) throw new Error("bad contract");
      return concat(
        new Uint8Array([0x02, c.version]),
        c.hash160,
        lp1(c.name),
        lp1(p.functionName),
        uintBE(BigInt(p.args.length), 4),
        ...p.args.map(serializeCV),
      );
    }
    case "smart-contract": {
      const code = utf8(p.code);
      const body = concat(lp1(p.name), uintBE(BigInt(code.length), 4), code);
      return p.clarityVersion === undefined ? concat(new Uint8Array([0x01]), body) : concat(new Uint8Array([0x06, p.clarityVersion]), body);
    }
  }
}

export function serializeTx(tx: StacksTx): Uint8Array {
  return concat(
    new Uint8Array([tx.version]),
    uintBE(BigInt(tx.chainId), 4),
    serializeAuth(tx.auth),
    new Uint8Array([tx.anchorMode, tx.postConditionMode]),
    uintBE(BigInt(tx.postConditions.length), 4),
    ...tx.postConditions.map(serializePostCondition),
    serializePayload(tx.payload),
  );
}

/** Transaction id: SHA-512/256 of the serialized transaction (hex, no 0x). */
export function txidOf(tx: StacksTx | Uint8Array): Uint8Array {
  return sha512_256(tx instanceof Uint8Array ? tx : serializeTx(tx));
}

/* ------------------------------------------------------------------ deserialize */

function readCondition(r: Reader): SpendingCondition {
  const hashMode = r.u8();
  const signer = r.read(20).slice();
  const nonce = r.u64();
  const fee = r.u64();
  if (hashMode === 0x00 || hashMode === 0x02) {
    const keyEncoding = r.u8();
    if (keyEncoding !== 0x00 && keyEncoding !== 0x01) throw new Error("bad key encoding");
    return { kind: "single", hashMode, signer, nonce, fee, keyEncoding, signature: r.read(65).slice() };
  }
  if (hashMode === 0x01 || hashMode === 0x03 || hashMode === 0x05 || hashMode === 0x07) {
    const n = r.u32();
    if (n > 64) throw new Error("too many multisig fields");
    const fields: { type: number; data: Uint8Array }[] = [];
    for (let i = 0; i < n; i++) {
      const type = r.u8();
      if (type > 0x03) throw new Error("bad auth field");
      fields.push({ type, data: r.read(type <= 0x01 ? 33 : 65).slice() });
    }
    return { kind: "multi", hashMode, signer, nonce, fee, fields, required: r.u16() };
  }
  throw new Error("unknown hash mode");
}

function readPcPrincipal(r: Reader): PcPrincipal {
  const kind = r.u8();
  if (kind === 0x01) return { kind: "origin" };
  const version = r.u8();
  const address = c32address(version, r.read(20));
  if (kind === 0x02) return { kind: "standard", address };
  if (kind === 0x03) {
    const name = new TextDecoder().decode(r.read(r.u8()));
    if (!CONTRACT_NAME.test(name)) throw new Error("bad contract name");
    return { kind: "contract", contract: `${address}.${name}` };
  }
  throw new Error("bad post-condition principal");
}

function readAsset(r: Reader): AssetInfo {
  const version = r.u8();
  const address = c32address(version, r.read(20));
  const contractName = new TextDecoder().decode(r.read(r.u8()));
  const assetName = new TextDecoder().decode(r.read(r.u8()));
  if (!CONTRACT_NAME.test(contractName) || !CLARITY_NAME.test(assetName)) throw new Error("bad asset name");
  return { contract: `${address}.${contractName}`, assetName };
}

function readPostCondition(r: Reader): PostCondition {
  const type = r.u8();
  const principal = readPcPrincipal(r);
  switch (type) {
    case 0x00: {
      const code = r.u8();
      if (code < 0x01 || code > 0x05) throw new Error("bad condition code");
      return { type: "stx", principal, code, amount: r.u64() };
    }
    case 0x01: {
      const asset = readAsset(r);
      const code = r.u8();
      if (code < 0x01 || code > 0x05) throw new Error("bad condition code");
      return { type: "ft", principal, asset, code, amount: r.u64() };
    }
    case 0x02: {
      const asset = readAsset(r);
      const assetId = readCV(r);
      const code = r.u8();
      if (code < 0x10 || code > 0x12) throw new Error("bad condition code");
      return { type: "nft", principal, asset, assetId, code };
    }
    case 0x03: {
      const code = r.u8();
      if (code < 0x01 || code > 0x05) throw new Error("bad condition code");
      return { type: "staking", principal, code, amount: r.u64() };
    }
    case 0x04: {
      const code = r.u8();
      if (code < 0x30 || code > 0x32) throw new Error("bad condition code");
      return { type: "pox", principal, code };
    }
    default:
      throw new Error("unknown post-condition type");
  }
}

function readPayload(r: Reader): Payload {
  const type = r.u8();
  switch (type) {
    case 0x00: {
      const recipient = readCV(r);
      if (recipient.type !== "address" && recipient.type !== "contract") throw new Error("bad recipient");
      return { type: "token-transfer", recipient, amount: r.u64(), memo: r.read(MEMO_BYTES).slice() };
    }
    case 0x02: {
      const version = r.u8();
      const address = c32address(version, r.read(20));
      const name = new TextDecoder().decode(r.read(r.u8()));
      const functionName = new TextDecoder().decode(r.read(r.u8()));
      if (!CONTRACT_NAME.test(name) || !CLARITY_NAME.test(functionName)) throw new Error("bad contract call");
      const n = r.u32();
      if (n > 256) throw new Error("too many arguments");
      const args: CV[] = [];
      for (let i = 0; i < n; i++) args.push(readCV(r));
      return { type: "contract-call", contract: `${address}.${name}`, functionName, args };
    }
    case 0x01:
    case 0x06: {
      const clarityVersion = type === 0x06 ? r.u8() : undefined;
      const name = new TextDecoder().decode(r.read(r.u8()));
      if (!CONTRACT_NAME.test(name)) throw new Error("bad contract name");
      const code = new TextDecoder("utf-8", { fatal: true }).decode(r.read(r.u32()));
      return clarityVersion === undefined ? { type: "smart-contract", name, code } : { type: "smart-contract", name, code, clarityVersion };
    }
    default:
      // Coinbase, tenure change, poison microblock: never a wallet's to sign.
      throw new Error("unsupported payload");
  }
}

export function deserializeTx(bytes: Uint8Array): StacksTx {
  const r = new Reader(bytes);
  const version = r.u8();
  if (version !== 0x00 && version !== 0x80) throw new Error("bad transaction version");
  const chainId = r.u32();
  const authType = r.u8();
  if (authType !== AUTH_STANDARD && authType !== AUTH_SPONSORED) throw new Error("bad auth type");
  const origin = readCondition(r);
  const auth: Auth = authType === AUTH_SPONSORED ? { type: AUTH_SPONSORED, origin, sponsor: readCondition(r) } : { type: AUTH_STANDARD, origin };
  const anchorMode = r.u8();
  if (anchorMode < 0x01 || anchorMode > 0x03) throw new Error("bad anchor mode");
  const postConditionMode = r.u8();
  if (postConditionMode < 0x01 || postConditionMode > 0x03) throw new Error("bad post-condition mode");
  const n = r.u32();
  if (n > 1024) throw new Error("too many post-conditions");
  const postConditions: PostCondition[] = [];
  for (let i = 0; i < n; i++) postConditions.push(readPostCondition(r));
  const payload = readPayload(r);
  if (!r.done) throw new Error("trailing bytes");
  return { version, chainId, auth, anchorMode, postConditionMode, postConditions, payload };
}

/* ------------------------------------------------------------------ signing hashes */

function clearCondition(c: SpendingCondition): SpendingCondition {
  return c.kind === "single" ? { ...c, nonce: 0n, fee: 0n, signature: EMPTY_SIG() } : { ...c, nonce: 0n, fee: 0n, fields: [] };
}

/**
 * The initial sighash: the txid of the transaction with the origin condition cleared (nonce, fee and signature
 * zeroed) and, when sponsored, the sponsor condition replaced by an empty P2PKH one (stacks.js
 * `intoInitialSighashAuth`; stacks-core `TransactionAuth::into_initial_sighash_auth`).
 */
export function initialSighash(tx: StacksTx): Uint8Array {
  const sponsor: SpendingCondition = { kind: "single", hashMode: HASH_MODE_P2PKH, signer: new Uint8Array(20), nonce: 0n, fee: 0n, keyEncoding: KEY_COMPRESSED, signature: EMPTY_SIG() };
  const auth: Auth = tx.auth.type === AUTH_SPONSORED ? { type: AUTH_SPONSORED, origin: clearCondition(tx.auth.origin), sponsor } : { type: AUTH_STANDARD, origin: clearCondition(tx.auth.origin) };
  return txidOf({ ...tx, auth });
}

/**
 * The digest the origin's key signs: SHA-512/256(initial sighash ‖ auth flag ‖ fee(8) ‖ nonce(8)) (stacks.js
 * `sigHashPreSign`). The origin always signs with the STANDARD flag (0x04), sponsored or not (`signNextOrigin`).
 */
export function originPresignDigest(tx: StacksTx): Uint8Array {
  const o = tx.auth.origin;
  return sha512_256(concat(initialSighash(tx), new Uint8Array([AUTH_STANDARD]), uintBE(o.fee, 8), uintBE(o.nonce, 8)));
}

/** A copy of `tx` with the origin's single-sig signature set (VRS = recovery ‖ r ‖ s). */
export function withOriginSignature(tx: StacksTx, vrs: Uint8Array): StacksTx {
  if (tx.auth.origin.kind !== "single") throw new Error("not a single-signature origin");
  if (vrs.length !== 65) throw new Error("bad signature length");
  return { ...tx, auth: { ...tx.auth, origin: { ...tx.auth.origin, keyEncoding: KEY_COMPRESSED, signature: vrs } } };
}

/* ------------------------------------------------------------------ builders */

export function memoBytes(memo: string | undefined): Uint8Array {
  const out = new Uint8Array(MEMO_BYTES);
  if (!memo) return out;
  const b = utf8(memo);
  if (b.length > MEMO_BYTES) throw new Error("memo too long");
  out.set(b);
  return out;
}

export function memoText(memo: Uint8Array): string {
  let end = memo.length;
  while (end > 0 && memo[end - 1] === 0) end--;
  if (!end) return "";
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(memo.subarray(0, end));
  } catch {
    return "";
  }
}

export interface Header {
  mainnet: boolean;
  chainId: number;
  signer: Uint8Array;
  nonce: bigint;
  fee: bigint;
  sponsored?: boolean;
}

export function unsignedTx(h: Header, payload: Payload, postConditions: PostCondition[] = [], postConditionMode: number = PC_MODE.deny): StacksTx {
  const origin: SpendingCondition = { kind: "single", hashMode: HASH_MODE_P2PKH, signer: h.signer, nonce: h.nonce, fee: h.sponsored ? 0n : h.fee, keyEncoding: KEY_COMPRESSED, signature: EMPTY_SIG() };
  const auth: Auth = h.sponsored
    ? { type: AUTH_SPONSORED, origin, sponsor: { kind: "single", hashMode: HASH_MODE_P2PKH, signer: new Uint8Array(20), nonce: 0n, fee: 0n, keyEncoding: KEY_COMPRESSED, signature: EMPTY_SIG() } }
    : { type: AUTH_STANDARD, origin };
  return { version: h.mainnet ? 0x00 : 0x80, chainId: h.chainId, auth, anchorMode: ANCHOR_ANY, postConditionMode, postConditions, payload };
}

/** Recipient of an STX transfer: a standard or contract principal (c32), as a Clarity value. */
export function recipientCV(to: string): CV {
  if (to.includes(".")) {
    const c = parseContractId(to);
    if (!c) throw new Error("bad recipient");
    return { type: "contract", value: `${c.address}.${c.name}` };
  }
  if (!parseAddress(to)) throw new Error("bad recipient");
  return { type: "address", value: to.trim().toUpperCase() };
}

export function assetInfoOf(assetId: string): AssetInfo | null {
  const a = parseAssetId(assetId);
  return a ? { contract: a.contract, assetName: a.assetName } : null;
}

/** One post-condition from its SIP-005 bytes (what stacks.js `postConditionToHex` sends). */
export function deserializePostCondition(bytes: Uint8Array): PostCondition {
  const r = new Reader(bytes);
  const pc = readPostCondition(r);
  if (!r.done) throw new Error("trailing bytes");
  return pc;
}
