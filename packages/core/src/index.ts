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

/** Network families. Phase 1: evm, hedera, solana, bitcoin. Phase 2 adds the rest. */
export type Family =
  | "evm"
  | "hedera"
  | "solana"
  | "bitcoin"
  | "sui"
  | "aptos"
  | "cardano"
  | "substrate"
  | "starknet"
  | "ton"
  | "near"
  | "stellar"
  | "tezos"
  | "algorand";

export const FAMILIES: readonly Family[] = [
  "evm", "hedera", "solana", "bitcoin",
  "sui", "aptos", "cardano", "substrate", "starknet", "ton", "near", "stellar", "tezos", "algorand",
];

/**
 * secp256k1 / ed25519: BIP-32 and SLIP-10. bip32-ed25519: Cardano (CIP-1852, Icarus master key).
 * sr25519: Polkadot/Substrate (Schnorrkel, substrate derivation). stark: Starknet (EIP-2645 grinding).
 */
export type Curve = "secp256k1" | "ed25519" | "bip32-ed25519" | "sr25519" | "stark";

export type SignatureScheme =
  | "ecdsa-secp256k1" // EVM, Hedera ECDSA, Bitcoin legacy/segwit, Cosmos-style
  | "schnorr-secp256k1" // Bitcoin Taproot (BIP-340)
  | "ed25519" // Solana, Sui, Aptos, NEAR, Stellar, TON, Tezos tz1, Algorand, Hedera Ed25519; Cardano (signed with a BIP32-Ed25519 extended key, verifies as plain Ed25519)
  | "sr25519" // Polkadot / Substrate
  | "stark-ecdsa"; // Starknet

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
  standard:
    | "erc721"
    | "erc1155"
    | "hts-nft"
    | "metaplex"
    | "ordinal"
    | "sui-object"
    | "aptos-digital-asset"
    /** Cardano: CIP-25 (label 721 mint metadata) and CIP-68 (reference-token datum). */
    | "cip25"
    | "cip68"
    /** Substrate Asset Hub: the `nfts` and legacy `uniques` pallets. */
    | "substrate-nfts"
    | "substrate-uniques"
    /** NEAR NEP-171, Tezos FA2, Algorand ARC-3 / ARC-19 / ARC-69 ASAs. */
    | "nep171"
    | "fa2"
    | "arc3"
    | "arc19"
    | "arc69"
    /** TON NFT items (TEP-62 / TEP-64 metadata). */
    | "tep62";
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
  /**
   * Bitcoin only (Phase 2, additive): hex public key (x-only 32 bytes, or compressed 33 bytes) of the
   * account's BIP-86 key m/86'/<coin>'/0'/0/<index>, the key the vault signs `schnorr-secp256k1` payloads
   * with. `publicKey` stays the BIP-84 (P2WPKH) key. The vault's `deriveAccount` fills it for Bitcoin
   * accounts; a background holding an Account from elsewhere fills it from the `publicKey` of
   * `vault.deriveAccount("bitcoin", i, { bitcoinAddressType: "p2tr" })`. When absent (e.g. hardware
   * accounts), chains-bitcoin treats no taproot (bc1p…) script as the account's and refuses taproot
   * receive and signing in plain words.
   */
  taprootPublicKey?: string;
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
  options?: {
    /**
     * Bitcoin `schnorr-secp256k1` only: the BIP-341 MERKLE ROOT of the output's script tree, or an EMPTY
     * array for a key-path-only output (BIP-86). It is NOT the TapTweak scalar: the vault computes
     * t = H_TapTweak(P_x ‖ merkleRoot) from its own BIP-86 key P and signs with the tweaked key, so the
     * signature verifies against the output key Q = P + t·G. Omit it to sign with the untweaked key.
     */
    taprootTweak?: Uint8Array;
  };
  /**
   * Phase 2 (additive): sign with a key BELOW the account's node instead of the account key itself, as
   * "<chain>/<index>" relative to that node. Bitcoin: "1/<n>" = change address n of the BIP-84/86 account
   * node (m/84'/c'/0'/1/n). Cardano: "0/<n>" payment, "1/<n>" internal, "2/0" stake key under
   * m/1852'/1815'/<i>'. Other families reject it. Covered by the approval hash.
   */
  derivationSubPath?: string;
  /** Binds the signature to the request the user approved. */
  approvalId: string;
  /**
   * Optional (Phase 2, hardware wallets): the full thing `bytes` was computed from, so a hardware
   * wallet can show it on its own screen and sign it there. The vault ignores it. A hardware signer
   * must still return a signature that verifies over `bytes`; `raw` never widens what was approved.
   */
  raw?: RawSignable;
}

/**
 * Formats a chain module can attach as `SignablePayload.raw` (see docs/phase2/integration/hardware.md).
 *  - evm-tx: unsigned serialized transaction (EIP-2718 typed or legacy RLP); bytes = keccak256(raw).
 *  - evm-personal: the message bytes of personal_sign; bytes = EIP-191 hash.
 *  - eip712: UTF-8 JSON of the full typed data (domain, types, primaryType, message); bytes = EIP-712 hash.
 *  - solana-tx: the transaction message bytes (same as `bytes` for Solana).
 *  - solana-message: off-chain message bytes as the dapp gave them (same as `bytes`).
 *  - psbt: the whole PSBT (v0); `inputIndex` says which input this payload's sighash belongs to.
 *  - bitcoin-message: the BIP-137 message bytes; bytes = its double-SHA256 digest.
 *  - hedera-body: the TransactionBody protobuf bytes; bytes = keccak256(raw) for ECDSA, raw itself for Ed25519.
 */
