/**
 * Contracts this project didn't deploy, shown on /debug. Hedera's system contracts live at fixed addresses on every
 * Hedera network; calling them from /debug sends the request through your wallet, so each call is a way to see its
 * decoded approval screen.
 *
 * - PRNG (HIP-351) at 0x169: a pseudorandom 32-byte seed from the network.
 * - Exchange rate (HIP-475) at 0x168: convert between tinycents (USD) and tinybars at the network's current rate.
 */
import { GenericContractsDeclaration } from "~~/utils/scaffold-hbar/contract";

const externalContracts = {
  296: {
    HederaPrng: {
      address: "0x0000000000000000000000000000000000000169",
      abi: [
        {
          type: "function",
          name: "getPseudorandomSeed",
          inputs: [],
          outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
          stateMutability: "nonpayable",
        },
      ],
    },
    HederaExchangeRate: {
      address: "0x0000000000000000000000000000000000000168",
      abi: [
        {
          type: "function",
          name: "tinycentsToTinybars",
          inputs: [{ name: "tinycents", type: "uint256", internalType: "uint256" }],
          outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
          stateMutability: "nonpayable",
        },
        {
          type: "function",
          name: "tinybarsToTinycents",
          inputs: [{ name: "tinybars", type: "uint256", internalType: "uint256" }],
          outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
          stateMutability: "nonpayable",
        },
      ],
    },
  },
} as const;

export default externalContracts satisfies GenericContractsDeclaration;
