// Starknet: get-starknet finds window.starknet_clipwallet. starknetkit's default list doesn't include unlisted
// wallets, so add an InjectedConnector for it (see the starknetkit snippet).
import { getStarknet } from "@starknet-io/get-starknet-core";

type StarknetWallet = { id: string; name: string; request(call: { type: string; params?: unknown }): Promise<unknown> };

export async function connectStarknet() {
  const wallets = (await getStarknet().getAvailableWallets()) as unknown as StarknetWallet[];
  const clip = wallets.find((w) => w.id === "clipwallet");
  if (!clip) throw new Error("Clip Wallet isn't installed in this browser.");
  const [address] = (await clip.request({ type: "wallet_requestAccounts" })) as string[];
  const chainId = (await clip.request({ type: "wallet_requestChainId" })) as string; // "SN_SEPOLIA" as a felt
  return { address, chainId };
}
