import type { AssetRef, ChainContext, DappRequest, DecodedRequest, Network, TokenBalance } from "@clip-wallet/core";

/**
 * What the feature services need from the wallet background. The extension's WalletService implements it
 * (see docs/phase2/integration/features.md). Nothing here exposes key material: requests are queued on
 * the normal approval path and the vault signs there.
 */
export interface FeatureHost {
  /** Networks this build has switched on. */
  networks(): Network[];
  /** Assets each network can carry (even at zero balance). */
  assets(): AssetRef[];
  /** Account + network + fetch for one network (rpc overrides applied). */
  ctx(networkId: string): Promise<ChainContext>;
  /** Current balances across every network (cached by the host). */
  balances(): Promise<TokenBalance[]>;
  /**
   * Put a wallet-built request on the approval path. `result` settles when the user approves (with the chain
   * module's finalize() result) or declines.
   */
  enqueue(request: DappRequest, meta: { appName: string; recipient?: string }): Promise<{ id: string; result: Promise<unknown> }>;
  /** The chain module's decode, for previews (Secure Trade review). */
  decode(request: DappRequest): Promise<DecodedRequest>;
  kv: {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T): Promise<void>;
  };
  /** USD price per whole unit, if known. */
  usd(assetKey: string): number | undefined;
  fetch: typeof fetch;
  now?(): number;
}

/**
 * Partner keys and switches. Read from clip.config / build-time env by the extension; never committed.
 * Every provider whose key is missing is shown as unavailable in plain words.
 */
export interface FeaturesConfig {
  /** Testnet build (default true). Mainnet-only providers say so plainly. */
  testnet: boolean;
  swap?: {
    /** 0x Swap API v2 key (dashboard.0x.org). Absent → 0x swaps are off. */
    zeroExApiKey?: string;
    /** Optional Jupiter portal key (x-api-key). Keyless works at a lower rate. */
    jupiterApiKey?: string;
    /** Default slippage in basis points (default 50 = 0.5%). */
    defaultSlippageBps?: number;
  };
  onramp?: {
    /**
     * MoonPay needs a publishable key AND a URL-signing endpoint you run (signing uses the secret key, which
     * must never ship in a wallet). The endpoint receives `{ url }` and answers `{ signature }`.
     */
    moonpay?: { apiKey: string; signerUrl: string };
    /** Banxa referral checkout: your partner subdomain ("<partner>.banxa.com"). */
    banxa?: { partner: string };
    /** C14 widget: your client id and the C14 asset ids you want to offer (asset key → C14 targetAssetId). */
    c14?: { clientId: string; assetIds: Record<string, string> };
  };
  /** Base for Secure Trade share links (default "https://clipwallet.example/trade"). */
  tradeLinkBase?: string;
  /** Optional curated Solana validator vote accounts per network id; otherwise the wallet picks by commission and uptime. */
  solanaValidators?: Record<string, string[]>;
}

export const DEFAULT_FEATURES_CONFIG: FeaturesConfig = { testnet: true };
