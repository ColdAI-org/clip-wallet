/**
 * 1Mask inpage providers (MAIN world) for all 14 families: EIP-1193 + EIP-6963, Wallet Standard (Solana, Bitcoin,
 * Sui), AIP-62 (Aptos), CIP-30 (Cardano), injectedWeb3 (Substrate), get-starknet, TON Connect,
 * window.<wallet key>.{near,stellar,algorand} and the Tezos Beacon relay. Identity, networks and the message channel
 * are baked in at build time by clipWallet() (no chrome APIs in the MAIN world).
 */
import { installOneMask } from "@clip-wallet/1mask/inpage";
import type {} from "../globals";

/** Where 1Mask's content scripts run. */
export const CONTENT_MATCHES = ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"];

export function installInpage(): void {
  installOneMask({
    networks: __CLIP_PUBLIC_NETWORKS__,
    channel: __CLIP_CHANNEL__,
    identity: __CLIP_IDENTITY__,
    tonConnect: __CLIP_TON_CONNECT__,
    globalKey: __CLIP_WALLET_KEY__,
    ...(__CLIP_EXTENSION_ID__ ? { beaconExtensionId: __CLIP_EXTENSION_ID__ } : {}),
  });
}
