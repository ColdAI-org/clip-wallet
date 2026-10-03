import {
  type Address,
  type CompiledTransactionMessage,
  type CompiledTransactionMessageWithLifetime,
  type Instruction,
  decompileTransactionMessage,
  getAddressDecoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
  type SignatureBytes,
  type Transaction,
} from "@solana/kit";
import { SYSTEM_PROGRAM_ADDRESS, SystemInstruction } from "@solana-program/system";
import { type SolanaRpc, base64Data, getMultipleAccounts } from "./rpc.js";

export interface ParsedTransaction {
  wire: Uint8Array;
  transaction: Transaction;
  compiled: CompiledTransactionMessage & CompiledTransactionMessageWithLifetime;
  /** Accounts that must sign, in order (the first pays the fee). */
  signers: string[];
  feePayer: string;
  /** Null when lookup tables couldn't be resolved or the message couldn't be decompiled. */
  instructions: Instruction[] | null;
  /** First instruction is System AdvanceNonceAccount: the transaction doesn't expire. */
  durableNonce: boolean;
  numSignatures: number;
}

/** Wire bytes → transaction. Throws on anything that isn't a full transaction. */
export function decodeWire(wire: Uint8Array): { transaction: Transaction; compiled: CompiledTransactionMessage & CompiledTransactionMessageWithLifetime } {
  const [transaction, end] = getTransactionDecoder().read(wire, 0);
  if (end !== wire.length) throw new Error("trailing bytes");
  const [compiled, mEnd] = getCompiledTransactionMessageDecoder().read(transaction.messageBytes, 0);
  if (mEnd !== transaction.messageBytes.length) throw new Error("trailing message bytes");
  return { transaction, compiled: compiled as CompiledTransactionMessage & CompiledTransactionMessageWithLifetime };
}

/** Address lookup table account → its addresses (56-byte header, then 32-byte keys). */
export function lookupTableAddresses(data: Uint8Array): Address[] {
  const dec = getAddressDecoder();
  const out: Address[] = [];
  for (let off = 56; off + 32 <= data.length; off += 32) out.push(dec.decode(data.subarray(off, off + 32)));
  return out;
}

export async function parseTransaction(wire: Uint8Array, rpc: SolanaRpc | null): Promise<ParsedTransaction> {
  const { transaction, compiled } = decodeWire(wire);
  const numSignatures = compiled.header.numSignerAccounts;
  const signers = compiled.staticAccounts.slice(0, numSignatures).map(String);
  let instructions: Instruction[] | null = null;
  try {
    const lookups = "addressTableLookups" in compiled ? (compiled.addressTableLookups ?? []) : [];
    const addressesByLookupTableAddress: Record<string, Address[]> = {};
    if (lookups.length) {
      if (!rpc) throw new Error("lookup tables need rpc");
      const accounts = await getMultipleAccounts(rpc, lookups.map((l) => l.lookupTableAddress), "base64");
      lookups.forEach((l, i) => {
        const data = base64Data(accounts[i] ?? null);
        if (!data) throw new Error(`lookup table ${l.lookupTableAddress} not found`);
        addressesByLookupTableAddress[l.lookupTableAddress] = lookupTableAddresses(data);
      });
    }
    const message = decompileTransactionMessage(compiled, { addressesByLookupTableAddress });
    instructions = [...message.instructions];
  } catch {
    instructions = null;
  }
  return {
    wire,
    transaction,
    compiled,
    signers,
    feePayer: signers[0] ?? "",
    instructions,
    durableNonce: isAdvanceNonce(compiled),
    numSignatures,
  };
}

function isAdvanceNonce(compiled: CompiledTransactionMessage): boolean {
  const first = "instructions" in compiled ? compiled.instructions[0] : undefined;
  if (!first) return false;
  const program = compiled.staticAccounts[first.programAddressIndex];
  const data = first.data;
  return program === SYSTEM_PROGRAM_ADDRESS && !!data && data.length >= 4 && data[0] === SystemInstruction.AdvanceNonceAccount && data[1] === 0 && data[2] === 0 && data[3] === 0;
}

/** True when bytes decode completely as a transaction or as a bare transaction message. */
export function looksLikeTransaction(bytes: Uint8Array): boolean {
  try {
    decodeWire(bytes);
    return true;
  } catch {
    /* not a wire transaction */
  }
  try {
    const [m, end] = getCompiledTransactionMessageDecoder().read(bytes, 0);
    const ixs = "instructions" in m ? m.instructions : [];
    return (
      end === bytes.length &&
      m.header.numSignerAccounts > 0 &&
      m.staticAccounts.length > 0 &&
      ixs.every((ix) => ix.programAddressIndex < m.staticAccounts.length)
    );
  } catch {
    return false;
  }
}

/** Puts `signature` in `signer`'s slot and re-encodes. */
export function withSignature(tx: Transaction, signer: string, signature: Uint8Array): Uint8Array {
  if (!(signer in tx.signatures)) throw new Error("not a signer");
  const signatures = { ...tx.signatures, [signer]: signature as SignatureBytes };
  return new Uint8Array(getTransactionEncoder().encode({ ...tx, signatures } as Transaction));
}
