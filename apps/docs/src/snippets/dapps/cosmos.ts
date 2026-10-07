// Cosmos SDK chains: Clip's Keplr-compatible provider is window.clipwallet.cosmos (never window.keplr). A dapp written
// for Keplr swaps `window.keplr` for it; the offline signer goes to cosmjs as usual.
interface CosmosKey {
  name: string;
  algo: string;
  pubKey: Uint8Array;
  bech32Address: string;
}
interface StdSignature {
  pub_key: { type: string; value: string };
  signature: string;
}
interface CosmosProvider {
  enable(chainIds: string | string[]): Promise<void>;
  getKey(chainId: string): Promise<CosmosKey>;
  signArbitrary(chainId: string, signer: string, data: string | Uint8Array): Promise<StdSignature>;
  getOfflineSigner(chainId: string): unknown; // an OfflineDirectSigner for SigningStargateClient.connectWithSigner
  on(event: "keystorechange", listener: () => void): () => void;
}

export async function connectCosmos(chainId = "osmo-test-5") {
  const cosmos = (window as unknown as { clipwallet?: { cosmos?: CosmosProvider } }).clipwallet?.cosmos;
  if (!cosmos) throw new Error("Clip Wallet isn't installed in this browser.");
  await cosmos.enable(chainId); // the connect approval
  const key = await cosmos.getKey(chainId); // key.bech32Address: osmo1…
  // ADR-36 sign-in message, verifiable with @cosmjs/crypto or Keplr's verifyADR36Amino
  const signature = await cosmos.signArbitrary(chainId, key.bech32Address, "Sign in to example.app");
  const signer = cosmos.getOfflineSigner(chainId);
  return { address: key.bech32Address, signature, signer };
}
