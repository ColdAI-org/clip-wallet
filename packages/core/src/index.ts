/**
 * @clip-wallet/core — the shared contract between packages.
 *
 * Rules every package follows (enforced by tools/harness):
 *  - Only @clip-wallet/vault touches seed phrases or private keys.
 *  - Chain modules build and decode; they hand the vault a SignablePayload and get back signatures.
 *  - Every dapp request is decoded into a DecodedRequest before the user approves it.
 *  - Networks are invisible in the default UI: anything user-facing speaks in assets and apps;
 *    `networkId` is carried for the "network chip" and Advanced mode only.
 */

/* ------------------------------------------------------------------ networks */

/** Network families shipped in Phase 1. Later phases extend this union. */
export type Family = "evm" | "hedera" | "solana" | "bitcoin";

export type Curve = "secp256k1" | "ed25519";

export type SignatureScheme =
  | "ecdsa-secp256k1" // EVM, Hedera ECDSA, Bitcoin legacy/segwit
  | "schnorr-secp256k1" // Bitcoin Taproot (BIP-340)
  | "ed25519"; // Solana, Hedera Ed25519

/** CAIP-2 chain id, e.g. "eip155:8453", "hedera:testnet", "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", "bip122:000000000019d6689c085ae165831e93". */
export type NetworkId = string;

export interface Network {
  id: NetworkId;
  family: Family;
  /** Human name, shown only in Advanced mode, the network chip and where getting it wrong loses money. */
  name: string;
  nativeAsset: AssetRef;
  testnet: boolean;
  rpcUrls: string[];
  explorerUrl: string;
  /** Hedera mirror node, Blockscout API, etc. */
  indexerUrl?: string;
  /** EVM only. */
  chainId?: number;
}

/* ------------------------------------------------------------------ assets */

export interface AssetRef {
  /** Canonical key used to merge balances across networks ("usdc", "eth", "hbar"). Only the SAME issuer's native token shares a key; bridged copies get their own key. */
  key: string;
  symbol: string;
  name: string;
  decimals: number;
  networkId: NetworkId;
  /** Contract / token id / mint. Absent for the native coin. */
  address?: string;
  logoUrl?: string;
  /** Wrapped or bridged copy of an asset native elsewhere. Never merged with the native asset. */
  bridged?: boolean;
  spam?: boolean;
}

export interface TokenBalance {
  asset: AssetRef;
  /** Base units, decimal string. */
  amount: string;
  /** Value in the user's display currency, if a price is known. */
  fiatValue?: number;
}

export interface Nft {
  networkId: NetworkId;
  standard: "erc721" | "erc1155" | "hts-nft" | "metaplex" | "ordinal";
  collection: { address: string; name: string };
  tokenId: string;
  name?: string;
  /** Untrusted. Render only through the sandboxed media proxy. */
  mediaUrl?: string;
  attributes?: { trait: string; value: string }[];
  spam?: boolean;
}

/* ------------------------------------------------------------------ accounts */

export interface Account {
  /** Stable id: `${family}:${index}`. */
  id: string;
  family: Family;
  index: number;
  curve: Curve;
  derivationPath: string;
  /** Hex, compressed for secp256k1. */
  publicKey: string;
  /** Primary address (EVM checksum, base58, bech32...). For Hedera this is the EVM alias until an account id exists. */
  address: string;
  /** Hedera only: 0.0.x once the alias has been auto-created. */
  hederaAccountId?: string;
  label?: string;
}

/* ------------------------------------------------------------------ signing */

/** What a chain module asks the vault to sign. The vault never sees more than this. */
export interface SignablePayload {
  accountId: string;
  scheme: SignatureScheme;
  /**
   * Bytes to sign. For ecdsa-secp256k1 this is a 32-byte digest the chain module computed;
   * for ed25519 and schnorr it is the message as the network defines it.
   */
  bytes: Uint8Array;
  /** Bitcoin taproot tweak etc. */
  options?: { taprootTweak?: Uint8Array };
  /** Binds the signature to the request the user approved. */
  approvalId: string;
}

