import type { DappRequest, NetworkId } from "@clip-wallet/core";
import {
  encodeFunctionData,
  erc20Abi,
  getAddress,
  hashTypedData,
  isAddress,
  isHex,
  keccak256,
  numberToHex,
  pad,
  recoverAddress,
  toBytes,
} from "viem";
import type { Address, Hex } from "viem";
import { SETTLE_DEPOSIT_ABI } from "./settle-abi.js";

/**
 * The signed quote of "settle on Hedera" (CLPRouter `src/settle/SettleTypes.sol`, branch feat/settle-on-hedera) and
 * its EIP-712 hashing (https://eips.ethereum.org/EIPS/eip-712). The order id everywhere is the quote's EIP-712
 * digest under the order book's domain {name "ClprSettle", version "1", chainId = Hedera's EVM chain id,
 * verifyingContract = the order book}. Nothing here signs; signatures are only recovered to check them.
 */

export const SETTLE_DOMAIN_NAME = "ClprSettle";
export const SETTLE_DOMAIN_VERSION = "1";

/** Field order is the contract's QUOTE_TYPEHASH order; changing it changes every order id. */
export const SETTLE_QUOTE_TYPES = {
  Quote: [
    { name: "connector", type: "address" },
    { name: "srcLedger", type: "bytes32" },
    { name: "depositApp", type: "bytes32" },
    { name: "user", type: "bytes32" },
    { name: "payTo", type: "bytes32" },
    { name: "assetIn", type: "bytes32" },
    { name: "amountIn", type: "uint256" },
    { name: "dstLedger", type: "bytes32" },
    { name: "assetOut", type: "bytes32" },
    { name: "recipient", type: "bytes32" },
    { name: "amountOut", type: "uint256" },
    { name: "coverAsset", type: "address" },
    { name: "coverAmount", type: "uint256" },
    { name: "refundTo", type: "address" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiry", type: "uint64" },
    { name: "deadline", type: "uint64" },
    { name: "salt", type: "bytes32" },
  ],
} as const;

/** `SettleTypes.Quote` as viem encodes it. */
export interface SettleQuote {
  connector: Address;
  srcLedger: Hex;
  depositApp: Hex;
  user: Hex;
  payTo: Hex;
  assetIn: Hex;
  amountIn: bigint;
  dstLedger: Hex;
  assetOut: Hex;
  recipient: Hex;
  amountOut: bigint;
  coverAsset: Address;
  coverAmount: bigint;
  refundTo: Address;
  issuedAt: bigint;
  expiry: bigint;
  deadline: bigint;
  salt: Hex;
}

/** The quote as a Connector's `POST /quote` returns it (amounts as decimal strings, times as numbers). */
export interface SettleQuoteJson {
  connector: string;
  srcLedger: string;
  depositApp: string;
  user: string;
  payTo: string;
  assetIn: string;
  amountIn: string;
  dstLedger: string;
  assetOut: string;
  recipient: string;
  amountOut: string;
  coverAsset: string;
  coverAmount: string;
  refundTo: string;
  issuedAt: number;
  expiry: number;
  deadline: number;
  salt: string;
}

const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const HEX32 = /^0x[0-9a-fA-F]{64}$/;

/** keccak256 of a CAIP-2 id: how the contracts name a ledger. */
export function ledgerHash(caip2: string): Hex {
  return keccak256(toBytes(caip2));
}

/** An EVM address left-padded to 32 bytes (lowercase), as the quote carries chain-side accounts and assets. */
export function addressToBytes32(a: string): Hex {
  return pad(getAddress(a).toLowerCase() as Hex, { size: 32 });
}

/** The address inside a left-padded bytes32, or undefined when the upper 12 bytes are not zero. */
export function bytes32ToAddress(b: Hex): Address | undefined {
  if (!HEX32.test(b)) return undefined;
  if (!/^0x0{24}/.test(b)) return undefined;
  return getAddress(`0x${b.slice(26)}`);
}

export function settleDomain(hederaChainId: number, orderBook: string) {
  return {
    name: SETTLE_DOMAIN_NAME,
    version: SETTLE_DOMAIN_VERSION,
    chainId: hederaChainId,
    verifyingContract: getAddress(orderBook),
  } as const;
}

/** The order id: EIP-712 digest of `q` under the order book's domain (= `SettleTypes.orderId`). */
export function settleOrderId(q: SettleQuote, hederaChainId: number, orderBook: string): Hex {
  return hashTypedData({
    domain: settleDomain(hederaChainId, orderBook),
    types: SETTLE_QUOTE_TYPES,
    primaryType: "Quote",
    message: q,
  });
}

/** Who signed `orderId` (the raw digest, as `ECDSA.tryRecover(orderId, sig)` in the contracts). */
export async function recoverQuoteSigner(orderId: Hex, signature: Hex): Promise<Address> {
  return getAddress(await recoverAddress({ hash: orderId, signature }));
}

function uint(v: unknown, max: bigint, field: string): bigint {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const n = BigInt(v);
    if (n <= max) return n;
  }
  throw new Error(`${field} is not a valid amount`);
}

