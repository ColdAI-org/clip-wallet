// Stellar Wallets Kit lists only its modules: add Clip Wallet's (SEP-43 under the hood).
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { Networks, type ModuleInterface } from "@creit.tech/stellar-wallets-kit/types";
import { ClipWalletModule } from "@clip-wallet/kit-modules/stellar";

// ClipWalletModule matches the kit's ModuleInterface at run time; its moduleType is typed as a string, not the kit's
// enum, so TypeScript needs the cast.
const clip = new ClipWalletModule() as unknown as ModuleInterface;
StellarWalletsKit.init({ modules: [...defaultModules(), clip], network: Networks.TESTNET });

export async function addConnectButton(container: HTMLElement) {
  await StellarWalletsKit.createButton(container); // opens the kit's modal, Clip Wallet included
}
