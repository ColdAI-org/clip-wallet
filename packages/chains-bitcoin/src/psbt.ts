/**
 * PSBT analysis and per-input sighash digests.
 *  - segwit v0 (P2WPKH): BIP-143 digest (sha256d) → ecdsa-secp256k1 payload.
 *  - taproot key path (P2TR, BIP-86): BIP-341 SigMsg tagged hash → schnorr-secp256k1 payload with the
 *    TapTweak scalar in options.taprootTweak (the vault signs with d' = d·(even-Y) + t).
 * Legacy P2PKH and nested P2SH-P2WPKH inputs are not signed in v1.
 */
import { ClipError, type Account, type ChildAddress, type Network } from "@clip-wallet/core";
import { base64, hex } from "@scure/base";
import { SigHash, Transaction } from "@scure/btc-signer";
import { tagSchnorr } from "@scure/btc-signer/utils.js";
import { type ChangeKey, type OwnKind, type OwnScripts, addressOfScript, changeKeyOf, isOpReturn, ownKind, ownScripts, scriptType, wpkhScriptCode, xOnly } from "./keys.js";

export const TX_OPTS = {
  allowUnknownOutputs: true,
  allowUnknownInputs: true,
  allowLegacyWitnessUtxo: true,
  disableScriptCheck: true,
} as const;

export function parsePsbt(psbt: string | Uint8Array): Transaction {
  try {
    const bytes = typeof psbt !== "string" ? psbt : /^[0-9a-fA-F]+$/.test(psbt) ? hex.decode(psbt) : base64.decode(psbt);
    return Transaction.fromPSBT(bytes, TX_OPTS);
  } catch (e) {
    throw new ClipError("The app sent a Bitcoin transaction we can't read, so we stopped it.", "bad-psbt", e);
  }
}

export const psbtBase64 = (tx: Transaction): string => base64.encode(tx.toPSBT());

/** Which inputs the dapp asks us to sign, with the sighash it wants (if any). */
export interface SignRequest {
  index: number;
  sighash?: number;
}

export interface InputInfo {
  index: number;
  txid: string;
  vout: number;
  amount?: bigint;
  script?: Uint8Array;
  address?: string;
  kind: OwnKind;
  sequence: number;
  /** Set when the coin sits on one of the account's change addresses (signed with that key). */
  change?: ChangeKey;
  /** Set when we will sign this input. */
  sign?: { hashType: number };
}

export interface OutputInfo {
  index: number;
  amount: bigint;
  script: Uint8Array;
  address?: string;
  ours: boolean;
  opReturn: boolean;
}

export interface PsbtAnalysis {
  inputs: InputInfo[];
  outputs: OutputInfo[];
  /** Sats, when every input amount is known. */
  fee?: bigint;
  vsize: number;
  /** sat/vB, one decimal. */
  feeRate?: number;
  rbf: boolean;
  /** Net change to the user's coins (ours out − ours in), sats. Inputs we don't sign but own count too. */
  net: bigint;
  own: OwnScripts;
}

function prevout(tx: Transaction, i: number): { amount?: bigint; script?: Uint8Array } {
  const inp = tx.getInput(i);
  if (inp.witnessUtxo) return { amount: inp.witnessUtxo.amount, script: inp.witnessUtxo.script };
  const prev = inp.nonWitnessUtxo?.outputs?.[inp.index!];
  if (prev) return { amount: prev.amount, script: prev.script };
  return {};
}

const defaultHashType = (kind: OwnKind) => (kind === "tr" ? SigHash.DEFAULT : SigHash.ALL);

/** Witness weight units per input type, for the unsigned → signed size estimate. */
const WITNESS_WU: Record<string, number> = { wpkh: 108, tr: 66, other: 108 };

export function estimateVsize(tx: Transaction, inputTypes: string[]): number {
  const baseBytes = tx.toBytes(true, false).length;
  const witness = inputTypes.reduce((s, t) => s + (WITNESS_WU[t] ?? 108), 0) + 2;
  return Math.ceil((baseBytes * 4 + witness) / 4);
}

