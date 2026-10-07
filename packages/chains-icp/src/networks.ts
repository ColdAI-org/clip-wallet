import type { AssetRef, Network, NetworkId } from "@clip-wallet/core";

/**
 * The Internet Computer has one public network (mainnet); there's no public test network for ledger transfers.
 * DFINITY runs TEST ledgers on mainnet instead (TESTICP with a free faucet, ckTESTBTC on Bitcoin testnet4,
 * ckSepoliaETH / ckSepoliaUSDC on Sepolia), so Clip Wallet's "test" ICP network is mainnet restricted to those
 * test ledgers: nothing of value can move on it.
 *
 * Ids: there's no `icp` namespace in ChainAgnostic/namespaces yet. The open proposal (icvc/icp-namespace, listed
 * ON HOLD by the identity working group) uses "icp:" + the first 32 hex characters of SHA-256 of the IC root key
 * (DER, from https://icp-api.io/api/v2/status), which is `icp:737ba355e855bd4b61279056603e0550`. The test network
 * is Clip Wallet's own `icp:test` (same chain, test ledgers only); it never leaves the wallet.
 *
 * Boundary nodes (no key): https://icp-api.io (also https://ic0.app); both answered GET /api/v2/status on
 * 2026-10-06 with the root key.
 */
export type IcpNet = "test" | "mainnet";

export interface LedgerSpec {
  /** Ledger canister id (principal text). */
  canisterId: string;
  symbol: string;
  name: string;
  decimals: number;
  key: string;
  /** Chain-key twin of an asset native elsewhere (ckBTC, ckETH, ckUSDC). */
  bridged?: boolean;
  /** ICP-ledger API: also takes 32-byte account identifiers through the legacy `transfer` method. */
  accountIds?: boolean;
}

/**
 * Canister ids from dfinity/ic (rs/nns/canister_ids.json, rs/bitcoin/ckbtc/{mainnet,testnet}/canister_ids.json,
 * rs/ethereum/cketh/{mainnet,testnet}/canister_ids.json) and the developer docs "Chain-key token canister IDs";
 * symbol, decimals and fee checked with anonymous icrc1_symbol / icrc1_decimals / icrc1_fee queries.
 */
export const LEDGERS: Record<IcpNet, LedgerSpec[]> = {
  mainnet: [
    { canisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai", symbol: "ICP", name: "Internet Computer", decimals: 8, key: "icp", accountIds: true },
    { canisterId: "mxzaz-hqaaa-aaaar-qaada-cai", symbol: "ckBTC", name: "ckBTC", decimals: 8, key: "ckbtc", bridged: true },
    { canisterId: "xevnm-gaaaa-aaaar-qafnq-cai", symbol: "ckUSDC", name: "ckUSDC", decimals: 6, key: "ckusdc", bridged: true },
    { canisterId: "ss2fx-dyaaa-aaaar-qacoq-cai", symbol: "ckETH", name: "ckETH", decimals: 18, key: "cketh", bridged: true },
  ],
  test: [
    // TESTICP: faucet https://faucet.internetcomputer.org (no login).
    { canisterId: "xafvr-biaaa-aaaai-aql5q-cai", symbol: "TESTICP", name: "Test ICP", decimals: 8, key: "icp", accountIds: true },
    { canisterId: "mc6ru-gyaaa-aaaar-qaaaq-cai", symbol: "ckTESTBTC", name: "ckTESTBTC", decimals: 8, key: "ckbtc", bridged: true },
    { canisterId: "yfumr-cyaaa-aaaar-qaela-cai", symbol: "ckSepoliaUSDC", name: "ckSepoliaUSDC", decimals: 6, key: "ckusdc", bridged: true },
    { canisterId: "apia6-jaaaa-aaaar-qabma-cai", symbol: "ckSepoliaETH", name: "ckSepoliaETH", decimals: 18, key: "cketh", bridged: true },
  ],
};

export const ICP_IDS: Record<IcpNet, NetworkId> = {
  mainnet: "icp:737ba355e855bd4b61279056603e0550",
  test: "icp:test",
};

export const ICP_BOUNDARY = "https://icp-api.io";

export function ledgerAsset(networkId: NetworkId, l: LedgerSpec, native: boolean): AssetRef {
  const a: AssetRef = { key: l.key, symbol: l.symbol, name: l.name, decimals: l.decimals, networkId };
  if (!native) a.address = l.canisterId;
  if (l.bridged) a.bridged = true;
  return a;
}

function network(net: IcpNet): Network {
  const id = ICP_IDS[net];
  return {
    id,
    family: "icp",
    name: net === "mainnet" ? "Internet Computer" : "Internet Computer (test tokens)",
    nativeAsset: ledgerAsset(id, LEDGERS[net][0]!, true),
    testnet: net !== "mainnet",
    rpcUrls: [ICP_BOUNDARY],
    explorerUrl: "https://dashboard.internetcomputer.org",
  };
}

export const ICP_TEST = network("test");
export const ICP_MAINNET = network("mainnet");
export const ICP_NETWORKS: Network[] = [ICP_TEST, ICP_MAINNET];

export function netOf(networkId: NetworkId): IcpNet | null {
  if (networkId === ICP_IDS.mainnet) return "mainnet";
  if (networkId === ICP_IDS.test) return "test";
  return null;
}

export function ledgersFor(networkId: NetworkId): LedgerSpec[] {
  const n = netOf(networkId);
  return n ? LEDGERS[n] : [];
}

/** The ledger an asset lives on (native asset → the network's first ledger), or null. */
export function ledgerOf(networkId: NetworkId, asset: Pick<AssetRef, "address"> | string | undefined): LedgerSpec | null {
  const list = ledgersFor(networkId);
  const id = typeof asset === "string" ? asset : asset?.address;
  if (!id) return list[0] ?? null;
  return list.find((l) => l.canisterId === id) ?? null;
}

export function assetOfLedger(networkId: NetworkId, l: LedgerSpec): AssetRef {
  return ledgerAsset(networkId, l, ledgersFor(networkId)[0] === l);
}
