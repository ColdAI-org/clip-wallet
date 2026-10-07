/**
 * 1Mask inpage providers for a dapp tab, bundled by scripts/build-inpage.mjs into inpage.generated.ts as the body
 * of `inpageMain(__CLIP_BOOT__)`. The dapp preload runs it in the page's MAIN world at document start
 * (contextBridge.executeInMainWorld), before any page script: EIP-1193 + EIP-6963, Wallet Standard (Solana, Sui,
 * Aptos, Bitcoin), CIP-30, injectedWeb3, get-starknet, TON Connect, window.clipwallet.{near,stellar,algorand} and the
 * Tezos Beacon relay, exactly as the extension injects them.
 *
 * The providers talk to the preload's 1Mask content bridge over window.postMessage on a per-run random channel.
 * Nothing in this world is trusted: the main process sets the origin from the frame (onemask-relay.ts).
 */
import { installOneMask } from "@clip-wallet/1mask/inpage";
import type { InpageConfig } from "@clip-wallet/1mask";

declare const __CLIP_BOOT__: {
  channel: string;
  networks: InpageConfig["networks"];
  identity: NonNullable<InpageConfig["identity"]>;
  tonConnect?: InpageConfig["tonConnect"];
};

if (!(window as { __clip1maskInstalled?: boolean }).__clip1maskInstalled) {
  Object.defineProperty(window, "__clip1maskInstalled", { value: true });
  installOneMask({
    networks: __CLIP_BOOT__.networks,
    channel: __CLIP_BOOT__.channel,
    identity: __CLIP_BOOT__.identity,
    ...(__CLIP_BOOT__.tonConnect ? { tonConnect: __CLIP_BOOT__.tonConnect } : {}),
  });
}