function b32(v: unknown, field: string): Hex {
  if (typeof v === "string" && HEX32.test(v)) return v.toLowerCase() as Hex;
  throw new Error(`${field} is not 32 bytes of hex`);
}

function addr(v: unknown, field: string): Address {
  if (typeof v === "string" && isAddress(v, { strict: false })) return getAddress(v);
  throw new Error(`${field} is not an address`);
}

/** Parse and type-check a quote from JSON. Throws an Error naming the bad field. */
export function quoteFromJson(j: unknown): SettleQuote {
  if (typeof j !== "object" || j === null) throw new Error("quote is missing");
  const o = j as Record<string, unknown>;
  return {
    connector: addr(o.connector, "connector"),
    srcLedger: b32(o.srcLedger, "srcLedger"),
    depositApp: b32(o.depositApp, "depositApp"),
    user: b32(o.user, "user"),
    payTo: b32(o.payTo, "payTo"),
    assetIn: b32(o.assetIn, "assetIn"),
    amountIn: uint(o.amountIn, UINT256_MAX, "amountIn"),
    dstLedger: b32(o.dstLedger, "dstLedger"),
    assetOut: b32(o.assetOut, "assetOut"),
    recipient: b32(o.recipient, "recipient"),
    amountOut: uint(o.amountOut, UINT256_MAX, "amountOut"),
    coverAsset: addr(o.coverAsset, "coverAsset"),
    coverAmount: uint(o.coverAmount, UINT256_MAX, "coverAmount"),
    refundTo: addr(o.refundTo, "refundTo"),
    issuedAt: uint(o.issuedAt, UINT64_MAX, "issuedAt"),
    expiry: uint(o.expiry, UINT64_MAX, "expiry"),
    deadline: uint(o.deadline, UINT64_MAX, "deadline"),
    salt: b32(o.salt, "salt"),
  };
}

export function quoteToJson(q: SettleQuote): SettleQuoteJson {
  return {
    connector: q.connector,
    srcLedger: q.srcLedger,
    depositApp: q.depositApp,
    user: q.user,
    payTo: q.payTo,
    assetIn: q.assetIn,
    amountIn: q.amountIn.toString(),
    dstLedger: q.dstLedger,
    assetOut: q.assetOut,
    recipient: q.recipient,
    amountOut: q.amountOut.toString(),
    coverAsset: q.coverAsset,
    coverAmount: q.coverAmount.toString(),
    refundTo: q.refundTo,
    issuedAt: Number(q.issuedAt),
    expiry: Number(q.expiry),
    deadline: Number(q.deadline),
    salt: q.salt,
  };
}

export function isSignature(s: unknown): s is Hex {
  return typeof s === "string" && isHex(s) && s.length === 132;
}

/**
 * The transactions that pay a Connector through `SettleDeposit.deposit(q, sig)` on the source network:
 * native coin = one call with `value = amountIn`; ERC-20 = `approve(deposit, amountIn)` (exactly that, never
 * unlimited) then `deposit` with value 0. Each one goes through the wallet's normal decode/approve path.
 */
export function buildDepositRequests(p: {
  quote: SettleQuote;
  signature: Hex;
  account: string;
  networkId: NetworkId;
  depositApp: string;
  idPrefix?: string;
}): DappRequest[] {
  const from = getAddress(p.account);
  const deposit = getAddress(p.depositApp);
  const token = bytes32ToAddress(p.quote.assetIn);
  if (!token) throw new Error("assetIn is not an EVM asset");
  const isNative = BigInt(token) === 0n;
  const base = {
    origin: "clip-wallet://route",
    via: "injected" as const,
    family: "evm" as const,
    networkId: p.networkId,
    method: "eth_sendTransaction",
  };
  const id = () => `${p.idPrefix ?? "settle"}-${globalThis.crypto.randomUUID()}`;
  const requests: DappRequest[] = [];
  if (!isNative) {
    requests.push({
      ...base,
      id: id(),
      params: [
        {
          from,
          to: token,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [deposit, p.quote.amountIn] }),
          value: "0x0",
        },
      ],
    });
  }
  requests.push({
    ...base,
    id: id(),
    params: [
      {
        from,
        to: deposit,
        data: encodeFunctionData({ abi: SETTLE_DEPOSIT_ABI, functionName: "deposit", args: [p.quote, p.signature] }),
        value: isNative ? numberToHex(p.quote.amountIn) : "0x0",
      },
    ],
  });
  return requests;
}
