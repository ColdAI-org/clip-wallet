/**
 * Session proposal fixtures, shaped like real WalletConnect v2 `session_proposal` params.
 * No network: these are plain objects.
 */

/** AppKit-style EVM dapp: everything optional (the WC 2.x recommendation). */
export const evmOptionalOnly = {
  requiredNamespaces: {},
  optionalNamespaces: {
    eip155: {
      chains: ["eip155:1", "eip155:11155111", "eip155:84532"],
      methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4", "eth_sign", "wallet_switchEthereumChain", "wallet_getCapabilities"],
      events: ["chainChanged", "accountsChanged", "message"],
    },
  },
};

/** Legacy dapp that *requires* mainnet. */
export const evmRequiresMainnet = {
  requiredNamespaces: {
    eip155: { chains: ["eip155:1"], methods: ["eth_sendTransaction", "personal_sign"], events: ["chainChanged"] },
  },
  optionalNamespaces: {},
};

/** Legacy dapp requiring a supported chain but listing eth_sign as required. */
export const evmRequiresEthSign = {
  requiredNamespaces: {
    eip155: { chains: ["eip155:11155111"], methods: ["eth_sendTransaction", "eth_sign"], events: ["accountsChanged"] },
  },
  optionalNamespaces: {},
};

/** CAIP-25 chain-keyed namespace ("eip155:84532" as the key, no chains array). */
export const chainKeyed = {
  requiredNamespaces: {},
  optionalNamespaces: {
    "eip155:84532": { methods: ["personal_sign"], events: ["accountsChanged"] },
  },
};

/** Hedera dapp built with @hashgraph/hedera-wallet-connect (DAppConnector). */
export const hederaDapp = {
  requiredNamespaces: {},
  optionalNamespaces: {
    hedera: {
      chains: ["hedera:mainnet", "hedera:testnet"],
      methods: [
        "hedera_getNodeAddresses",
        "hedera_executeTransaction",
        "hedera_signMessage",
        "hedera_signAndExecuteQuery",
        "hedera_signAndExecuteTransaction",
        "hedera_signTransaction",
      ],
      events: ["chainChanged", "accountsChanged"],
    },
    eip155: {
      chains: ["eip155:296"],
      methods: ["eth_sendTransaction", "personal_sign"],
      events: ["chainChanged", "accountsChanged"],
    },
  },
};

/** Multichain AppKit dapp: Solana + Bitcoin + Cosmos. */
export const multichain = {
  requiredNamespaces: {},
  optionalNamespaces: {
    solana: {
      chains: ["solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"],
      methods: ["solana_signMessage", "solana_signTransaction", "solana_signAndSendTransaction", "solana_signAllTransactions"],
      events: [],
    },
    bip122: {
      chains: ["bip122:000000000933ea01ad0ee984209779ba"],
      methods: ["signMessage", "signPsbt", "sendTransfer", "getAccountAddresses"],
      events: ["bip122_addressesChanged"],
    },
    cosmos: { chains: ["cosmos:cosmoshub-4"], methods: ["cosmos_signDirect"], events: [] },
  },
};

/** Requires an unknown namespace. */
export const requiresCosmos = {
  requiredNamespaces: { cosmos: { chains: ["cosmos:cosmoshub-4"], methods: ["cosmos_signDirect"], events: [] } },
  optionalNamespaces: {},
};
