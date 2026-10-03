/**
 * ENS via viem (Universal Resolver, CCIP-Read, ENSIP-10 wildcards — so Basenames and other L2/offchain names
 * resolve too).
 *
 * Forward: the default (coinType 60) address, plus chain-specific records (ENSIP-11/ENSIP-19 coinType
 * `0x80000000 | chainId`) for the L2s where ENS primary names are supported: Base, OP Mainnet, Arbitrum One,
 * Scroll and Linea (https://docs.ens.domains/web/reverse). A name that only has a Base record implies Base;
 * a name with a default record works on every EVM network.
 *
 * Reverse (primary names): getEnsName with the chain's coinType; the Universal Resolver checks that the
 * forward record matches, so a spoofed reverse record never shows.
 */
import type { Family, Network, NetworkId } from "@clip-wallet/core";
import { ClipError } from "@clip-wallet/core";
import { createPublicClient, http, isAddress, getAddress, type PublicClient } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { normalize, toCoinType } from "viem/ens";
import type { Backend, ResolvedName } from "./types.js";

/** Chains with ENS L2 primary-name support (docs.ens.domains/web/reverse, checked 2026-10-03). */
export const ENS_L2_CHAIN_IDS = [8453, 10, 42161, 534352, 59144] as const;
/** Basenames: `*.base.eth` lives on Base (https://docs.base.org/identity/basenames). */
const IMPLIED_BY_SUFFIX: [RegExp, number][] = [[/\.base\.eth$/, 8453]];

/** The subset of viem's PublicClient we use, so tests can stub it. */
export interface EnsClient {
  getEnsAddress(args: { name: string; coinType?: bigint }): Promise<string | null>;
  getEnsName(args: { address: `0x${string}`; coinType?: bigint }): Promise<string | null>;
}

export interface EnsOptions {
  /** Which ENS deployment to read. Default "mainnet": people's names live there even in a testnet build. */
  ensChain?: "mainnet" | "sepolia";
  rpcUrl?: string;
  fetch?: typeof fetch;
  /** The wallet's enabled networks: implied networks outside this list are dropped (family-wide instead). */
  networks?: Network[];
  client?: EnsClient;
}

const DEFAULT_RPC = { mainnet: "https://ethereum-rpc.publicnode.com", sepolia: "https://ethereum-sepolia-rpc.publicnode.com" };

export function isEnsName(name: string): boolean {
  return /^([^.\s]+\.)+eth$/i.test(name.trim());
}

export class EnsBackend implements Backend {
  readonly service = "ens" as const;
  private readonly client: EnsClient;
  private readonly enabled: Set<NetworkId> | null;

  constructor(opts: EnsOptions = {}) {
    const chain = opts.ensChain === "sepolia" ? sepolia : mainnet;
    this.client =
      opts.client ??
      (createPublicClient({
        chain,
        transport: http(opts.rpcUrl ?? DEFAULT_RPC[opts.ensChain ?? "mainnet"], { fetchFn: opts.fetch, timeout: 8000, retryCount: 1 }),
      }) as unknown as PublicClient as unknown as EnsClient);
    this.enabled = opts.networks ? new Set(opts.networks.filter((n) => n.family === "evm").map((n) => n.id)) : null;
  }

  handles(name: string): boolean {
    return isEnsName(name);
  }

  private keep(chainIds: number[]): NetworkId[] {
    const ids = chainIds.map((c) => `eip155:${c}`);
    return this.enabled ? ids.filter((i) => this.enabled!.has(i)) : ids;
  }

  async resolve(raw: string): Promise<ResolvedName | null> {
    let name: string;
    try {
      name = normalize(raw.trim());
    } catch {
      return null; // not a valid ENS name (UTS-46/ENSIP-15)
    }
    const call = (coinType?: bigint) =>
      this.client.getEnsAddress(coinType === undefined ? { name } : { name, coinType }).then(
        (a) => (a && isAddress(a) && !/^0x0{40}$/i.test(a) ? getAddress(a) : null),
        (e: unknown) => {
          throw new ClipError("We couldn't look up that name right now. Paste their address instead, or try again.", "names/ens-unavailable", e);
        },
      );
    const implied = IMPLIED_BY_SUFFIX.find(([re]) => re.test(name))?.[1];
    const [def, ...perChain] = await Promise.all([call(), ...ENS_L2_CHAIN_IDS.map((c) => call(toCoinType(c)).catch(() => null))]);
    const chainRecords = ENS_L2_CHAIN_IDS.map((c, i) => ({ chainId: c, address: perChain[i] ?? null })).filter((r) => r.address);

    if (implied !== undefined) {
      const rec = chainRecords.find((r) => r.chainId === implied)?.address ?? def;
      if (!rec) return null;
      return { name, address: rec, family: "evm", networkIds: this.keep([implied]), service: "ens", displayName: name };
    }
    if (def) {
      // A chain record that differs from the default means that chain pays a different address: carry it.
      const addressOn: Record<NetworkId, string> = {};
      for (const r of chainRecords) if (r.address !== def) for (const id of this.keep([r.chainId])) addressOn[id] = r.address!;
      return { name, address: def, family: "evm", networkIds: [], service: "ens", displayName: name, ...(Object.keys(addressOn).length ? { addressOn } : {}) };
    }
    if (chainRecords.length === 0) return null;
    const first = chainRecords[0]!;
    const same = chainRecords.filter((r) => r.address === first.address).map((r) => r.chainId);
    return { name, address: first.address!, family: "evm", networkIds: this.keep(same), service: "ens", displayName: name };
  }

  async reverse(address: string, family: Family, networkId?: NetworkId): Promise<string | null> {
    if (family !== "evm" || !isAddress(address)) return null;
    const chainId = networkId?.startsWith("eip155:") ? Number(networkId.slice(7)) : 1;
    const coinType = (ENS_L2_CHAIN_IDS as readonly number[]).includes(chainId) ? toCoinType(chainId) : undefined;
    try {
      const n = await this.client.getEnsName(coinType === undefined ? { address: getAddress(address) } : { address: getAddress(address), coinType });
      if (n) return n;
      // L2 primary names fall back to the default (mainnet) primary name.
      return coinType === undefined ? null : await this.client.getEnsName({ address: getAddress(address) });
    } catch {
      return null;
    }
  }
}
