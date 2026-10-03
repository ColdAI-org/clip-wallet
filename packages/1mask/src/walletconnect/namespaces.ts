import type { Family, Network } from "@clip-wallet/core";
import { HEDERA_METHODS } from "../background/methods.js";

/**
 * CAIP-25 session proposal → approved session namespaces. Pure; no network, no WalletKit.
 *
 * Policy:
 *  - Only chains in the wallet's registry, with at least one account, are approved.
 *  - Required chains we cannot serve → reject (UNSUPPORTED_CHAINS); required namespace keys we do
 *    not speak → reject (UNSUPPORTED_NAMESPACE_KEY). Optional ones are dropped and reported.
 *  - Required methods we do not support are still listed (so the session conforms) but refused at
 *    request time; they are reported in `unsupported.methods` for the approval screen.
 *  - Optional methods/events: intersection with what we support.
 */

export type WcNamespaceKey = "eip155" | "solana" | "bip122" | "hedera";

export const WC_NAMESPACE_FAMILY: Record<WcNamespaceKey, Family> = {
  eip155: "evm",
  solana: "solana",
  bip122: "bitcoin",
  hedera: "hedera",
};

/** Methods Clip serves per WalletConnect namespace. */
export const WC_SUPPORTED_METHODS: Record<WcNamespaceKey, readonly string[]> = {
  eip155: [
    "eth_accounts",
    "eth_requestAccounts",
    "eth_chainId",
    "personal_sign",
    "eth_signTypedData_v4",
    "eth_sendTransaction",
    "wallet_switchEthereumChain",
    "wallet_addEthereumChain",
  ],
  // https://docs.reown.com/advanced/multichain/rpc-reference/solana-rpc
  solana: [
    "solana_getAccounts",
    "solana_requestAccounts",
    "solana_signMessage",
    "solana_signTransaction",
    "solana_signAllTransactions",
    "solana_signAndSendTransaction",
  ],
  // https://docs.reown.com/advanced/multichain/rpc-reference/bitcoin-rpc
  bip122: ["getAccountAddresses", "signMessage", "signPsbt", "sendTransfer"],
  // hashgraph/hedera-wallet-connect HederaJsonRpcMethod
  hedera: HEDERA_METHODS,
};

export const WC_SUPPORTED_EVENTS: Record<WcNamespaceKey, readonly string[]> = {
  eip155: ["accountsChanged", "chainChanged"],
  solana: ["accountsChanged", "chainChanged"],
  bip122: ["bip122_addressesChanged"],
  // hashgraph/hedera-wallet-connect HederaSessionEvent
  hedera: ["accountsChanged", "chainChanged"],
};

export interface ProposalNamespace {
  chains?: string[];
  methods: string[];
  events: string[];
}

export interface ProposalLike {
  requiredNamespaces?: Record<string, ProposalNamespace>;
  optionalNamespaces?: Record<string, ProposalNamespace>;
}

export interface SessionNamespace {
  chains: string[];
  accounts: string[];
  methods: string[];
  events: string[];
}

export interface NamespaceMappingInput {
  networks: readonly Network[];
  /**
   * Addresses for a chain (CAIP-2 id). EVM: 0x addresses; Solana: base58; Bitcoin: addresses;
   * Hedera: account ids ("0.0.1234"). Return [] if the wallet has none there yet.
   */
  addressesFor(chainId: string, family: Family): string[];
}

export interface UnsupportedReport {
  namespaces: string[];
  chains: string[];
  methods: string[];
  events: string[];
}

export type NamespaceMapping =
  | { ok: true; namespaces: Record<string, SessionNamespace>; unsupported: UnsupportedReport }
  | {
      ok: false;
      /** WalletConnect SDK error key to reject the proposal with. */
      reason: "UNSUPPORTED_CHAINS" | "UNSUPPORTED_NAMESPACE_KEY" | "UNSUPPORTED_ACCOUNTS";
      message: string;
      unsupported: UnsupportedReport;
    };

const isKnownKey = (k: string): k is WcNamespaceKey => k in WC_NAMESPACE_FAMILY;

