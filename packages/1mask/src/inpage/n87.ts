/**
 * networks87 injected sides, each under the wallet's own identity on window[globalKey].<family> plus the
 * ecosystem's own discovery: Cosmos SDK chains (a Keplr-compatible API at window[globalKey].cosmos, never window.keplr,
 * for Osmosis, dYdX, ZIGChain, Provenance, THORChain and Initia), TRON (TIP-1193 provider announced with TIP-6963), Stacks (SIP-030 provider registered on
 * window.wbip_providers, WBIP-004), Fuel (a FuelConnector announced with the FuelConnector event)
 * and the XRP Ledger (XLS-72d: Wallet Standard with xrpl:signTransaction / xrpl:signAndSubmitTransaction).
 * Families without a verifiable third-party wallet standard (ICP, Antelope; Bitcoin Cash is reached over WalletConnect wc2-bch-bcr) are send and
 * receive only (see docs/r1/networks87.md).
 */
import type { Network } from "@clip-wallet/core";
import type { WalletIdentity } from "../shared/config.js";
import type { InjectedOptions } from "./injected-base.js";
import { installCosmosProvider, type ClipCosmosProvider } from "./cosmos.js";
import { installFuelConnector, type ClipFuelConnector } from "./fuel.js";
import { installStacksProvider, type ClipStacksProvider } from "./stacks.js";
import { installTronProvider, type ClipTronProvider } from "./tron.js";
import { installXrpl, type ClipXrplWallet } from "./xrpl.js";
import type { InpageTransport } from "./transport.js";

export interface InstalledN87 {
  cosmos?: ClipCosmosProvider;
  tron?: ClipTronProvider;
  stacks?: ClipStacksProvider;
  fuel?: ClipFuelConnector;
  xrpl?: ClipXrplWallet;
  stop(): void;
}

export type N87ProviderFamily = "cosmos" | "tron" | "stacks" | "fuel" | "xrpl";

/** Installs the providers for every networks87 family present in `networks`. */
export function installN87Providers(
  win: Window,
  identity: WalletIdentity,
  networks: Network[],
  transport: InpageTransport,
  opts: InjectedOptions & { want?: Partial<Record<N87ProviderFamily, boolean>> } = {},
): InstalledN87 {
  const want: Record<N87ProviderFamily, boolean> = { cosmos: true, tron: true, stacks: true, fuel: true, xrpl: true, ...opts.want };
  const has = (f: string) => networks.some((n) => n.family === f);
  const g = opts.globalKey ? { globalKey: opts.globalKey } : {};
  const stops: (() => void)[] = [];
  const out: InstalledN87 = { stop: () => stops.forEach((s) => s()) };
  if (want.cosmos && ["cosmos", "provenance", "thorchain", "initia"].some(has)) {
    const r = installCosmosProvider(win, identity, networks, transport, g);
    out.cosmos = r.provider;
    stops.push(r.stop);
  }
  if (want.tron && has("tron")) {
    const r = installTronProvider(win, identity, networks, transport, g);
    out.tron = r.provider;
    stops.push(r.stop);
  }
  if (want.stacks && has("stacks")) {
    const r = installStacksProvider(win, identity, networks, transport, g);
    out.stacks = r.provider;
    stops.push(r.stop);
  }
  if (want.fuel && has("fuel")) {
    const r = installFuelConnector(win, identity, transport, g);
    out.fuel = r.connector;
    stops.push(r.stop);
  }
  if (want.xrpl && has("xrpl")) {
    const r = installXrpl(win, identity, networks, transport, g);
    if (r) {
      out.xrpl = r.wallet;
      stops.push(r.stop);
    }
  }
  return out;
}

export * from "./cosmos.js";
export * from "./tron.js";
export * from "./stacks.js";
export * from "./fuel.js";
export * from "./xrpl.js";
