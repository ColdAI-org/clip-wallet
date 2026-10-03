/**
 * The requests the recorded device sessions signed. Public data only: everything here is computed from
 * public keys (test/fixtures/accounts.json) with public hash functions. The same functions produced
 * the inputs when the APDU sessions in test/fixtures/ledger-*.apdus were recorded (see README "Tests and fixtures").
 */
import type { DappRequest, DecodedRequest, SignablePayload } from "@clip-wallet/core";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, hex } from "@scure/base";
import { p2pkh, p2wpkh, SigHash, TEST_NETWORK, Transaction } from "@scure/btc-signer";
import { hashMessage, hashTypedData, keccak256, parseEther, parseGwei, serializeTransaction, type TypedDataDefinition } from "viem";
import accounts from "./fixtures/accounts.json" with { type: "json" };

export const ACCOUNTS = accounts;
export const SEPOLIA = 11155111;

export const fromHex = (h: string): Uint8Array => hex.decode(h.replace(/^0x/, ""));

/* ------------------------------------------------------------------ EVM */

export function evmTx(): { raw: Uint8Array; digest: Uint8Array } {
  const ser = serializeTransaction({
    type: "eip1559",
    chainId: SEPOLIA,
    nonce: 7,
    to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    value: parseEther("0.01"),
    gas: 21000n,
    maxFeePerGas: parseGwei("30"),
    maxPriorityFeePerGas: parseGwei("1"),
  });
  return { raw: fromHex(ser), digest: fromHex(keccak256(ser)) };
}

export const PERSONAL_MESSAGE = "Sign in to clip.test\nNonce: 42";

export function evmPersonal(): { raw: Uint8Array; digest: Uint8Array } {
  const raw = new TextEncoder().encode(PERSONAL_MESSAGE);
  return { raw, digest: fromHex(hashMessage({ raw })) };
}

