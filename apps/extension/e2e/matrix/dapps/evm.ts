/**
 * EVM (Sepolia): wagmi/viem, discovery over EIP-6963 (wagmi's mipd store), signMessage verified with viem's
 * verifyMessage, sendTransaction of 1 wei to yourself. The same libraries a production EVM dapp ships.
 */
import { connect, createConfig, getConnectors, http, sendTransaction, signMessage, switchChain } from "@wagmi/core";
import { sepolia } from "@wagmi/core/chains";
import { verifyMessage } from "viem";
import { MESSAGE, expose, waitFor } from "../dapp-kit";

const config = createConfig({ chains: [sepolia], transports: { [sepolia.id]: http() }, multiInjectedProviderDiscovery: true });
const clip = () => waitFor(() => getConnectors(config).find((x) => x.id === "org.coldai.clipwallet"), "Clip Wallet (EIP-6963)");
let address: `0x${string}`;

expose({
  info: { dapp: "wagmi 3 + viem (EIP-6963 discovery) in a local page, Sepolia", why: "wagmi/viem is what most EVM dapps run; a local page keeps the run deterministic (live test-dapp: see the EVM live test)" },
  steps: {
    connect: async () => {
      const r = await connect(config, { connector: await clip(), chainId: sepolia.id });
      address = r.accounts[0]!;
      if (r.chainId !== sepolia.id) await switchChain(config, { chainId: sepolia.id });
      return { address, chainId: r.chainId };
    },
    sign: async () => {
      const signature = await signMessage(config, { message: MESSAGE });
      return { valid: await verifyMessage({ address, message: MESSAGE, signature }), how: "viem verifyMessage (EIP-191)" };
    },
    send: async () => ({ id: await sendTransaction(config, { to: address, value: 1n, chainId: sepolia.id }) }),
  },
});