export interface Signature {
  scheme: SignatureScheme;
  /** ecdsa: 64-byte r||s + recovery in `recovery`; ed25519/schnorr: 64 bytes. */
  bytes: Uint8Array;
  recovery?: number;
  publicKey: string;
}

/** The only interface to key material. Implemented by @clip-wallet/vault. */
export interface Vault {
  status(): Promise<"empty" | "locked" | "unlocked">;
  /** Creates a new phrase; it is shown once via revealPhrase during onboarding. */
  create(password: string): Promise<void>;
  importPhrase(phrase: string, password: string): Promise<void>;
  /** Onboarding/backup screens only (harness-allowlisted). */
  revealPhrase(password: string): Promise<string>;
  unlock(password: string): Promise<void>;
  lock(): Promise<void>;
  deriveAccount(family: Family, index: number): Promise<Account>;
  /** Fails unless the account's curve matches the scheme and the approval is live. */
  sign(payload: SignablePayload): Promise<Signature>;
}

/* ------------------------------------------------------------------ dapp requests */

/** A request from a dapp, arriving through 1Mask (injected) or WalletConnect. */
export interface DappRequest {
  id: string;
  origin: string;
  via: "injected" | "walletconnect";
  family: Family;
  networkId: NetworkId;
  /** Family-native method: "eth_sendTransaction", "solana:signAndSendTransaction", "hedera_signAndExecuteTransaction", "signPsbt"... */
  method: string;
  params: unknown;
}

export interface BalanceChange {
  asset: AssetRef;
  /** Signed base units, decimal string ("-25000000"). */
  delta: string;
}

export interface Warning {
  level: "info" | "caution" | "danger";
  code:
    | "blind-signing"
    | "unlimited-approval"
    | "approval-for-all"
    | "permit"
    | "durable-nonce"
    | "known-scam"
    | "domain-mismatch"
    | "new-recipient"
    | "network-matters"
    | "simulation-failed";
  message: string;
}

/** What the approval screen shows. Plain language first; the network is a chip. */
export interface DecodedRequest {
  requestId: string;
  /** "Swap 100 USDC for 0.03 ETH on Uniswap", "Pay 25 USDC", "Sign in to magiceden.io". */
  title: string;
  lines: { label: string; value: string }[];
  balanceChanges: BalanceChange[];
  fee?: { asset: AssetRef; amount: string; fiatValue?: number; sponsored?: boolean };
  simulated: boolean;
  /** True when the payload could not be decoded. Blind signing is off by default. */
  blind: boolean;
  warnings: Warning[];
  networkId: NetworkId;
}

export interface ChainContext {
  network: Network;
  account: Account;
  fetch: typeof fetch;
}

/** One sandboxed module per network family. Never imports @clip-wallet/vault. */
export interface ChainModule {
  family: Family;
  curve: Curve;
  derivationPath(index: number): string;
  addressFromPublicKey(publicKey: Uint8Array, network: Network): string;
  isAddress(value: string): boolean;
  /** Which of this family's networks an address could belong to (EVM: many → "network-matters"). */
  networksForAddress(value: string, candidates: Network[]): Network[];

  getBalances(ctx: ChainContext): Promise<TokenBalance[]>;
  getNfts(ctx: ChainContext): Promise<Nft[]>;

  /** Decode + simulate where the network allows it. */
  decode(request: DappRequest, ctx: ChainContext): Promise<DecodedRequest>;
  /** What the vault must sign for this request. */
  prepare(request: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]>;
  /** Assemble, broadcast if the method asks for it, and return the dapp's result. */
  finalize(request: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown>;
  /** Builds a native send as a DappRequest so it goes through the same approval path. */
  buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest>;
}

/* ------------------------------------------------------------------ errors in plain words */

export class ClipError extends Error {
  constructor(
    /** Shown to the user. Plain words and a next step, never a raw RPC error. */
    public readonly userMessage: string,
    public readonly code: string,
    public readonly cause?: unknown,
  ) {
    super(`${code}: ${userMessage}`);
  }
}
