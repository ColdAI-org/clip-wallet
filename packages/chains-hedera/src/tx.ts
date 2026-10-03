import { proto } from "@hiero-ledger/proto";
import { AccountId, Client, PublicKey, Transaction, TransactionId } from "@hiero-ledger/sdk";
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { HederaLedger } from "./networks.js";
import { b64decode, hex } from "./util.js";

/**
 * Transaction byte plumbing.
 *
 * How Hedera ECDSA(secp256k1) signing works: a frozen transaction is a TransactionList holding one
 * SignedTransaction per (node, transaction id) pair; each carries its own `bodyBytes` (they differ in
 * `nodeAccountID`). Every one of them must be signed. An ECDSA key signs keccak256(bodyBytes) and the 64-byte
 * r||s goes into that SignedTransaction's SignatureMap as `ECDSA_secp256k1`, keyed by the compressed public key.
 * So prepare() emits one 32-byte digest per body, and finalize() puts each signature back on the body whose
 * digest it signed (matched by digest, not by position).
 */

export function transactionFromBase64(b64: string): Transaction {
  return Transaction.fromBytes(b64decode(b64));
}

/** Wraps raw TransactionBody bytes (hedera_signTransaction's `transactionBody`) into a Transaction to describe it. */
export function transactionFromBodyBytes(bodyBytes: Uint8Array): Transaction {
  const list = proto.TransactionList.encode({
    transactionList: [{ signedTransactionBytes: proto.SignedTransaction.encode({ bodyBytes }).finish() }],
  }).finish();
  return Transaction.fromBytes(list);
}

/** A schedule's inner transaction, from the mirror node's base64 SchedulableTransactionBody. */
export function transactionFromSchedulableBody(b64: string): Transaction {
  const scheduled = proto.SchedulableTransactionBody.decode(b64decode(b64));
  const data = scheduled.data;
  if (!data) throw new Error("empty scheduled transaction");
  const body = proto.TransactionBody.encode({
    transactionFee: scheduled.transactionFee,
    memo: scheduled.memo,
    [data]: (scheduled as unknown as Record<string, unknown>)[data],
  } as proto.ITransactionBody).finish();
  return transactionFromBodyBytes(body);
}

/** The protobuf `data` case of the first body, e.g. "cryptoTransfer", "tokenAssociate". */
export function bodyKind(tx: Transaction): string {
  try {
    const list = proto.TransactionList.decode(tx.toBytes());
    const first = list.transactionList[0];
    if (!first?.signedTransactionBytes) return "unknown";
    const signed = proto.SignedTransaction.decode(first.signedTransactionBytes);
    return proto.TransactionBody.decode(signed.bodyBytes).data ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** HIP-745: dapps may send an unfrozen transaction. The wallet fills the payer transaction id and nodes. */
export function freezeIfNeeded(tx: Transaction, payer: string, ledger: HederaLedger): Transaction {
  if (tx.isFrozen()) return tx;
  if (!tx.transactionId) tx.setTransactionId(TransactionId.generate(AccountId.fromString(payer)));
  const client = Client.forName(ledger, { scheduleNetworkUpdate: false });
  try {
    tx.freezeWith(client);
  } finally {
    client.close();
  }
  return tx;
}

export function ecdsaPublicKey(publicKeyHex: string): PublicKey {
  return PublicKey.fromStringECDSA(publicKeyHex.replace(/^0x/, ""));
}

export function digest(bytes: Uint8Array): Uint8Array {
  return keccak_256(bytes);
}

/**
 * Every body this key still has to sign, in the SDK's order. Uses signWith on a throwaway copy with a
 * collecting callback, so no private key is involved. Empty if the key already signed.
 */
export async function bodiesToSign(txBytes: Uint8Array, publicKey: PublicKey): Promise<Uint8Array[]> {
  const bodies: Uint8Array[] = [];
  const copy = Transaction.fromBytes(txBytes);
  await copy.signWith(publicKey, async (body) => {
    bodies.push(body.slice());
    return new Uint8Array(64);
  });
  return bodies;
}

/** Attaches signatures (each over keccak256 of one body) and returns the signed transaction. */
export async function attachSignatures(
  txBytes: Uint8Array,
  publicKey: PublicKey,
  signatures: Uint8Array[],
): Promise<Transaction> {
  const bodies = await bodiesToSign(txBytes, publicKey);
  const byDigest = new Map<string, Uint8Array>();
  for (const body of bodies) {
    const d = hex(digest(body));
    const sig = signatures.find((s) => publicKey.verify(body, s));
    if (!sig) throw new Error(`missing signature for body ${d}`);
    byDigest.set(d, sig);
  }
  const tx = Transaction.fromBytes(txBytes);
  await tx.signWith(publicKey, async (body) => {
    const sig = byDigest.get(hex(digest(body)));
    if (!sig) throw new Error("unexpected body");
    return sig;
  });
  return tx;
}

/** base64 proto.SignatureMap with one ECDSA pair — the result shape of hedera_signTransaction / hedera_signMessage. */
export function signatureMapBase64(publicKey: PublicKey, signature: Uint8Array): string {
  const map = proto.SignatureMap.encode({
    sigPair: [{ pubKeyPrefix: publicKey.toBytesRaw(), ECDSASecp256k1: signature }],
  }).finish();
  let s = "";
  for (const b of map) s += String.fromCharCode(b);
  return btoa(s);
}

/** hedera_signMessage prefixing, identical to hedera-wallet-connect's prefixMessageToSign. */
export function prefixMessage(message: string): Uint8Array {
  return new TextEncoder().encode(`\x19Hedera Signed Message:\n${message.length}${message}`);
}

export function scheduledInner(tx: Transaction): Transaction | null {
  // The SDK keeps the decoded inner transaction on a private field; there is no public getter.
  return ((tx as unknown as { _scheduledTransaction?: Transaction | null })._scheduledTransaction ?? null);
}