/** CAIP-25 lets a namespace key be a full chain id ("eip155:1") with no `chains` array. */
function normalize(ns: Record<string, ProposalNamespace> | undefined): Map<string, ProposalNamespace> {
  const out = new Map<string, ProposalNamespace>();
  for (const [key, value] of Object.entries(ns ?? {})) {
    const i = key.indexOf(":");
    const nsKey = i > 0 ? key.slice(0, i) : key;
    const chains = i > 0 ? [key] : (value.chains ?? []);
    const prev = out.get(nsKey);
    out.set(nsKey, {
      chains: [...new Set([...(prev?.chains ?? []), ...chains])],
      methods: [...new Set([...(prev?.methods ?? []), ...(value.methods ?? [])])],
      events: [...new Set([...(prev?.events ?? []), ...(value.events ?? [])])],
    });
  }
  return out;
}

export function mapProposalNamespaces(proposal: ProposalLike, input: NamespaceMappingInput): NamespaceMapping {
  const required = normalize(proposal.requiredNamespaces);
  const optional = normalize(proposal.optionalNamespaces);
  const unsupported: UnsupportedReport = { namespaces: [], chains: [], methods: [], events: [] };
  const namespaces: Record<string, SessionNamespace> = {};
  const registry = new Set(input.networks.map((n) => n.id));

  const servable = (chain: string, key: WcNamespaceKey): string[] | undefined => {
    if (!registry.has(chain)) return undefined;
    const addrs = input.addressesFor(chain, WC_NAMESPACE_FAMILY[key]);
    return addrs.length > 0 ? addrs : undefined;
  };

  // Required namespaces: all-or-nothing on keys and chains.
  for (const [key, ns] of required) {
    if (!isKnownKey(key)) {
      unsupported.namespaces.push(key);
      return {
        ok: false,
        reason: "UNSUPPORTED_NAMESPACE_KEY",
        message: `Clip Wallet does not support the ${key} namespace this app requires.`,
        unsupported,
      };
    }
    const badChains = (ns.chains ?? []).filter((c) => !c.startsWith(`${key}:`) || !servable(c, key));
    if (badChains.length > 0) {
      unsupported.chains.push(...badChains);
      return {
        ok: false,
        reason: "UNSUPPORTED_CHAINS",
        message: `This app requires networks Clip Wallet does not support: ${badChains.join(", ")}.`,
        unsupported,
      };
    }
  }

  const keys = new Set([...required.keys(), ...optional.keys()]);
  for (const key of keys) {
    if (!isKnownKey(key)) {
      unsupported.namespaces.push(key);
      continue;
    }
    const req = required.get(key);
    const opt = optional.get(key);
    const chains: string[] = [];
    const accounts: string[] = [];
    for (const chain of new Set([...(req?.chains ?? []), ...(opt?.chains ?? [])])) {
      const addrs = chain.startsWith(`${key}:`) ? servable(chain, key) : undefined;
      if (!addrs) {
        unsupported.chains.push(chain);
        continue;
      }
      chains.push(chain);
      for (const a of addrs) accounts.push(`${chain}:${a}`);
    }
    if (chains.length === 0) continue;

    const supportedMethods = WC_SUPPORTED_METHODS[key];
    const supportedEvents = WC_SUPPORTED_EVENTS[key];
    const methods = new Set<string>();
    for (const m of req?.methods ?? []) {
      methods.add(m); // must be present for the session to conform; refused at request time if unsupported
      if (!supportedMethods.includes(m)) unsupported.methods.push(m);
    }
    for (const m of opt?.methods ?? []) {
      if (supportedMethods.includes(m)) methods.add(m);
      else if (!methods.has(m)) unsupported.methods.push(m);
    }
    const events = new Set<string>(req?.events ?? []);
    for (const e of opt?.events ?? []) {
      if (supportedEvents.includes(e)) events.add(e);
      else unsupported.events.push(e);
    }
    namespaces[key] = { chains, accounts, methods: [...methods], events: [...events] };
  }

  if (Object.keys(namespaces).length === 0) {
    return {
      ok: false,
      reason: "UNSUPPORTED_CHAINS",
      message: "This app only asks for networks Clip Wallet does not support.",
      unsupported,
    };
  }
  unsupported.chains = [...new Set(unsupported.chains)];
  unsupported.methods = [...new Set(unsupported.methods)];
  unsupported.events = [...new Set(unsupported.events)];
  return { ok: true, namespaces, unsupported };
}

/** Is `method` one Clip actually serves on this namespace (vs. merely listed for conformance)? */
export function isServedMethod(nsKey: string, method: string): boolean {
  return isKnownKey(nsKey) && WC_SUPPORTED_METHODS[nsKey].includes(method);
}

export function namespaceOf(chainId: string): string {
  const i = chainId.indexOf(":");
  return i > 0 ? chainId.slice(0, i) : chainId;
}
