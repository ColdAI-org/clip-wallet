// Bitcoin: Clip Wallet registers a Wallet Standard wallet with bitcoin:* features and a sats-connect provider.
import { getWallets } from "@wallet-standard/app";

type SatsResponse = { result?: unknown; error?: { code: number; message: string } };
type SatsProvider = { request(method: string, params?: unknown): Promise<SatsResponse> };

async function call<T>(provider: SatsProvider, method: string, params?: unknown): Promise<T> {
  const r = await provider.request(method, params);
  if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
  return r.result as T;
}

export async function connectBitcoin() {
  const wallet = getWallets()
    .get()
    .find((w) => w.name === "Clip Wallet" && "bitcoin:connect" in w.features);
  if (!wallet) throw new Error("Clip Wallet isn't installed in this browser.");
  const sats = (wallet.features as unknown as Record<string, { provider: SatsProvider }>)["sats-connect:"]!.provider;

  const [account] = await call<{ address: string; addressType: string }[]>(sats, "getAccounts", { purposes: ["payment"] });
  const { signature } = await call<{ signature: string }>(sats, "signMessage", {
    address: account!.address,
    message: "Sign in to example.app",
    protocol: "BIP322",
  });
  return { address: account!.address, signature };
}
