/**
 * @clip-wallet/1mask/inpage — runs in the page's MAIN world.
 *
 * Installs the EIP-1193 provider (announced via EIP-6963), the Solana and Bitcoin Wallet Standard
 * wallets, and a postMessage transport to the content script. Holds no secrets and makes no
 * decisions: the background router answers everything.
 *
 * @module
 */
import { registerWallet } from "@wallet-standard/wallet";
import { assertCompatibilityModeOff } from "../shared/compat.js";
import { resolveChannel, resolveIdentity, type InpageConfig, type WalletIdentity } from "../shared/config.js";
import { ClipBitcoinWallet } from "./bitcoin.js";
import { ClipEthereumProvider, announceEip6963, claimWindowEthereum, type EIP6963ProviderDetail } from "./evm.js";
import { installP2Providers, type InstalledP2 } from "./p2.js";
import { ClipSolanaWallet } from "./solana.js";
import { ClipSuiWallet } from "./sui.js";
import { ClipAptosWallet } from "./aptos.js";
import { installCardano, type ClipCardanoWallet } from "./cardano.js";
import { installSubstrate, type ClipSubstrateProvider } from "./substrate.js";
import { ClipStarknetWallet, injectStarknet } from "./starknet.js";
import { ClipTonConnectBridge, injectTonConnect } from "./ton.js";
import { createInpageTransport, type InpageTransport } from "./transport.js";
import { installHederaExtensionDiscovery } from "./hedera.js";

export interface InstalledOneMask {
  identity: WalletIdentity;
  transport: InpageTransport;
  evm?: { provider: ClipEthereumProvider; detail: EIP6963ProviderDetail; claimedWindowEthereum: boolean };
  solana?: ClipSolanaWallet;
  bitcoin?: ClipBitcoinWallet;
  sui?: ClipSuiWallet;
  aptos?: ClipAptosWallet;
  cardano?: ClipCardanoWallet;
  substrate?: ClipSubstrateProvider;
  starknet?: ClipStarknetWallet;
  ton?: ClipTonConnectBridge;
  /** NEAR (window.clipwallet.near + NEAR Connect), Stellar (SEP-43), Algorand, Tezos (Beacon relay). */
  p2?: InstalledP2;
  /** Hedera extension discovery (DAppConnector / HashConnect): the id dApps address the wallet by. */
  hedera?: { extensionId: string };
  destroy(): void;
}