/** The EIP-712 "Mail" example (https://eips.ethereum.org/EIPS/eip-712), on Sepolia. */
export const MAIL: TypedDataDefinition = {
  domain: { name: "Ether Mail", version: "1", chainId: SEPOLIA, verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC" },
  types: {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
    Person: [
      { name: "name", type: "string" },
      { name: "wallet", type: "address" },
    ],
    Mail: [
      { name: "from", type: "Person" },
      { name: "to", type: "Person" },
      { name: "contents", type: "string" },
    ],
  },
  primaryType: "Mail",
  message: {
    from: { name: "Cow", wallet: "0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826" },
    to: { name: "Bob", wallet: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB" },
    contents: "Hello, Bob!",
  },
};

export function evm712(): { raw: Uint8Array; digest: Uint8Array } {
  return { raw: new TextEncoder().encode(JSON.stringify(MAIL)), digest: fromHex(hashTypedData(MAIL)) };
}

/* ------------------------------------------------------------------ Solana */

const SYSTEM_PROGRAM = new Uint8Array(32);
export const SOL_RECIPIENT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

/** Legacy transfer message: 1 required signer (us), recipient, system program; 0.001 SOL. */
export function solTransfer(fromPubHex: string): Uint8Array {
  const from = fromHex(fromPubHex);
  const to = base58.decode(SOL_RECIPIENT);
  const blockhash = new Uint8Array(32).fill(7);
  const data = new Uint8Array(12);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, 2, true); // SystemInstruction::Transfer
  dv.setBigUint64(4, 1_000_000n, true);
  return new Uint8Array([
    1, 0, 1, // header: 1 signer, 0 readonly signed, 1 readonly unsigned
    3, ...from, ...to, ...SYSTEM_PROGRAM,
    ...blockhash,
    1, // one instruction
    2, 2, 0, 1, data.length, ...data,
  ]);
}

/* ------------------------------------------------------------------ Hedera */

function varint(n: bigint): number[] {
  const out: number[] = [];
  let v = n;
  while (v >= 0x80n) {
    out.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  out.push(Number(v));
  return out;
}
const key = (field: number, wire: number): number[] => varint(BigInt((field << 3) | wire));
const vint = (field: number, n: bigint): number[] => [...key(field, 0), ...varint(n)];
const sint = (field: number, n: bigint): number[] => vint(field, n >= 0n ? n << 1n : (-n << 1n) - 1n);
const msg = (field: number, body: number[]): number[] => [...key(field, 2), ...varint(BigInt(body.length)), ...body];
const account = (field: number, num: bigint): number[] => msg(field, [...vint(1, 0n), ...vint(2, 0n), ...vint(3, num)]);

/** TransactionBody: 0.0.1234 sends 1 HBAR to 0.0.5678 via node 0.0.3 (field numbers from the app's proto/). */
export function hederaTransferBody(): Uint8Array {
  const txId = msg(1, [...msg(1, [...vint(1, 1_760_000_000n), ...vint(2, 0n)]), ...account(2, 1234n)]);
  const transfers = msg(14, msg(1, [...msg(1, [...account(1, 1234n), ...sint(2, -100_000_000n)]), ...msg(1, [...account(1, 5678n), ...sint(2, 100_000_000n)])]));
  const memo = new TextEncoder().encode("clip test");
  return new Uint8Array([
    ...txId,
    ...account(2, 3n),
    ...vint(3, 100_000_000n),
    ...msg(4, vint(1, 120n)),
    ...key(6, 2), ...varint(BigInt(memo.length)), ...memo,
    ...transfers,
  ]);
}

/* ------------------------------------------------------------------ Bitcoin */

export const BTC_RECIPIENT = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";

/** A PSBT spending one P2WPKH coin of `pubHex` (with its full previous tx) to a recipient + change. */
export function btcPsbt(pubHex: string): { psbt: Uint8Array; digest: Uint8Array } {
  const pub = fromHex(pubHex);
  const mine = p2wpkh(pub, TEST_NETWORK);
  const prev = new Transaction({ allowUnknownInputs: true, allowUnknownOutputs: true });
  prev.addInput({ txid: new Uint8Array(32).fill(1), index: 0 });
  prev.addOutput({ script: mine.script, amount: 100_000n });
  const prevRaw = prev.unsignedTx;
  const tx = new Transaction({ allowUnknownOutputs: true });
  tx.addInput({ txid: prev.id, index: 0, witnessUtxo: { script: mine.script, amount: 100_000n }, nonWitnessUtxo: prevRaw, sighashType: SigHash.ALL });
  tx.addOutputAddress(BTC_RECIPIENT, 50_000n, TEST_NETWORK);
  tx.addOutput({ script: mine.script, amount: 49_000n });
  const digest = tx.preimageWitnessV0(0, p2pkh(pub).script, SigHash.ALL, 100_000n);
  return { psbt: tx.toPSBT(0), digest };
}

/* ------------------------------------------------------------------ payloads */

export const APPROVAL = "approval-1";

export function request(family: DappRequest["family"], method: string, networkId: string): DappRequest {
  return { id: `req-${method}`, origin: "https://clip.test", via: "injected", family, networkId, method, params: [] };
}

export function decoded(networkId: string): DecodedRequest {
  return { requestId: "req", title: "Test", lines: [], balanceChanges: [], simulated: false, blind: false, warnings: [], networkId };
}

export function payload(accountId: string, scheme: SignablePayload["scheme"], bytes: Uint8Array, raw?: SignablePayload["raw"]): SignablePayload {
  return { accountId, scheme, bytes, approvalId: APPROVAL, ...(raw ? { raw } : {}) };
}

export const BTC_MESSAGE = "Sign in to clip.test";

/** BIP-137 digest: sha256d("\x18Bitcoin Signed Message:\n" || varint(len) || message). */
export function btcMessage(): { raw: Uint8Array; digest: Uint8Array } {
  const raw = new TextEncoder().encode(BTC_MESSAGE);
  const prefix = new TextEncoder().encode("\x18Bitcoin Signed Message:\n");
  const pre = new Uint8Array([...prefix, raw.length, ...raw]);
  return { raw, digest: sha256(sha256(pre)) };
}
