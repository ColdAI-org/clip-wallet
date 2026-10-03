import { KNOWN_APPS } from "@clip-wallet/chains-evm";
import { SAUCERSWAP } from "@clip-wallet/chains-hedera";
import { SAUCERSWAP_V2 } from "@clip-wallet/features";

/**
 * Plain names for spenders and operators. A name here means "we checked this address belongs to that app",
 * so the list is short and curated. Anything else shows as "Unknown app" and gets the `unknown-spender` risk.
 *
 * EVM: chains-evm KNOWN_APPS plus contracts deployed at the same address on every network they're on. Each
 * address below was checked against its verified contract name on eth.blockscout.com (2026-10-03):
 * SwapRouter02, SwapRouter, "Uniswap V3 Positions NFT-V1", Seaport 1.5, the OpenSea Conduit,
 * AggregationRouterV5, 0x AllowanceHolder, GPv2VaultRelayer and LiFiDiamond.
 * We never use an explorer's contract name directly: anyone can name their contract "Uniswap".
 */
export const EVM_SPENDERS: Record<string, string> = {
  ...KNOWN_APPS,
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45": "Uniswap",
  "0xe592427a0aece92de3edee1f18e0157c05861564": "Uniswap",
  "0xc36442b4a4522e871399cd717abdd847ab11fe88": "Uniswap",
  "0x00000000000000adc04c56bf30ac9d3c0aaf14dc": "OpenSea",
  "0x1e0049783f008a0085193e00003d00cd54003c71": "OpenSea",
  "0x1111111254eeb25477b68fb85ed929f73a960582": "1inch",
  "0x0000000000001ff3684f28c67538d4d072c22734": "0x",
  "0xc92e8bdf79f0507f65a392b0ab4667716bfe0110": "CoW Swap",
  "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae": "LI.FI",
};

/** Hedera entity ids → app, from the SaucerSwap contract lists already used by the wallet. */
function hederaSpenders(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of Object.values(SAUCERSWAP_V2)) {
    if (!c) continue;
    out[c.router] = "SaucerSwap";
    out[c.positionManager] = "SaucerSwap";
  }
  for (const c of Object.values(SAUCERSWAP)) {
    out[c.v1Router] = "SaucerSwap";
    out[c.v2Router] = "SaucerSwap";
  }
  return out;
}

let hedera: Record<string, string> | undefined;

/** Plain app name for a spender, or undefined when we don't know it. */
export function spenderName(family: string, address: string, extra: Record<string, string> = {}): string | undefined {
  const k = family === "evm" ? address.toLowerCase() : address;
  if (extra[k]) return extra[k];
  if (family === "evm") return EVM_SPENDERS[k];
  if (family === "hedera") return (hedera ??= hederaSpenders())[k];
  return undefined;
}