export type RawFormat =
  | "evm-tx"
  | "evm-personal"
  | "eip712"
  | "solana-tx"
  | "solana-message"
  | "psbt"
  | "bitcoin-message"
  | "hedera-body";

export interface RawSignable {
  format: RawFormat;
  bytes: Uint8Array;
  /** psbt only: the input this payload signs. */
  inputIndex?: number;
  /** evm-tx only: chain id, for devices that need it next to the RLP. */
  chainId?: number;
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
    | "simulation-failed"
    | "inscribed-utxo"
    | "high-fee"
    // Phase 2 (near-stellar-tezos-algorand)
    /** Hands control of the account to another key (Algorand rekey, NEAR full-access AddKey, Stellar setOptions signer/master weight). */
    | "account-takeover"
    /** Closes the account and sends everything left to someone (Algorand close-to, NEAR DeleteAccount, Stellar accountMerge). */
    | "account-closure"
    /** The recipient (an exchange, usually) needs a memo, or the funds may be lost (Stellar SEP-29). */
    | "memo-required"
    // Phase 2.5 (security)
    /** The site is on a phishing list (MetaMask, ScamSniffer, Phantom, PolkadotJS) or a scanning provider flagged it. */
    | "phishing-site"
    /** The recipient looks like an address you used before but isn't (look-alike / zero-value transfer poisoning). */
    | "address-poisoning"
    /** A scanning provider or a scam address list says this transaction would hurt you. */
    | "malicious-transaction"
    // Phase 2.5 (social)
    /** Writes something anyone can read, forever (publishing addresses on a Clip handle links them together). */
    | "public-record"
    // Internal audit 2026-10
    /** A contract call or signed order the wallet can name but not fully read: its effects may not all be shown. */
    | "unknown-call";
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

/** Phase 2 (additive): a fresh address under an account, derived by the vault (e.g. a Bitcoin change address). */
export interface ChildAddress {
  address: string;
  /** Hex, as Account.publicKey. */
  publicKey: string;
  /** Full path, e.g. "m/84'/1'/0'/1/3". */
  derivationPath: string;
  /** What a SignablePayload sets as `derivationSubPath` to sign with this key, e.g. "1/3". */
  derivationSubPath: string;
}

export interface ChainContext {
  network: Network;
  account: Account;
  fetch: typeof fetch;
  /**
   * Phase 2 (additive, optional): the background asks the vault for an unused change address of
   * `account` (Bitcoin). Modules fall back to the account's own address when it is absent.
   */
  freshChangeAddress?: () => Promise<ChildAddress>;
  /** Phase 2 (additive, optional): change addresses already handed out for `account`, so the module can find and spend their coins. */
  changeAddresses?: ChildAddress[];
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

/**
 * `DappRequest.origin` of every request the wallet builds itself (sends, staking, swaps, trades). Chain
 * modules and the background compare against this, so a wallet-built request is never treated as a site's.
 * Dapp origins are URLs (`https://…`), so this can't collide with one.
 */
export const WALLET_ORIGIN = "clip-wallet";

/**
 * Internal audit 2026-10 (WC-01): a WalletConnect app's self-declared URL that Verify didn't confirm is never used as
 * a web origin. It becomes `https://<claimed host>.unverified.invalid` (RFC 2606 `.invalid` can't be a real site), so
 * it can't borrow a real site's registry entry, permissions, per-site account or sign-in domain, and can't pass for
 * the wallet. Screens show it as "<claimed host> (unverified)".
 */
export const UNVERIFIED_ORIGIN_SUFFIX = ".unverified.invalid";

/** The pseudo-origin for an unconfirmed claim (`claimedUrl` may be anything a peer sent). */
export function unverifiedOrigin(claimedUrl: string | undefined): string {
  let host = "unknown";
  try {
    const u = new URL(claimedUrl ?? "");
    if ((u.protocol === "https:" || u.protocol === "http:") && u.hostname) host = u.hostname.replace(/\.unverified\.invalid$/, "");
  } catch {
    /* not a URL: "unknown" */
  }
  return `https://${host}${UNVERIFIED_ORIGIN_SUFFIX}`;
}

/** "app.example (unverified)" for a pseudo-origin from unverifiedOrigin(); undefined for anything else. */
export function unverifiedLabel(hostname: string): string | undefined {
  return hostname.endsWith(UNVERIFIED_ORIGIN_SUFFIX) ? `${hostname.slice(0, -UNVERIFIED_ORIGIN_SUFFIX.length)} (unverified)` : undefined;
}

/** True for wallet-built requests. Also accepts the shell's older `"wallet"` spelling. */
export function isWalletOrigin(origin: string | undefined): boolean {
  return origin === WALLET_ORIGIN || origin === "wallet";
}

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
