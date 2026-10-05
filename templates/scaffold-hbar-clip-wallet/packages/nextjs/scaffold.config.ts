import * as chains from "viem/chains";

export type ScaffoldConfig = {
  targetNetworks: readonly [chains.Chain, ...chains.Chain[]];
  pollingInterval: number;
  rpcOverrides?: Record<number, string>;
  enableBurnerWallet: boolean;
  walletConnectProjectId: string;
};

/**
 * Hedera testnet only, like the wallet (packages/extension/clip.config.ts). Add chains.hedera here only after the
 * wallet itself has passed its mainnet checklist (packages/extension/MAINNET.md).
 */
const targetNetworks = [chains.hederaTestnet] as const satisfies readonly [chains.Chain, ...chains.Chain[]];

const scaffoldConfig = {
  targetNetworks,

  pollingInterval: 10000,

  // The point of this dapp is your wallet; Scaffold-HBAR's burner wallet stays off.
  enableBurnerWallet: false,

  rpcOverrides: {
    [chains.hederaTestnet.id]: process.env.NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL || "https://testnet.hashio.io/api",
  },

  // Scaffold-HBAR's shared demo id; set NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID (pnpm wallet:identity can) for your own.
  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID || "3a8170812b534d0ff9d794f19a901d64",
} as const satisfies ScaffoldConfig;

export default scaffoldConfig;
