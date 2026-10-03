/**
 * @clip-wallet/kit-modules/tezos — the wallet side of Beacon (TZIP-10) for Clip Wallet.
 *
 *  - createBeaconExtensionPeer: browser-extension discovery/pairing over postMessage (with 1Mask's page relay).
 *  - createBeaconP2PWallet: QR / pairing-string connections over Beacon's Matrix relays (@airgap/beacon-wallet).
 */
import type { WalletClient } from "@airgap/beacon-wallet";
import type { WalletClientLike } from "./p2p.js";

export * from "./messages.js";
export { createBeaconExtensionPeer, type BeaconExtensionPeer, type BeaconExtensionPeerOptions, type BeaconPeerStorage, type BeaconReply } from "./extension-peer.js";
export { createBeaconP2PWallet, type BeaconP2PWalletOptions, type WalletClientLike } from "./p2p.js";

/** Compile-time check that Beacon's WalletClient satisfies the structural type createBeaconP2PWallet takes. */
export type _WalletClientFits = WalletClient extends WalletClientLike ? true : never;
