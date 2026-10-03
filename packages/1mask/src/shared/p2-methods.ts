import type { NetworkId } from "@clip-wallet/core";
import { METHOD_WS_STATE } from "./protocol.js";

/**
 * Wire methods for the Phase 2 ed25519 families' injected providers (NEAR, Stellar, Tezos, Algorand).
 * The signing method names are the chain modules' own DappRequest methods (chains-near/-stellar/-tezos/
 * -algorand `*_METHODS`), so the background hands them to the module unchanged.
 */

export const NEAR_INJECTED = {
  accounts: METHOD_WS_STATE,
  connect: "near:connect",
  disconnect: "near:disconnect",
  signAndSendTransaction: "near_signAndSendTransaction",
  signAndSendTransactions: "near_signAndSendTransactions",
  signMessage: "near_signMessage",
} as const;

export const STELLAR_INJECTED = {
  accounts: METHOD_WS_STATE,
  connect: "stellar:connect",
  disconnect: "stellar:disconnect",
  getNetwork: "stellar:getNetwork",
  signXDR: "stellar_signXDR",
  signAndSubmitXDR: "stellar_signAndSubmitXDR",
  signAuthEntry: "stellar_signAuthEntry",
  signMessage: "stellar_signMessage",
} as const;

export const TEZOS_INJECTED = {
  accounts: METHOD_WS_STATE,
  connect: "tezos:connect",
  disconnect: "tezos:disconnect",
  getAccounts: "tezos_getAccounts",
  send: "tezos_send",
  sign: "tezos_sign",
  /** Beacon postMessage relay (see inpage/tezos.ts): one encrypted Beacon message in, replies out. */
  beacon: "tezos:beacon",
  /** Waits for the answer to a Beacon request that needed the user's approval. */
  beaconResult: "tezos:beaconResult",
} as const;

export const ALGORAND_INJECTED = {
  accounts: METHOD_WS_STATE,
  connect: "algorand:connect",
  disconnect: "algorand:disconnect",
  signTxn: "algo_signTxn",
  signAndPostTxn: "algo_signAndPostTxn",
} as const;

/** Connect methods: the extension's OneMaskConnector treats these as "connect approvals". */
export const P2_CONNECT_METHODS = [NEAR_INJECTED.connect, STELLAR_INJECTED.connect, TEZOS_INJECTED.connect, ALGORAND_INJECTED.connect] as const;

/* ------------------------------------------------------------------ network hints the page can compute */

/**
 * Stellar network passphrases (developers.stellar.org "Networks"; also @creit.tech/stellar-wallets-kit
 * `Networks`). CAIP-2 ids per ChainAgnostic namespaces/stellar.
 */
export const STELLAR_PASSPHRASES: Record<string, NetworkId> = {
  "Public Global Stellar Network ; September 2015": "stellar:pubnet",
  "Test SDF Network ; September 2015": "stellar:testnet",
  "Test SDF Future Network ; October 2022": "stellar:futurenet",
};

export function stellarPassphraseOf(networkId: NetworkId): string | undefined {
  return Object.entries(STELLAR_PASSPHRASES).find(([, id]) => id === networkId)?.[0];
}

/** SEP-43 `getNetwork().network` names (as Freighter reports them). */
export function stellarNetworkName(networkId: NetworkId): string {
  return networkId === "stellar:pubnet" ? "PUBLIC" : networkId === "stellar:futurenet" ? "FUTURENET" : "TESTNET";
}

/**
 * ChainAgnostic namespaces/algorand: reference = first 32 characters of the base64url-encoded genesis
 * hash (algod `genesis-hash` is standard base64).
 */
export function algorandChainFromGenesisHash(genesisHash: string): NetworkId {
  return `algorand:${genesisHash.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 32)}`;
}

/** Algorand genesis ids/hashes (ARC-6 table; algod /genesis). */
export const ALGORAND_GENESIS: Record<string, { genesisID: string; genesisHash: string }> = {
  [algorandChainFromGenesisHash("wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=")]: { genesisID: "mainnet-v1.0", genesisHash: "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=" },
  [algorandChainFromGenesisHash("SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=")]: { genesisID: "testnet-v1.0", genesisHash: "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=" },
  [algorandChainFromGenesisHash("mFgazF+2uRS1tMiL9dsj01hJGySEmPN28B/TjjvpVW0=")]: { genesisID: "betanet-v1.0", genesisHash: "mFgazF+2uRS1tMiL9dsj01hJGySEmPN28B/TjjvpVW0=" },
};
