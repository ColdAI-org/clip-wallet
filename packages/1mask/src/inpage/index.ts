/**
 * @clip-wallet/1mask/inpage — runs in the page's MAIN world.
 *
 * Installs the EIP-1193 provider (announced via EIP-6963), the Solana and Bitcoin Wallet Standard
 * wallets, and a postMessage transport to the content script. Holds no secrets and makes no
 * decisions: the background router answers everything.
 */
import { registerWallet } from "@wallet-standard/wallet";
import { assertCompatibilityModeOff } from "../shared/compat.js";
import { resolveChannel, resolveIdentity, type InpageConfig, type WalletIdentity } from "../shared/config.js";
import { ClipBitcoinWallet } from "./bitcoin.js";
import { ClipEthereumProvider, announceEip6963, claimWindowEthereum, type EIP6963ProviderDetail } from "./evm.js";
import { ClipSolanaWallet } from "./solana.js";
import { ClipSuiWallet } from "./sui.js";
import { ClipAptosWallet } from "./aptos.js";
import { createInpageTransport, type InpageTransport } from "./transport.js";

export interface InstalledOneMask {
  identity: WalletIdentity;
  transport: InpageTransport;
  evm?: { provider: ClipEthereumProvider; detail: EIP6963ProviderDetail; claimedWindowEthereum: boolean };
  solana?: ClipSolanaWallet;
  bitcoin?: ClipBitcoinWallet;
  sui?: ClipSuiWallet;
  aptos?: ClipAptosWallet;
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
  const want = { evm: true, solana: true, bitcoin: true, sui: true, aptos: true, ...config.providers };
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
  return out;
}

export { ClipEthereumProvider, announceEip6963, claimWindowEthereum } from "./evm.js";
export type { EIP6963ProviderDetail, EIP6963ProviderInfo, RequestArguments } from "./evm.js";
export { ClipSolanaWallet, SOLANA_FEATURES } from "./solana.js";
export { ClipBitcoinWallet, BITCOIN_FEATURES, BITCOIN_METHODS } from "./bitcoin.js";
export { ClipSuiWallet, SUI_FEATURES, SUI_SIGNING_METHODS, suiChain } from "./sui.js";
export { ClipAptosWallet, APTOS_FEATURES, METHOD_APTOS_NETWORK, aptosChain, toWireArg } from "./aptos.js";
export * from "./bitcoin-features.js";
export { createInpageTransport, type InpageTransport } from "./transport.js";
