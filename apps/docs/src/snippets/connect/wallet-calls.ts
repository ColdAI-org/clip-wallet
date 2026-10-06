// EIP-5792 by hand, on any EIP-1193 provider (no Clip Connect). Clip Wallet answers these only when asked.
type Provider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const shop = "000000000000000000000000000000000000dead";

export async function payWithAuxiliaryFunds(provider: Provider, from: `0x${string}`) {
  const chainId = "0x14a34"; // 84532, Base Sepolia
  const caps = (await provider.request({ method: "wallet_getCapabilities", params: [from, [chainId]] })) as Record<string, {
    atomic?: { status: string };
    auxiliaryFunds?: { supported: boolean; assets?: string[] };
  }>;
  const aux = caps[chainId]?.auxiliaryFunds?.supported === true;

  const amount = (25n * 10n ** 6n).toString(16).padStart(64, "0"); // 25 USDC
  const { id } = (await provider.request({
    method: "wallet_sendCalls",
    params: [
      {
        version: "2.0.0",
        chainId,
        from,
        atomicRequired: false, // Clip accounts are EOAs: true is refused with 5760
        calls: [{ to: USDC_BASE_SEPOLIA, value: "0x0", data: `0xa9059cbb${shop.padStart(64, "0")}${amount}` }],
        ...(aux
          ? { capabilities: { auxiliaryFunds: { optional: true, requiredAssets: [{ address: USDC_BASE_SEPOLIA, amount: "0x17d7840", standard: "erc20" }] } } }
          : {}),
      },
    ],
  })) as { id: string };

  // 100 pending, 200 confirmed, 400/500/600 failed or reverted (EIP-5792 status codes).
  const status = (await provider.request({ method: "wallet_getCallsStatus", params: [id] })) as { status: number };
  return { id, status: status.status };
}
