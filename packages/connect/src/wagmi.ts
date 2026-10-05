/**
 * A wagmi connector for Clip Connect (@wagmi/core is an optional peer, v2 or v3).
 *
 *   createConfig({ connectors: [clipConnect()], ... })
 *
 * It is wagmi's own `injected` connector pointed at Clip Wallet's EIP-6963 provider, falling back to another
 * announced wallet, then `window.ethereum`. wagmi's EIP-6963 discovery still lists every other wallet as usual; this
 * gives an app one "Connect" button that prefers Clip. Use @clip-wallet/connect's `connect()` (or the React hooks)
 * on the same provider for pay() with auxiliary funds.
 */
import { injected, type CreateConnectorFn } from "@wagmi/core";
import { CLIP_WALLET, discovered, rankEip6963, startDiscovery, type Preference } from "./discovery.js";

export interface ClipConnectorParameters {
  /** Prefer another wallet (kit-built wallets announce their own rdns). Default: Clip Wallet. */
  prefer?: Preference;
  shimDisconnect?: boolean;
}

export function clipConnect(parameters: ClipConnectorParameters = {}): CreateConnectorFn {
  startDiscovery();
  const prefer = parameters.prefer ?? CLIP_WALLET;
  // `target` typed loosely: wagmi's Target type differs between v2 and v3 (both are supported peers).
  return injected({
    shimDisconnect: parameters.shimDisconnect ?? true,
    target() {
      startDiscovery();
      const [first] = rankEip6963(discovered().eip6963, prefer);
      if (first) return { id: "clipConnect", name: first.info.name, icon: first.info.icon, provider: () => first.provider as never };
      return { id: "clipConnect", name: "Browser wallet", provider: ((w?: unknown) => (w as { ethereum?: unknown } | undefined)?.ethereum) as never };
    },
  });
}
