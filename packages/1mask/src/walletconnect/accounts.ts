/**
 * Audit WC-05: the accounts (and chains) a WalletConnect request names must be ones the session approved. A request
 * naming another account is refused with the SDK's UNSUPPORTED_ACCOUNTS (5103), another chain with
 * UNSUPPORTED_CHAINS (5100), before anything is decoded or shown. Pure; no network.
 *
 * Only accounts a request names in plain fields are read here (per each namespace's RPC reference). Signers inside
 * encoded transactions (Solana, NEAR, Stellar, Algorand bytes) are checked by the chain modules against the account
 * the request is routed to.
 */
import { parseChainId } from "../shared/networks.js";
import type { WcNamespaceKey } from "./namespaces.js";

export interface NamedAccounts {
  /** Addresses / account ids the request names, as written (Hedera: CAIP-10 prefix and checksum removed). */
  accounts: string[];
  /** CAIP-2 chains the request names (EVM `chainId` on a transaction, Hedera's CAIP-10 signer). */
  chains: string[];
  /** A named account field that isn't a string (malformed): refuse. */
  malformed: boolean;
}

const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);

/** Hedera: "hedera:testnet:0.0.1234-abcde" → { chain: "hedera:testnet", account: "0.0.1234" }; plain ids too. */
export function parseHederaAccount(value: string): { chain?: string; account: string } {
  const m = /^(hedera:[a-z0-9-]+):(.+)$/.exec(value);
  const rest = m ? m[2]! : value;
  return { ...(m ? { chain: m[1]! } : {}), account: rest.replace(/-[a-z]{5}$/, "") };
}

export function namedAccounts(ns: WcNamespaceKey, method: string, params: unknown): NamedAccounts {
  const out: NamedAccounts = { accounts: [], chains: [], malformed: false };
  const take = (v: unknown) => {
    if (v === undefined || v === null) return;
    if (typeof v !== "string" || !v) out.malformed = true;
    else out.accounts.push(v);
  };
  const list = Array.isArray(params) ? params : [];
  const p = obj(params);
  switch (ns) {
    case "eip155":
      switch (method) {
        case "personal_sign":
          take(list[1]);
          break;
        case "eth_signTypedData":
        case "eth_signTypedData_v3":
        case "eth_signTypedData_v4":
          take(list[0]);
          break;
        case "eth_sendTransaction":
        case "eth_signTransaction": {
          const tx = obj(list[0]);
          take(tx?.from);
          if (tx?.chainId !== undefined) {
            const n = parseChainId(tx.chainId);
            if (n) out.chains.push(`eip155:${n}`);
            else out.malformed = true;
          }
          break;
        }
      }
      break;
    case "solana":
      take(p?.pubkey);
      break;
    case "bip122":
      take(p?.account);
      if (method === "signMessage") take(p?.address);
      break;
    case "hedera": {
      const signer = p?.signerAccountId;
      if (signer === undefined) break;
      if (typeof signer !== "string") {
        out.malformed = true;
        break;
      }
      const { chain, account } = parseHederaAccount(signer);
      out.accounts.push(account);
      if (chain) out.chains.push(chain);
      break;
    }
    case "near":
      if (method === "near_signIn" || method === "near_signOut") {
        const accounts = p?.accounts;
        if (accounts !== undefined && !Array.isArray(accounts)) out.malformed = true;
        for (const a of Array.isArray(accounts) ? accounts : []) take(obj(a)?.accountId ?? (a as unknown));
      }
      if (method === "near_signMessage") take(p?.accountId);
      break;
    case "stellar":
      take(p?.address);
      break;
    case "tezos":
      take(p?.account);
      break;
    case "algorand":
      // algo_signTxn: [[{ txn, signers? }]] — ARC-1 `signers` name the addresses asked to sign.
      for (const group of list) {
        for (const t of Array.isArray(group) ? group : []) {
          const signers = obj(t)?.signers;
          if (signers === undefined) continue;
          if (!Array.isArray(signers)) out.malformed = true;
          else signers.forEach(take);
        }
      }
      break;
  }
  return out;
}

/** True when `named` is one of the session's accounts on the chain (EVM addresses compare without case). */
export function sessionHasAccount(ns: WcNamespaceKey, sessionAccounts: string[], named: string): boolean {
  if (ns === "eip155") return sessionAccounts.some((a) => a.toLowerCase() === named.toLowerCase());
  if (ns === "hedera") return sessionAccounts.some((a) => parseHederaAccount(a).account === named);
  return sessionAccounts.includes(named);
}
