/**
 * Hedera testnet over the injected EVM path: wagmi/viem with viem's hederaTestnet chain (296, Hashio JSON-RPC),
 * EIP-6963 discovery, personal_sign verified with viem, and a 1-tinybar (10^10 weibar) self-transfer via
 * eth_sendTransaction. This is how Hedera EVM dapps (Scaffold-HBAR, SaucerSwap's EVM side) talk to a wallet.
 */
import { connect, createConfig, getConnectors, http, sendTransaction, signMessage, switchChain } from "@wagmi/core";
import { hederaTestnet } from "@wagmi/core/chains";
import { verifyMessage } from "viem";
import { MESSAGE, expose, waitFor } from "../dapp-kit";

const config = createConfig({ chains: [hederaTestnet], transports: { [hederaTestnet.id]: http("https://testnet.hashio.io/api") }, multiInjectedProviderDiscovery: true });
const clip = () => waitFor(() => getConnectors(config).find((x) => x.id === "org.coldai.clipwallet"), "Clip Wallet (EIP-6963)");
let address: `0x${string}`;

expose({
  info: { dapp: "wagmi 3 + viem hederaTestnet (EIP-6963, Hashio JSON-RPC) in a local page, Hedera testnet", why: "the injected EIP-1193 path every Hedera EVM dapp uses; a local page pins chain 296" },
  steps: {
    connect: async () => {
      const r = await connect(config, { connector: await clip(), chainId: hederaTestnet.id });
      address = r.accounts[0]!;
      if (r.chainId !== hederaTestnet.id) await switchChain(config, { chainId: hederaTestnet.id });
      return { address, chainId: r.chainId };
    },
    sign: async () => {
      const signature = await signMessage(config, { message: MESSAGE });
      return { valid: await verifyMessage({ address, message: MESSAGE, signature }), how: "viem verifyMessage (EIP-191)" };
    },
    send: async () => ({ id: await sendTransaction(config, { to: address, value: 10_000_000_000n, chainId: hederaTestnet.id }) }),
  },
});
