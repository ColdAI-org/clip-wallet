import { normalize } from "@clip-wallet/chains-solana";
import { clusterOf } from "@clip-wallet/chains-solana";
import { fetchJson } from "../util.js";
import type { ProviderStatus, ThreatFinding, ThreatIntelProvider, TxCheckInput } from "./types.js";

/**
 * Blockaid transaction and site scanning (optional). OFF unless an API key is configured.
 *
 * Endpoints, auth and fields from Blockaid's official Node client (github.com/blockaid-official/blockaid-client-node,
 * api.md and src/resources, checked 2026-10-03); the hosted docs need a login:
 *  - base https://api.blockaid.io, header `X-API-Key`
 *  - POST /v0/site/scan { url } → { status: "hit" | "miss", is_malicious? }
 *  - POST /v0/evm/transaction/scan { chain, account_address, data: { from, to, data, value }, metadata: { domain } | { non_dapp: true }, options: ["validation"] }
 *  - POST /v0/evm/json-rpc/scan { chain, account_address, data: { method, params }, metadata, options } (signatures)
 *  - POST /v0/solana/message/scan { account_address, transactions: [base64], encoding: "base64", chain, metadata: { url } | { non_dapp: true }, options: ["validation"] }
 *  - verdict: `validation.result_type` ∈ Benign | Warning | Malicious | Error, with `description` / `reason`.
 * `chain` takes a name from TransactionScanSupportedChain or a chain id.
 *
 * PRIVACY: when enabled, Blockaid receives the site, the full transaction and YOUR ADDRESS for every request
 * you review. That's why it's opt-in by configuration and named in Settings → Security.
 */

const CHAIN_NAMES: Record<number, string> = {
  1: "ethereum",
  10: "optimism",
  14: "flare",
  56: "bsc",
  100: "gnosis",
  130: "unichain",
  137: "polygon",
  143: "monad",
  324: "zksync",
  999: "hyperevm",
  1329: "sei",
  1868: "soneium",
  2741: "abstract",
  4326: "megaeth",
  5000: "mantle",
  8217: "kaia",
  8453: "base",
  9745: "plasma",
  42161: "arbitrum",
  43113: "avalanche-fuji",
  43114: "avalanche",
  57073: "ink",
  59144: "linea",
  81457: "blast",
  84532: "base-sepolia",
  534352: "scroll",
  747474: "katana",
  7777777: "zora",
  11155111: "ethereum-sepolia",
};

const SIGN_METHODS = new Set(["eth_signTypedData_v4", "eth_signTypedData_v3", "eth_signTypedData", "personal_sign"]);

interface Validation {
  result_type?: "Benign" | "Warning" | "Malicious" | "Error";
  description?: string;
  reason?: string;
  classification?: string;
}

export class BlockaidProvider implements ThreatIntelProvider {
  readonly id = "blockaid";
  readonly name = "Blockaid scanning";
  readonly privacy = "Sends the site, the transaction and your address to Blockaid for every request you review.";
  readonly sendsUserData = true;
  private lastError?: string;

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly opts?: { apiKey: string; baseUrl?: string },
  ) {}

  get enabled(): boolean {
    return !!this.opts?.apiKey;
  }

  status(): ProviderStatus {
    if (!this.enabled) {
      return { enabled: false, unavailable: { code: "threat/blockaid-off", message: "Off. Add a Blockaid API key to the wallet's configuration to scan every transaction before you sign." } };
    }
    return { enabled: true, unavailable: this.lastError ? { code: "threat/blockaid-error", message: this.lastError } : undefined };
  }

  private async post<T>(path: string, body: unknown): Promise<T | null> {
    if (!this.enabled) return null;
    try {
      const r = await fetchJson<T>(this.fetchImpl, `${(this.opts!.baseUrl ?? "https://api.blockaid.io").replace(/\/+$/, "")}${path}`, "Blockaid", {
        body,
        headers: { "X-API-Key": this.opts!.apiKey },
        timeoutMs: 5000,
      });
      this.lastError = undefined;
      return r;
    } catch {
      this.lastError = "Blockaid didn't answer the last check.";
      return null;
    }
  }

  async checkSite(origin: string): Promise<ThreatFinding[]> {
    if (!/^https?:\/\//.test(origin)) return [];
    const r = await this.post<{ status?: string; is_malicious?: boolean }>("/v0/site/scan", { url: origin });
    if (r?.status === "hit" && r.is_malicious) {
      return [{ level: "danger", code: "phishing-site", source: this.id, message: "Blockaid says this site is malicious. Don't connect or sign anything." }];
    }
    return [];
  }

  async checkTransaction(input: TxCheckInput): Promise<ThreatFinding[]> {
    const { request, network } = input;
    const dapp = /^https?:\/\//.test(request.origin) ? { domain: request.origin } : { non_dapp: true };
    let v: Validation | null | undefined;
    if (network.family === "evm" && network.chainId) {
      const chain = CHAIN_NAMES[network.chainId] ?? String(network.chainId);
      if (request.method === "eth_sendTransaction") {
        const tx = (request.params as Record<string, string>[] | undefined)?.[0];
        if (!tx) return [];
        const r = await this.post<{ validation?: Validation }>("/v0/evm/transaction/scan", {
          chain,
          account_address: input.account,
          data: { from: tx.from ?? input.account, to: tx.to, data: tx.data ?? tx.input ?? "0x", value: tx.value ?? "0x0" },
          metadata: dapp,
          options: ["validation"],
        });
        v = r?.validation;
      } else if (SIGN_METHODS.has(request.method)) {
        const r = await this.post<{ validation?: Validation }>("/v0/evm/json-rpc/scan", {
          chain,
          account_address: input.account,
          data: { method: request.method, params: request.params },
          metadata: dapp,
          options: ["validation"],
        });
        v = r?.validation;
      }
    } else if (network.family === "solana") {
      let txs: Uint8Array[];
      try {
        const n = normalize(request, input.account);
        if (n.kind !== "tx") return [];
        txs = n.txs;
      } catch {
        return [];
      }
      const cluster = clusterOf(network.id);
      const r = await this.post<{ result?: { validation?: Validation | null } | null }>("/v0/solana/message/scan", {
        account_address: input.account,
        transactions: txs.map(b64),
        encoding: "base64",
        chain: cluster ?? "mainnet",
        metadata: /^https?:\/\//.test(request.origin) ? { url: request.origin } : { non_dapp: true },
        options: ["validation"],
      });
      v = r?.result?.validation;
    }
    return verdict(v);
  }
}

function verdict(v: Validation | null | undefined): ThreatFinding[] {
  if (!v) return [];
  const why = v.description || v.reason;
  if (v.result_type === "Malicious") {
    return [{ level: "danger", code: "malicious-transaction", source: "blockaid", message: `Blockaid says this would hurt you${why ? `: ${why}` : ""}. Don't sign it.` }];
  }
  if (v.result_type === "Warning") {
    return [{ level: "caution", code: "malicious-transaction", source: "blockaid", message: `Blockaid found something risky${why ? `: ${why}` : ""}.` }];
  }
  return [];
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s);
}
