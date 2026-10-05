/**
 * An unmodified wagmi/viem dapp: EIP-6963 discovery (wagmi's multiInjectedProviderDiscovery, built on mipd), connect,
 * signMessage, sendTransaction. No Clip SDK, no Clip-specific code: it picks the announced provider by rdns like any
 * wallet list would.
 */
import { connect, createConfig, getConnectors, http, sendTransaction, signMessage } from "@wagmi/core";
import { baseSepolia, sepolia } from "@wagmi/core/chains";
import { verifyMessage } from "viem";

const config = createConfig({
  chains: [sepolia, baseSepolia],
  transports: { [sepolia.id]: http(), [baseSepolia.id]: http() },
  multiInjectedProviderDiscovery: true,
});

const clip = async () => {
  for (let i = 0; i < 50; i++) {
    const c = getConnectors(config).find((x) => x.id === "org.coldai.clipwallet");
    if (c) return c;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Clip Wallet was not discovered");
};

let address: `0x${string}` | undefined;

const steps: Record<string, () => Promise<unknown>> = {
  discover: async () => {
    const c = await clip();
    return { id: c.id, name: c.name, type: c.type, hasIcon: typeof c.icon === "string" && c.icon.startsWith("data:") };
  },
  connect: async () => {
    const r = await connect(config, { connector: await clip() });
    address = r.accounts[0];
    return { accounts: r.accounts.length, chainId: r.chainId };
  },
  sign: async () => {
    const message = "Hello from an unmodified wagmi dapp";
    const signature = await signMessage(config, { message });
    return { valid: await verifyMessage({ address: address!, message, signature }) };
  },
  send: async () => {
    try {
      const hash = await sendTransaction(config, { to: address!, value: 0n });
      return { hash: typeof hash };
    } catch (e) {
      const err = e as { name?: string; cause?: { code?: number } };
      return { error: err.name, code: err.cause?.code };
    }
  },
};

(window as unknown as { __compat: unknown }).__compat = { run: (s: string) => steps[s]!() };