export function installOneMask(config: InpageConfig, win: Window = window): InstalledOneMask {
  assertCompatibilityModeOff(config.compatibility);
  const identity = resolveIdentity(config.identity);
  const transport = createInpageTransport({
    channel: resolveChannel(config.channel),
    win,
    ...(config.requestTimeoutMs !== undefined ? { timeoutMs: config.requestTimeoutMs } : {}),
  });
  const want = { evm: true, solana: true, bitcoin: true, sui: true, aptos: true, cardano: true, substrate: true, starknet: true, ton: true, ...config.providers };
  const stops: (() => void)[] = [() => transport.destroy()];
  const out: InstalledOneMask = { identity, transport, destroy: () => stops.forEach((s) => s()) };

  if (want.evm) {
    const provider = new ClipEthereumProvider(transport);
    const { detail, stop } = announceEip6963(win, identity, provider);
    stops.push(stop);
    const claimed = config.claimWindowEthereum === true ? claimWindowEthereum(win, provider) : false;
    out.evm = { provider, detail, claimedWindowEthereum: claimed };
  }
  if (want.solana && config.networks.some((n) => n.family === "solana")) {
    out.solana = new ClipSolanaWallet(identity, config.networks, transport);
    registerWallet(out.solana);
  }
  if (want.bitcoin && config.networks.some((n) => n.family === "bitcoin")) {
    out.bitcoin = new ClipBitcoinWallet(identity, config.networks, transport);
    registerWallet(out.bitcoin);
  }
  if (want.sui && config.networks.some((n) => n.family === "sui")) {
    out.sui = new ClipSuiWallet(identity, config.networks, transport);
    registerWallet(out.sui);
  }
  if (want.aptos && config.networks.some((n) => n.family === "aptos")) {
    const aptos = new ClipAptosWallet(identity, config.networks, transport);
    out.aptos = aptos;
    stops.push(() => aptos.destroy());
    registerWallet(aptos);
  }
  if (want.cardano && config.networks.some((n) => n.family === "cardano")) {
    const c = installCardano(win, identity, transport);
    if (c) {
      out.cardano = c.wallet;
      stops.push(c.destroy);
    }
  }
  if (want.substrate && config.networks.some((n) => n.family === "substrate")) {
    const sub = installSubstrate(win, identity, transport);
    if (sub) {
      out.substrate = sub.provider;
      stops.push(sub.destroy);
    }
  }
  if (want.starknet && config.networks.some((n) => n.family === "starknet")) {
    out.starknet = new ClipStarknetWallet(identity, transport);
    stops.push(injectStarknet(win, out.starknet, { claimWindowStarknet: config.claimWindowStarknet === true }).stop);
  }
  if (want.ton && config.tonConnect && config.networks.some((n) => n.family === "ton")) {
    const { key, walletInfo, ...device } = config.tonConnect;
    out.ton = new ClipTonConnectBridge(transport, device, walletInfo);
    stops.push(injectTonConnect(win, key, out.ton).stop);
  }
  if (config.providers?.hedera !== false && config.networks.some((n) => n.family === "hedera")) {
    const h = installHederaExtensionDiscovery(win, identity, transport, config.beaconExtensionId ? { extensionId: config.beaconExtensionId } : {});
    out.hedera = { extensionId: h.extensionId };
    stops.push(h.stop);
  }
  const p2 = installP2Providers(win, identity, config.networks, transport, {
    want: { near: want.near ?? true, stellar: want.stellar ?? true, tezos: want.tezos ?? true, algorand: want.algorand ?? true },
    ...(config.globalKey ? { globalKey: config.globalKey } : {}),
    ...(config.beaconExtensionId ? { beaconExtensionId: config.beaconExtensionId } : {}),
  });
  stops.push(p2.stop);
  out.p2 = p2;
  return out;
}

export { ClipEthereumProvider, announceEip6963, claimWindowEthereum } from "./evm.js";
export { HEDERA_EXTENSION_EVENTS, installHederaExtensionDiscovery, isWalletConnectPairingUri, type HederaDiscoveryOptions } from "./hedera.js";
export type { EIP6963ProviderDetail, EIP6963ProviderInfo, RequestArguments } from "./evm.js";
export { ClipSolanaWallet, SOLANA_FEATURES } from "./solana.js";
export { ClipBitcoinWallet, BITCOIN_FEATURES, BITCOIN_METHODS } from "./bitcoin.js";
export { ClipSuiWallet, SUI_FEATURES, SUI_SIGNING_METHODS, suiChain } from "./sui.js";
export { ClipAptosWallet, APTOS_FEATURES, METHOD_APTOS_NETWORK, aptosChain, toWireArg } from "./aptos.js";
export * from "./bitcoin-features.js";
export { createInpageTransport, type InpageTransport } from "./transport.js";
export * from "./p2.js";
export { ClipCardanoWallet, Cip30Error, CIP30_METHODS, APIErrorCode, TxSignErrorCode, DataSignErrorCode, TxSendErrorCode, cardanoWalletKey, installCardano, toCip30Error } from "./cardano.js";
export { ClipSubstrateProvider, SUBSTRATE_INPAGE_METHODS, installSubstrate, substrateExtensionName, caip2FromGenesis } from "./substrate.js";
export { ClipStarknetWallet, StarknetWalletError, STARKNET_ERRORS, injectStarknet, starknetWalletId, toStarknetError } from "./starknet.js";
export { ClipTonConnectBridge, TON_ERRORS, TON_PROTOCOL_VERSION, injectTonConnect, toTonError } from "./ton.js";
export type { ConnectEvent, DeviceInfo, TonConnectRequest, TonFeature, TonWalletInfo, WalletEvent, WalletResponse } from "./ton.js";
export type { InpageConfig, WalletIdentity } from "../shared/config.js";
