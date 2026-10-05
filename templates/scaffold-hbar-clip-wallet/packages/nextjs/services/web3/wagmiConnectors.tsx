import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { metaMaskWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { rainbowkitBurnerWallet } from "burner-connector";
import * as chains from "viem/chains";
import scaffoldConfig from "~~/scaffold.config";
import { WALLET_NAME } from "~~/utils/wallet";

const wallets = [metaMaskWallet, walletConnectWallet];

const DEV_CHAIN_IDS = new Set<number>([chains.hardhat.id, chains.foundry.id, chains.hederaTestnet.id]);

const hasDevNetwork = scaffoldConfig.targetNetworks.some(n => DEV_CHAIN_IDS.has(n.id));

export const wagmiConnectors = () => {
  if (typeof window === "undefined") {
    return [];
  }

  const walletGroups = [
    {
      groupName: "Supported Wallets",
      wallets,
    },
  ];

  if (scaffoldConfig.enableBurnerWallet && hasDevNetwork) {
    walletGroups.push({
      groupName: "Development",
      wallets: [rainbowkitBurnerWallet],
    });
  }

  return connectorsForWallets(walletGroups, {
    appName: `${WALLET_NAME} demo`,
    projectId: scaffoldConfig.walletConnectProjectId,
  });
};
