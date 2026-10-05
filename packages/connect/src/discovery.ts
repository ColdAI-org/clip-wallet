/**
 * Wallet discovery with no dependencies:
 *   - EIP-6963 (https://eips.ethereum.org/EIPS/eip-6963): listen for `eip6963:announceProvider`, ask with
 *     `eip6963:requestProvider`.
 *   - Wallet Standard (https://github.com/wallet-standard/wallet-standard, @wallet-standard/app's protocol): dispatch
 *     `wallet-standard:app-ready` with a `register` callback and listen for `wallet-standard:register-wallet`.
 * Both are plain DOM events, so any wallet that follows them is found, not only Clip Wallet.
 */

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on?(event: string, listener: (...args: any[]) => void): unknown;
  removeListener?(event: string, listener: (...args: any[]) => void): unknown;
}

export interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface Eip6963ProviderDetail {
  info: Eip6963ProviderInfo;
  provider: Eip1193Provider;
}

/** The parts of a Wallet Standard wallet Clip Connect reads (structurally @wallet-standard/base's Wallet). */
export interface StandardWallet {
  readonly name: string;
  readonly icon: string;
  readonly chains: readonly string[];
  readonly features: Readonly<Record<string, unknown>>;
  readonly accounts: readonly { address: string; publicKey: Uint8Array; chains: readonly string[]; features: readonly string[] }[];
}

/** Clip Wallet's EIP-6963 rdns and Wallet Standard name. Kit-built wallets announce their own; pass `prefer`. */
export const CLIP_WALLET = { rdns: "org.coldai.clipwallet", name: "Clip Wallet" } as const;

type Win = Window & typeof globalThis;

const eip6963 = new Map<string, Eip6963ProviderDetail>();
const standard = new Set<StandardWallet>();
const listening = new WeakSet<object>();

function listen(win: Win) {
  if (listening.has(win)) return;
  listening.add(win);
  win.addEventListener("eip6963:announceProvider", (e: Event) => {
    const d = (e as CustomEvent<Eip6963ProviderDetail>).detail;
    if (d?.info?.uuid && typeof d.provider?.request === "function") eip6963.set(d.info.uuid, d);
  });
  const register = (...wallets: StandardWallet[]) => {
    for (const w of wallets) if (w && typeof w.name === "string" && w.features) standard.add(w);
    return () => wallets.forEach((w) => standard.delete(w));
  };
  win.addEventListener("wallet-standard:register-wallet", (e: Event) => {
    const cb = (e as CustomEvent<(api: { register: typeof register }) => void>).detail;
    try {
      cb?.({ register });
    } catch {
      /* a broken wallet must not break discovery */
    }
  });
  // Wallets that loaded before us registered with apps that were already there: tell them we're here too.
  try {
    win.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: { register } }));
  } catch {
    /* non-DOM environments */
  }
}

/** Starts listening (idempotent) and asks EIP-6963 wallets to announce. */
export function startDiscovery(win: Win = globalThis.window as Win): void {
  if (!win?.addEventListener) return;
  listen(win);
  win.dispatchEvent(new Event("eip6963:requestProvider"));
}

/** Everything found so far, after giving wallets `waitMs` to answer. */
export async function discover(opts: { window?: Win; waitMs?: number } = {}): Promise<{ eip6963: Eip6963ProviderDetail[]; standard: StandardWallet[] }> {
  startDiscovery(opts.window);
  if ((opts.waitMs ?? 120) > 0) await new Promise((r) => setTimeout(r, opts.waitMs ?? 120));
  return { eip6963: [...eip6963.values()], standard: [...standard] };
}

/** Synchronous view (wagmi's connector target needs one). */
export function discovered(): { eip6963: Eip6963ProviderDetail[]; standard: StandardWallet[] } {
  return { eip6963: [...eip6963.values()], standard: [...standard] };
}

/** Test seam. */
export function resetDiscovery() {
  eip6963.clear();
  standard.clear();
}

export interface Preference {
  rdns?: string;
  name?: string;
}

/** The preferred wallet first (Clip Wallet by default), then everything else in discovery order. */
export function rankEip6963(list: Eip6963ProviderDetail[], prefer: Preference = CLIP_WALLET): Eip6963ProviderDetail[] {
  const hit = (d: Eip6963ProviderDetail) => d.info.rdns === prefer.rdns || (!!prefer.name && d.info.name === prefer.name);
  return [...list.filter(hit), ...list.filter((d) => !hit(d))];
}

export function rankStandard(list: StandardWallet[], prefer: Preference = CLIP_WALLET): StandardWallet[] {
  const hit = (w: StandardWallet) => w.name === (prefer.name ?? CLIP_WALLET.name);
  return [...list.filter(hit), ...list.filter((w) => !hit(w))];
}
