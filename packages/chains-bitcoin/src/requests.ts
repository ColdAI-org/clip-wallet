/**
 * Every Bitcoin request shape, normalised to one operation.
 *
 * Injected (1Mask, Wallet Standard; sats-connect calls are mapped onto these by 1Mask):
 *   bitcoin:signTransaction        { inputs: [{ psbt: base64, inputsToSign: [{ address, signingIndexes, sigHash? }], chain? }] } → [{ psbt }]
 *   bitcoin:signAndSendTransaction same params                                                                                  → [{ txid, psbt }]
 *   bitcoin:signMessage            { inputs: [{ address, message: base64(bytes), protocol? }] }                                → [{ signature, signedMessage, messageHash, protocol }]
 *   bitcoin:sendTransfer           { recipients: [{ address, amount }] }                                                       → { txid }
 * WalletConnect bip122 (via === "walletconnect", method names unchanged):
 *   signPsbt       { account?, psbt, signInputs: [{ address, index, sighashTypes? }] | { [address]: number[] }, broadcast? } → { psbt, txid? }
 *   signMessage    { account?, address, message: string, protocol?: "ecdsa" | "bip322" }                                    → { address, signature, messageHash }
 *   sendTransfer   { account?, recipientAddress, amount, memo? }                                                             → { txid }
 */
import { ClipError, type DappRequest } from "@clip-wallet/core";
import { base64 } from "@scure/base";
import type { SignRequest } from "./psbt.js";

export type Reply = "standard" | "wc";

export type BtcOp =
  | { kind: "psbt"; psbt: string; toSign?: SignRequest[]; signerAddresses: string[]; broadcast: boolean; reply: Reply }
  | { kind: "message"; message: Uint8Array; address?: string; protocol: "bip322" | "ecdsa"; reply: Reply }
  | { kind: "transfer"; recipients: { address: string; amount: bigint }[]; reply: Reply };

export const BTC_METHODS = {
  signTransaction: "bitcoin:signTransaction",
  signAndSendTransaction: "bitcoin:signAndSendTransaction",
  signMessage: "bitcoin:signMessage",
  sendTransfer: "bitcoin:sendTransfer",
  wcSignPsbt: "signPsbt",
  wcSignMessage: "signMessage",
  wcSendTransfer: "sendTransfer",
} as const;

const bad = (why: string) => new ClipError("This request from the app is malformed, so we stopped it.", "bad-request", why);
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object") throw bad("params must be an object");
  return v as Record<string, unknown>;
};
const amountOf = (v: unknown): bigint => {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  throw bad("amount must be whole sats");
};
const protocolOf = (v: unknown): "bip322" | "ecdsa" => (typeof v === "string" && v.toLowerCase() === "ecdsa" ? "ecdsa" : "bip322");

function singleInput(p: Record<string, unknown>): Record<string, unknown> {
  const inputs = p.inputs;
  if (!Array.isArray(inputs) || inputs.length !== 1) throw new ClipError("Clip Wallet signs one Bitcoin request at a time.", "multi-input-unsupported");
  return obj(inputs[0]);
}

export function normalize(req: DappRequest): BtcOp {
  const p = obj(Array.isArray(req.params) ? req.params[0] : req.params);
  switch (req.method) {
    case BTC_METHODS.signTransaction:
    case BTC_METHODS.signAndSendTransaction: {
      const i = singleInput(p);
      if (typeof i.psbt !== "string") throw bad("psbt must be base64");
      const toSign: SignRequest[] = [];
      const signerAddresses: string[] = [];
      for (const s of (Array.isArray(i.inputsToSign) ? i.inputsToSign : []) as Record<string, unknown>[]) {
        if (typeof s.address === "string") signerAddresses.push(s.address);
        for (const idx of (Array.isArray(s.signingIndexes) ? s.signingIndexes : []) as number[]) {
          const r: SignRequest = { index: idx };
          if (typeof s.sigHash === "number") r.sighash = s.sigHash;
          toSign.push(r);
        }
      }
      const op: BtcOp = { kind: "psbt", psbt: i.psbt, signerAddresses, broadcast: req.method === BTC_METHODS.signAndSendTransaction, reply: "standard" };
      if (toSign.length) op.toSign = toSign;
      return op;
    }
    case BTC_METHODS.wcSignPsbt: {
      if (typeof p.psbt !== "string") throw bad("psbt must be base64");
      const toSign: SignRequest[] = [];
      const signerAddresses: string[] = [];
      if (Array.isArray(p.signInputs)) {
        for (const s of p.signInputs as Record<string, unknown>[]) {
          if (typeof s.index !== "number") throw bad("signInputs.index");
          if (typeof s.address === "string") signerAddresses.push(s.address);
          const r: SignRequest = { index: s.index };
          const types = s.sighashTypes;
          if (Array.isArray(types) && typeof types[0] === "number") r.sighash = types[0];
          toSign.push(r);
        }
      } else if (p.signInputs && typeof p.signInputs === "object") {
        for (const [address, idxs] of Object.entries(p.signInputs as Record<string, number[]>)) {
          signerAddresses.push(address);
          for (const index of idxs) toSign.push({ index });
        }
      }
      const op: BtcOp = { kind: "psbt", psbt: p.psbt, signerAddresses, broadcast: p.broadcast === true, reply: "wc" };
      if (toSign.length) op.toSign = toSign;
      return op;
    }
    case BTC_METHODS.wcSignMessage: {
      if (typeof p.message !== "string") throw bad("message must be a string");
      const op: BtcOp = { kind: "message", message: new TextEncoder().encode(p.message), protocol: protocolOf(p.protocol), reply: "wc" };
      if (typeof p.address === "string") op.address = p.address;
      else if (typeof p.account === "string") op.address = p.account;
      return op;
    }
    case BTC_METHODS.signMessage: {
      const i = singleInput(p);
      if (typeof i.message !== "string") throw bad("message must be base64");
      let message: Uint8Array;
      try {
        message = base64.decode(i.message);
      } catch {
        throw bad("message must be base64");
      }
      const op: BtcOp = { kind: "message", message, protocol: protocolOf(i.protocol), reply: "standard" };
      if (typeof i.address === "string") op.address = i.address;
      return op;
    }
    case BTC_METHODS.sendTransfer: {
      // Injected (bitcoin:sendTransfer) and sats-connect: { recipients }. WalletConnect: { recipientAddress, amount }.
      if (Array.isArray(p.recipients)) {
        const recipients = (p.recipients as Record<string, unknown>[]).map((r) => {
          if (typeof r.address !== "string") throw bad("recipient address");
          return { address: r.address, amount: amountOf(r.amount) };
        });
        if (!recipients.length) throw bad("recipients required");
        return { kind: "transfer", recipients, reply: "standard" };
      }
      throw bad("recipients required");
    }
    case BTC_METHODS.wcSendTransfer: {
      if (Array.isArray(p.recipients)) return { ...(normalize({ ...req, method: BTC_METHODS.sendTransfer }) as BtcOp), reply: "wc" } as BtcOp;
      if (typeof p.recipientAddress !== "string") throw bad("recipientAddress required");
      return { kind: "transfer", recipients: [{ address: p.recipientAddress, amount: amountOf(p.amount) }], reply: "wc" };
    }
    default:
      throw new ClipError("Clip Wallet doesn't support this kind of Bitcoin request yet.", "unsupported-method", req.method);
  }
}
