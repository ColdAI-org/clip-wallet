/** Stable id for hiding: network + token address/mint (+ serial for NFTs). No dependencies, so hosts can import it cheaply. */
export function hideKey(networkId: string, addressOrMint: string, serial?: string): string {
  return [networkId, addressOrMint.startsWith("0x") ? addressOrMint.toLowerCase() : addressOrMint, serial].filter(Boolean).join("|");
}
