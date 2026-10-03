import type { DappRequest } from "@clip-wallet/core";
import type { MockSpec } from "./helpers.js";
import { BOB, ME, ROOTSTOCK, SEPOLIA, SEPOLIA_USDC } from "./helpers.js";

const GWEI = 1_000_000_000n;
const hex = (n: bigint | number) => `0x${n.toString(16)}`;

/** Sepolia node state used by the signing fixtures. Changing these changes the digests in signatures.ts. */
export const SEPOLIA_STATE: MockSpec = {
  rpc: {
    eth_getTransactionCount: "0x7",
    eth_getBlockByNumber: { number: "0x100", baseFeePerGas: hex(GWEI) },
    eth_gasPrice: hex(2n * GWEI),
    eth_maxPriorityFeePerGas: hex(GWEI),
    eth_estimateGas: "0x5208",
    eth_sendRawTransaction: "0x" + "ab".repeat(32),
  },
};

export const ROOTSTOCK_STATE: MockSpec = {
  rpc: {
    eth_getTransactionCount: "0x2",
    eth_getBlockByNumber: { number: "0x100", minimumGasPrice: "0x0" },
    eth_gasPrice: hex(60_000_000n),
    eth_estimateGas: "0x5208",
    eth_sendRawTransaction: "0x" + "cd".repeat(32),
  },
};

export const SEND_NATIVE: DappRequest = {
  id: "req-send-native",
  origin: "https://app.example.com",
  via: "injected",
  family: "evm",
  networkId: SEPOLIA,
  method: "eth_sendTransaction",
  params: [{ from: ME, to: BOB, value: hex(10n ** 16n) }],
};

export const SEND_LEGACY: DappRequest = { ...SEND_NATIVE, id: "req-send-legacy", networkId: ROOTSTOCK };

export const PERSONAL: DappRequest = {
  id: "req-personal",
  origin: "https://app.example.com",
  via: "injected",
  family: "evm",
  networkId: SEPOLIA,
  method: "personal_sign",
  params: ["0x48656c6c6f20436c6970", ME], // "Hello Clip"
};

export const PERMIT_TYPED = {
  types: {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  },
  primaryType: "Permit",
  domain: { name: "USDC", version: "2", chainId: 11155111, verifyingContract: SEPOLIA_USDC },
  message: {
    owner: ME,
    spender: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    value: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    nonce: "0",
    deadline: "1893456000",
  },
};

export const TYPED: DappRequest = {
  id: "req-typed",
  origin: "https://app.example.com",
  via: "injected",
  family: "evm",
  networkId: SEPOLIA,
  method: "eth_signTypedData_v4",
  params: [ME, JSON.stringify(PERMIT_TYPED)],
};
