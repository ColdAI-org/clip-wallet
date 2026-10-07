// TRON: Clip announces a TIP-1193 provider with TIP-6963 under its own name (it never sets window.tronLink or
// window.tronWeb). Find it by its rdns, connect, then sign with the TronWeb subset it carries.
interface TronProvider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  tronWeb: {
    defaultAddress: { base58: string | false };
    trx: { sign(transaction: unknown): Promise<unknown>; signMessageV2(message: string): Promise<string> };
  };
  on(event: "accountsChanged" | "chainChanged" | "disconnect", listener: (...args: unknown[]) => void): unknown;
}
interface AnnounceDetail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: TronProvider;
}

export function findTronWallet(rdns = "org.coldai.clipwallet"): Promise<TronProvider> {
  return new Promise((resolve, reject) => {
    const onAnnounce = (e: Event) => {
      const detail = (e as CustomEvent<AnnounceDetail>).detail;
      if (detail?.info.rdns !== rdns) return;
      window.removeEventListener("TIP6963:announceProvider", onAnnounce);
      resolve(detail.provider);
    };
    window.addEventListener("TIP6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("TIP6963:requestProvider"));
    setTimeout(() => reject(new Error("No TIP-6963 wallet with that rdns.")), 1000);
  });
}

export async function connectTron() {
  const tron = await findTronWallet();
  const [address] = (await tron.request({ method: "eth_requestAccounts" })) as string[]; // TIP-1102
  const chainId = await tron.request({ method: "eth_chainId" }); // "0xcd8690dc" on Nile
  const signature = await tron.tronWeb.trx.signMessageV2("Sign in to example.app"); // TronWeb Trx.verifyMessageV2
  // Transactions: build them with your own TronWeb, then tron.tronWeb.trx.sign(transaction).
  return { address, chainId, signature };
}
