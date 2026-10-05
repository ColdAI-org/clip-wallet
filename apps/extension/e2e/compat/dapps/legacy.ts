/**
 * A plain legacy dapp: window.ethereum only (no EIP-6963 listener). Clip Wallet never claims or wraps a
 * window.ethereum it doesn't own, so a page whose other wallet sets window.ethereum keeps talking to that wallet, and
 * a page with no other wallet sees whatever this build has always shown there.
 */
interface Legacy {
  request(a: { method: string; params?: unknown[] }): Promise<unknown>;
  isOther?: boolean;
  isClipWallet?: boolean;
}

const steps: Record<string, () => Promise<unknown>> = {
  probe: async () => {
    const eth = (window as unknown as { ethereum?: Legacy }).ethereum;
    if (!eth) return { ethereum: "absent" };
    const chainId = await eth.request({ method: "eth_chainId" }).catch((e: { code?: number }) => ({ code: e.code }));
    return { ethereum: eth.isOther ? "other-wallet" : eth.isClipWallet ? "clip" : "unknown", chainId };
  },
  announcements: async () => {
    const names: string[] = [];
    window.addEventListener("eip6963:announceProvider", (e) => names.push((e as CustomEvent).detail.info.rdns));
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    await new Promise((r) => setTimeout(r, 200));
    return { rdns: [...new Set(names)].sort() };
  },
};

(window as unknown as { __compat: unknown }).__compat = { run: (s: string) => steps[s]!() };
