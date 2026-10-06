// Plain EIP-6963: no library. Every injected wallet announces itself; pick Clip Wallet by its rdns.
interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
}

const wallets = new Map<string, Eip6963Detail>();
window.addEventListener("eip6963:announceProvider", (event) => {
  const { detail } = event as CustomEvent<Eip6963Detail>;
  wallets.set(detail.info.rdns, detail);
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

export async function connectClip(): Promise<string> {
  const clip = wallets.get("org.coldai.clipwallet");
  if (!clip) throw new Error("Clip Wallet isn't installed in this browser.");
  const [address] = (await clip.provider.request({ method: "eth_requestAccounts" })) as string[];
  // Networks the wallet ships with switch without a prompt; others answer 4902.
  await clip.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] }); // Sepolia
  return address!;
}
