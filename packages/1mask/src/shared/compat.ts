/**
 * Compatibility mode — opt-in per site, default OFF. NOT IMPLEMENTED in v1.
 *
 * Intended scope (see README "Compatibility mode"): for sites that only look at `window.ethereum`
 * flags or legacy globals, let the user enable, per origin, a shim that
 *   - sets `window.ethereum` even when another wallet is present (`claimWindowEthereum`),
 *   - optionally reports `isMetaMask: true` (`impersonate: "metamask"`),
 *   - exposes legacy `window.solana` / `window.BitcoinProvider` globals.
 * Every flag is per origin and recorded with the permission, never global.
 */
export interface CompatibilityModeConfig {
  /** Must stay false in v1. Installing with `enabled: true` throws. */
  enabled: false;
  /** Origins the user turned compatibility on for. Ignored in v1. */
  origins?: string[];
  impersonate?: "metamask" | "phantom" | "xverse";
  legacyGlobals?: { solana?: boolean; bitcoinProvider?: boolean };
}

export function assertCompatibilityModeOff(cfg?: { enabled: boolean }): void {
  if (cfg?.enabled) {
    throw new Error("1Mask: compatibility mode is not implemented in v1");
  }
}
