/**
 * Phase 2 injected sides (NEAR, Stellar, Tezos Beacon relay, Algorand), importable on their own as
 * @clip-wallet/1mask/inpage/p2 until installOneMask (inpage/index.ts) installs them — see
 * docs/phase2/integration/near-stellar-tezos-algorand.md.
 */
import type { Network } from "@clip-wallet/core";
import type { WalletIdentity } from "../shared/config.js";
import { installAlgorandProvider, type ClipAlgorandProvider } from "./algorand.js";
import type { InjectedOptions } from "./injected-base.js";
import { installNearProvider, type ClipNearProvider } from "./near.js";
import { installStellarProvider, type ClipStellarProvider } from "./stellar.js";
import { installTezosBeaconRelay } from "./tezos.js";
import type { InpageTransport } from "./transport.js";

export interface InstalledP2 {
  near?: ClipNearProvider;
  stellar?: ClipStellarProvider;
  algorand?: ClipAlgorandProvider;
  tezosBeacon?: { extensionId: string };
  stop(): void;
}

/** Installs the providers for every family present in `networks`. */
export function installP2Providers(
  win: Window,
  identity: WalletIdentity,
  networks: Network[],
  transport: InpageTransport,
  opts: InjectedOptions & {
    /** Beacon matches this against its extension list (`id` = the browser extension id, e.g. chrome.runtime.id). */
    beaconExtensionId?: string;
    want?: { near?: boolean; stellar?: boolean; tezos?: boolean; algorand?: boolean } } = {},
): InstalledP2 {
  const want = { near: true, stellar: true, tezos: true, algorand: true, ...opts.want };
  const has = (f: string) => networks.some((n) => n.family === f);
  const stops: (() => void)[] = [];
  const out: InstalledP2 = { stop: () => stops.forEach((s) => s()) };
  if (want.near && has("near")) {
    const r = installNearProvider(win, identity, networks, transport, opts);
    out.near = r.provider;
    stops.push(r.stop);
  }
  if (want.stellar && has("stellar")) {
    const r = installStellarProvider(win, identity, networks, transport, opts);
    out.stellar = r.provider;
    stops.push(r.stop);
  }
  if (want.algorand && has("algorand")) {
    const r = installAlgorandProvider(win, identity, networks, transport, opts);
    out.algorand = r.provider;
    stops.push(r.stop);
  }
  if (want.tezos && has("tezos")) {
    const r = installTezosBeaconRelay(win, identity, transport, opts.beaconExtensionId ? { extensionId: opts.beaconExtensionId } : {});
    out.tezosBeacon = { extensionId: r.extensionId };
    stops.push(r.stop);
  }
  return out;
}

export * from "./near.js";
export * from "./stellar.js";
export * from "./algorand.js";
export * from "./tezos.js";
export { DEFAULT_GLOBAL_KEY, type InjectedOptions } from "./injected-base.js";
export * from "../shared/p2-methods.js";