export function analyzePsbt(tx: Transaction, account: Account, network: Network, toSign?: SignRequest[], change: ChildAddress[] = []): PsbtAnalysis {
  const own = ownScripts(account, change, network);
  const wanted = toSign ? new Map(toSign.map((s) => [s.index, s.sighash])) : undefined;
  const inputs: InputInfo[] = [];
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    const { amount, script } = prevout(tx, i);
    const kind = script ? ownKind(script, own) : null;
    const info: InputInfo = { index: i, txid: hex.encode(inp.txid!), vout: inp.index!, kind, sequence: inp.sequence ?? 0xffffffff };
    if (amount !== undefined) info.amount = amount;
    const ck = script ? changeKeyOf(script, own) : undefined;
    if (ck) info.change = ck;
    if (script) {
      info.script = script;
      const a = addressOfScript(script, network);
      if (a) info.address = a;
    }
    const explicitlyWanted = wanted?.has(i);
    if (explicitlyWanted && !kind) {
      throw new ClipError("The app asked you to sign a coin that isn't yours, so we stopped it.", "not-our-input", i);
    }
    const signThis = wanted ? explicitlyWanted : kind !== null && !inp.finalScriptWitness && !inp.finalScriptSig;
    if (signThis && kind) info.sign = { hashType: wanted?.get(i) ?? inp.sighashType ?? defaultHashType(kind) };
    inputs.push(info);
  }
  const outputs: OutputInfo[] = [];
  for (let i = 0; i < tx.outputsLength; i++) {
    const o = tx.getOutput(i);
    const script = o.script!;
    const out: OutputInfo = { index: i, amount: o.amount!, script, ours: ownKind(script, own) !== null, opReturn: isOpReturn(script) };
    const a = addressOfScript(script, network);
    if (a) out.address = a;
    outputs.push(out);
  }
  const allKnown = inputs.every((x) => x.amount !== undefined);
  const inSum = inputs.reduce((s, x) => s + (x.amount ?? 0n), 0n);
  const outSum = outputs.reduce((s, x) => s + x.amount, 0n);
  const vsize = estimateVsize(tx, inputs.map((x) => (x.script ? scriptType(x.script) : "other")));
  const ourIn = inputs.filter((x) => x.kind).reduce((s, x) => s + (x.amount ?? 0n), 0n);
  const ourOut = outputs.filter((x) => x.ours).reduce((s, x) => s + x.amount, 0n);
  const a: PsbtAnalysis = {
    inputs,
    outputs,
    vsize,
    rbf: inputs.some((x) => x.sequence < 0xfffffffe),
    net: ourOut - ourIn,
    own,
  };
  if (allKnown) {
    a.fee = inSum - outSum;
    a.feeRate = Math.round((Number(a.fee) / vsize) * 10) / 10;
  }
  return a;
}

/* ------------------------------------------------------------------ sighash */

export interface InputDigest {
  index: number;
  kind: "wpkh" | "tr";
  hashType: number;
  digest: Uint8Array;
  /** Key that signs this input (the account key, or a change key). */
  pubkey: Uint8Array;
  /** Change inputs: the vault's derivationSubPath ("1/<n>"). */
  subPath?: string;
  /** taproot only: TapTweak scalar bytes for the vault. */
  tweak?: Uint8Array;
}

export function tapTweakBytes(internalKey: Uint8Array, merkleRoot?: Uint8Array): Uint8Array {
  return tagSchnorr("TapTweak", xOnly(internalKey), merkleRoot ?? new Uint8Array());
}

export function inputDigests(tx: Transaction, a: PsbtAnalysis): InputDigest[] {
  const out: InputDigest[] = [];
  const signing = a.inputs.filter((x) => x.sign);
  if (signing.length === 0) throw new ClipError("There's nothing in this request for your account to sign.", "nothing-to-sign");
  const needAllPrevouts = signing.some((x) => x.kind === "tr");
  if (needAllPrevouts && a.inputs.some((x) => x.amount === undefined || !x.script)) {
    throw new ClipError("This Bitcoin transaction is missing details we need to check it, so we stopped it.", "missing-prevouts");
  }
  for (const x of signing) {
    const hashType = x.sign!.hashType;
    if (x.amount === undefined) throw new ClipError("This Bitcoin transaction is missing details we need to check it, so we stopped it.", "missing-prevouts");
    if (x.kind === "wpkh") {
      const pubkey = x.change?.pubkey ?? a.own.pubkey;
      const d: InputDigest = { index: x.index, kind: "wpkh", hashType, pubkey, digest: tx.preimageWitnessV0(x.index, wpkhScriptCode(pubkey), hashType, x.amount) };
      if (x.change) d.subPath = x.change.subPath;
      out.push(d);
    } else if (x.kind === "tr") {
      const inp = tx.getInput(x.index);
      if (inp.tapLeafScript?.length && !inp.tapInternalKey) throw new ClipError("Clip Wallet can't sign this kind of Bitcoin script yet.", "unsupported-script");
      const digest = tx.preimageWitnessV1(
        x.index,
        a.inputs.map((i) => i.script!),
        hashType,
        a.inputs.map((i) => i.amount!),
      );
      out.push({ index: x.index, kind: "tr", hashType, digest, pubkey: a.own.pubkey, tweak: tapTweakBytes(a.own.pubkey, inp.tapMerkleRoot) });
    }
  }
  return out;
}

/** Sighash flags in plain words. Returns a warning level when the flag lets others change the tx. */
export function sighashRisk(hashType: number): { level: "caution" | "danger"; message: string } | undefined {
  const base = hashType & 0x1f;
  const acp = (hashType & 0x80) !== 0;
  if (base === SigHash.NONE) {
    return {
      level: "danger",
      message: acp
        ? "This signature doesn't lock where the money goes or which other coins are used. Anyone could take these coins."
        : "This signature doesn't lock where the money goes. Anyone could redirect these coins.",
    };
  }
  if (base === SigHash.SINGLE && acp) return { level: "caution", message: "Others can add to this transaction. This is normal for a marketplace listing." };
  if (acp) return { level: "caution", message: "Others can add their own coins to this transaction." };
  if (base === SigHash.SINGLE) return { level: "caution", message: "This signature only locks one of the outputs." };
  return undefined;
}
