// CIP-30: Clip Wallet is window.cardano.clipwallet (kit-built wallets use their own key). Mesh, Lucid and
// cardano-connect-with-wallet read the same object.
interface Cip30Api {
  getNetworkId(): Promise<number>;
  getUsedAddresses(): Promise<string[]>;
  getChangeAddress(): Promise<string>;
  getUtxos(): Promise<string[] | undefined>;
  signTx(txCborHex: string, partialSign?: boolean): Promise<string>;
  signData(addressHex: string, payloadHex: string): Promise<{ signature: string; key: string }>;
  submitTx(txCborHex: string): Promise<string>;
}
interface Cip30Wallet {
  name: string;
  icon: string;
  apiVersion: string;
  enable(): Promise<Cip30Api>;
}

export async function connectCardano() {
  const wallets = (window as unknown as { cardano?: Record<string, Cip30Wallet> }).cardano ?? {};
  const clip = wallets.clipwallet;
  if (!clip) throw new Error("Clip Wallet isn't installed in this browser.");
  const api = await clip.enable(); // asks the person once per site
  const networkId = await api.getNetworkId(); // 0 = test networks (preprod, preview)
  const [address] = await api.getUsedAddresses(); // hex-encoded CIP-19 base address
  const hex = (s: string) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");
  const signed = await api.signData(address ?? (await api.getChangeAddress()), hex("Sign in to example.app")); // CIP-8
  return { networkId, address, signed };
}
