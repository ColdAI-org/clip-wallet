// Stacks: Clip's SIP-030 provider is window.clipwallet.stacks, registered on window.wbip_providers (WBIP-004), which
// is where @stacks/connect 8 finds wallets. Without @stacks/connect, call it directly:
interface Sip030Response<T> {
  jsonrpc: "2.0";
  id: number;
  result: T;
}
interface StacksProvider {
  request<T = unknown>(method: string, params?: unknown): Promise<Sip030Response<T>>;
}

export async function connectStacks() {
  const stacks = (window as unknown as { clipwallet?: { stacks?: StacksProvider } }).clipwallet?.stacks;
  if (!stacks) throw new Error("Clip Wallet isn't installed in this browser.");
  const { result } = await stacks.request<{ addresses: { symbol: string; address: string; publicKey: string }[] }>("stx_getAddresses", { network: "testnet" });
  const address = result.addresses[0]!.address; // ST… on testnet
  const signed = await stacks.request<{ signature: string; publicKey: string }>("stx_signMessage", { message: "Sign in to example.app", network: "testnet" });
  const sent = await stacks.request<{ txid: string }>("stx_transferStx", { recipient: address, amount: "1", network: "testnet" });
  return { address, signature: signed.result.signature, txid: sent.result.txid };
}
