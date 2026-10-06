/**
 * Node side of the dapp matrix: the matrix wallet's testnet per family, its balance read with the wallet's OWN chain
 * modules (`getBalances`, exactly what Home shows), the address re-derived from the public key with the module's own
 * `addressFromPublicKey`, and transaction confirmation on each testnet's public RPC / explorer API.
 *
 * Used by matrix.spec.ts (skip broadcast levels until funded, confirm broadcasts) and by
 * scripts/dapp-matrix-balances.mjs (prints balances so you can see when funding has landed). Public data only.
 */
import type { Account, ChainModule, Family, Network } from "@clip-wallet/core";
import { EVM_NETWORKS, HEDERA_EVM_NETWORKS, createEvmModule } from "@clip-wallet/chains-evm";
import { HEDERA_TESTNET, createHederaModule } from "@clip-wallet/chains-hedera";
import { SOLANA_DEVNET, createSolanaModule } from "@clip-wallet/chains-solana";
import { BITCOIN_NETWORKS, BITCOIN_TESTNET4, createBitcoinModule } from "@clip-wallet/chains-bitcoin";
import { SUI_TESTNET, createSuiModule } from "@clip-wallet/chains-sui";
import { APTOS_TESTNET, createAptosModule } from "@clip-wallet/chains-aptos";
import { CARDANO_PREPROD, addressToBech32, baseAddress, createCardanoModule, meOf } from "@clip-wallet/chains-cardano";
import { SUBSTRATE_NETWORKS, createSubstrateModule } from "@clip-wallet/chains-substrate";
import { STARKNET_SEPOLIA, createStarknetModule } from "@clip-wallet/chains-starknet";
import { TON_TESTNET, createTonModule } from "@clip-wallet/chains-ton";
import { NEAR_TESTNET, createNearModule } from "@clip-wallet/chains-near";
import { STELLAR_TESTNET, createStellarModule } from "@clip-wallet/chains-stellar";
import { TEZOS_SHADOWNET, createTezosModule } from "@clip-wallet/chains-tezos";
import { ALGORAND_TESTNET, createAlgorandModule } from "@clip-wallet/chains-algorand";
import { INITIA_TESTNET, OSMOSIS_TESTNET, PROVENANCE_TESTNET, createCosmosModule } from "@clip-wallet/chains-cosmos";
import { TRON_NILE, createTronModule } from "@clip-wallet/chains-tron";
import { STACKS_TESTNET, createStacksModule } from "@clip-wallet/chains-stacks";
import { FUEL_TESTNET, createFuelModule } from "@clip-wallet/chains-fuel";
import { BCH_CHIPNET, createBitcoinCashModule } from "@clip-wallet/chains-bitcoincash";
import { MULTIVERSX_DEVNET, createMultiversXModule } from "@clip-wallet/chains-multiversx";
import { ICP_TEST, createIcpModule } from "@clip-wallet/chains-icp";
import { XRPL_TESTNET, createXrplModule } from "@clip-wallet/chains-xrpl";
import ADDRESSES from "./addresses.json" with { type: "json" };

export type MatrixFamily = Exclude<Family, never>;
/**
 * "hedera-evm" = Hedera testnet reached through 1Mask's EIP-1193 provider (the EVM account, chain 296).
 * networks87: "cosmos" is Osmosis testnet (osmo-test-5), "chainflip" the Chainflip Perseverance testnet (substrate
 * family). Provenance, Initia, MultiversX, ICP and Bitcoin Cash are funding/balance targets only: no injected dapp
 * standard Clip can answer under its own identity (docs/r1/networks87.md), so they have no dapp page.
 */
export type Target =
  | "evm" | "hedera-evm" | "hedera" | "solana" | "bitcoin" | "sui" | "aptos" | "cardano" | "substrate" | "starknet" | "ton" | "near" | "stellar" | "tezos" | "algorand"
  | "cosmos" | "tron" | "stacks" | "fuel" | "chainflip" | "xrpl"
  | "provenance" | "initia" | "multiversx" | "icp" | "bitcoincash";

interface Entry {
  address: string;
  publicKey: string;
  path: string;
  taproot?: string;
  /** The vault's own spelling when the target network spells it differently (Cosmos prefixes, Stacks ST, bchtest:, cF…). */
  vaultAddress?: string;
}
const ADDR = ADDRESSES as unknown as Record<string, Entry>;
/** addresses.json entry: per target where it has one (networks87), else per family. */
const entryOf = (t: Target): Entry => ADDR[t] ?? ADDR[TARGETS[t].family]!;

const SEPOLIA = EVM_NETWORKS.find((n) => n.chainId === 11155111)!;
const HEDERA_EVM = HEDERA_EVM_NETWORKS.find((n) => n.chainId === 296)!;

/** Each target: the network the matrix uses (the wallet's default testnet for dapps), its module and the minimum it needs. */
export const TARGETS: Record<Target, { network: Network; module: () => ChainModule; family: Family; minimum: bigint; faucetHint: string }> = {
  evm: { network: SEPOLIA, module: createEvmModule, family: "evm", minimum: 10n ** 15n, faucetHint: "0.001 Sepolia ETH" },
  "hedera-evm": { network: HEDERA_EVM, module: createEvmModule, family: "evm", minimum: 2n * 10n ** 18n, faucetHint: "2 HBAR on the EVM account" },
  hedera: { network: HEDERA_TESTNET, module: createHederaModule, family: "hedera", minimum: 2n * 10n ** 8n, faucetHint: "2 HBAR" },
  solana: { network: SOLANA_DEVNET, module: createSolanaModule, family: "solana", minimum: 10_000_000n, faucetHint: "0.01 SOL (devnet)" },
  bitcoin: { network: BITCOIN_NETWORKS.find((n) => n.id === BITCOIN_TESTNET4)!, module: createBitcoinModule, family: "bitcoin", minimum: 5_000n, faucetHint: "5,000 sats (testnet4)" },
  sui: { network: SUI_TESTNET, module: createSuiModule, family: "sui", minimum: 50_000_000n, faucetHint: "0.05 SUI" },
  aptos: { network: APTOS_TESTNET, module: createAptosModule, family: "aptos", minimum: 1_000_000n, faucetHint: "0.01 APT" },
  cardano: { network: CARDANO_PREPROD, module: createCardanoModule, family: "cardano", minimum: 3_000_000n, faucetHint: "3 tADA (preprod)" },
  substrate: { network: SUBSTRATE_NETWORKS.find((n) => n.name === "Westend")!, module: createSubstrateModule, family: "substrate", minimum: 2n * 10n ** 12n, faucetHint: "2 WND" },
  starknet: { network: STARKNET_SEPOLIA, module: createStarknetModule, family: "starknet", minimum: 10n ** 17n, faucetHint: "0.1 STRK (Sepolia; pays the account deploy too)" },
  ton: { network: TON_TESTNET, module: createTonModule, family: "ton", minimum: 200_000_000n, faucetHint: "0.2 TON (testnet; pays the wallet deploy too)" },
  near: { network: NEAR_TESTNET, module: createNearModule, family: "near", minimum: 10n ** 23n, faucetHint: "0.1 NEAR (testnet)" },
  stellar: { network: STELLAR_TESTNET, module: createStellarModule, family: "stellar", minimum: 15_000_000n, faucetHint: "1.5 XLM (account reserve 1 XLM + fees)" },
  tezos: { network: TEZOS_SHADOWNET, module: createTezosModule, family: "tezos", minimum: 1_000_000n, faucetHint: "1 XTZ (shadownet; first op reveals the key)" },
  algorand: { network: ALGORAND_TESTNET, module: createAlgorandModule, family: "algorand", minimum: 200_000n, faucetHint: "0.2 ALGO (min balance 0.1 + fees)" },
  // networks87
  cosmos: { network: OSMOSIS_TESTNET, module: () => createCosmosModule({ family: "cosmos" }), family: "cosmos", minimum: 100_000n, faucetHint: "0.1 OSMO (osmo-test-5)" },
  tron: { network: TRON_NILE, module: createTronModule, family: "tron", minimum: 2_000_000n, faucetHint: "2 TRX (Nile)" },
  stacks: { network: STACKS_TESTNET, module: createStacksModule, family: "stacks", minimum: 10_000n, faucetHint: "0.01 STX (testnet)" },
  fuel: { network: FUEL_TESTNET, module: createFuelModule, family: "fuel", minimum: 200n, faucetHint: "0.0000002 ETH (Fuel testnet)" },
  xrpl: { network: XRPL_TESTNET, module: createXrplModule, family: "xrpl", minimum: 1_100_000n, faucetHint: "1.1 XRP (testnet; 1 XRP base reserve + fees)" },
  chainflip: { network: SUBSTRATE_NETWORKS.find((n) => n.name === "Chainflip Perseverance")!, module: createSubstrateModule, family: "substrate", minimum: 10n ** 17n, faucetHint: "0.1 tFLIP funded from Sepolia" },
  provenance: { network: PROVENANCE_TESTNET, module: () => createCosmosModule({ family: "provenance" }), family: "provenance", minimum: 10n ** 9n, faucetHint: "1 HASH (pio-testnet-1)" },
  initia: { network: INITIA_TESTNET, module: () => createCosmosModule({ family: "initia" }), family: "initia", minimum: 100_000n, faucetHint: "0.1 INIT (initiation-2)" },
  multiversx: { network: MULTIVERSX_DEVNET, module: createMultiversXModule, family: "multiversx", minimum: 10n ** 16n, faucetHint: "0.01 xEGLD (devnet)" },
  icp: { network: ICP_TEST, module: createIcpModule, family: "icp", minimum: 100_000n, faucetHint: "0.001 TESTICP" },
  bitcoincash: { network: BCH_CHIPNET, module: createBitcoinCashModule, family: "bitcoincash", minimum: 5_000n, faucetHint: "5,000 sats (chipnet)" },
};

export const TARGET_ORDER: Target[] = [
  "evm", "hedera-evm", "hedera", "solana", "bitcoin", "sui", "aptos", "cardano", "substrate", "starknet", "ton", "near", "stellar", "tezos", "algorand",
  "cosmos", "tron", "stacks", "fuel", "xrpl", "chainflip", "provenance", "initia", "multiversx", "icp", "bitcoincash",
];

const hexToBytes = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));

/** The matrix account for a target, shaped as the wallet's background holds it. */
export function accountOf(t: Target): Account {
  const family = TARGETS[t].family;
  const e = entryOf(t);
  return {
    id: `${family}:0`,
    family,
    index: 0,
    curve: family === "substrate" ? "sr25519" : family === "multiversx" ? "ed25519" : "secp256k1",
    derivationPath: e.path,
    publicKey: e.publicKey,
    address: e.vaultAddress ?? e.address,
  } as Account;
}

export const addressOf = (t: Target): string => entryOf(t).address;
export const publicKeyOf = (t: Target): string => entryOf(t).publicKey;

const modules = new Map<Target, ChainModule>();
const moduleOf = (t: Target) => {
  let m = modules.get(t);
  if (!m) modules.set(t, (m = TARGETS[t].module()));
  return m;
};

/** The chain module's own address for the vault's public key (must equal addresses.json). */
export function moduleAddress(t: Target): string | null {
  try {
    if (t === "cardano") {
      // The vault's address is the CIP-1852 base address (payment key + stake key 2/0); the payment key alone gives the
      // enterprise address. The module's own account check (meOf: the address's payment part must be this key's hash,
      // used by balances, CIP-30 and tx building) rebuilds the base address the wallet shows and uses.
      const me = meOf({ network: TARGETS[t].network, account: accountOf(t), fetch: globalThis.fetch.bind(globalThis) });
      return me.stake?.kind === "key" ? addressToBech32(baseAddress(me.networkId, me.paymentKeyHash, me.stake.hash)) : null;
    }
    return moduleOf(t).addressFromPublicKey(hexToBytes(publicKeyOf(t)), TARGETS[t].network);
  } catch {
    return null;
  }
}

export interface BalanceRow {
  target: Target;
  network: string;
  address: string;
  native: string;
  amount: bigint | null;
  minimum: bigint;
  funded: boolean;
  error?: string;
}

/** Native balance on the matrix testnet, through the wallet's chain module. */
export async function balanceOf(t: Target): Promise<BalanceRow> {
  const { network, minimum } = TARGETS[t];
  const row: BalanceRow = { target: t, network: network.id, address: addressOf(t), native: network.nativeAsset.symbol, amount: null, minimum, funded: false };
  try {
    const list = await moduleOf(t).getBalances({ network, account: accountOf(t), fetch: globalThis.fetch.bind(globalThis) });
    const native = list.find((b) => b.asset.key === network.nativeAsset.key && !b.asset.address) ?? list.find((b) => b.asset.symbol === network.nativeAsset.symbol);
    row.amount = BigInt(native?.amount ?? "0");
    row.funded = row.amount >= minimum;
  } catch (e) {
    row.error = String((e as Error).message ?? e).slice(0, 160);
  }
  return row;
}

export function formatAmount(v: bigint | null, decimals: number): string {
  if (v === null) return "?";
  const s = v.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

const j = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json() as Promise<any>;
};
const rpc = async (url: string, method: string, params: unknown) => {
  const r = await j(url, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (r.error) throw new Error(JSON.stringify(r.error));
  return r.result;
};

/** Explorer link for a confirmed transaction. */
export function explorerTx(t: Target, id: string): string {
  const n = TARGETS[t].network;
  switch (t) {
    case "evm":
      return `https://sepolia.etherscan.io/tx/${id}`;
    case "hedera-evm":
    case "hedera":
      return `https://hashscan.io/testnet/transaction/${id}`;
    case "solana":
      return `https://explorer.solana.com/tx/${id}?cluster=devnet`;
    case "bitcoin":
      return `https://mempool.space/testnet4/tx/${id}`;
    case "sui":
      return `https://suiscan.xyz/testnet/tx/${id}`;
    case "aptos":
      return `https://explorer.aptoslabs.com/txn/${id}?network=testnet`;
    case "cardano":
      return `https://preprod.cardanoscan.io/transaction/${id}`;
    case "substrate":
      return `https://westend.subscan.io/extrinsic/${id}`;
    case "starknet":
      return `https://sepolia.voyager.online/tx/${id}`;
    case "ton":
      return `https://testnet.tonviewer.com/transaction/${id}`;
    case "near":
      return `https://testnet.nearblocks.io/txns/${id}`;
    case "stellar":
      return `https://stellar.expert/explorer/testnet/tx/${id}`;
    case "tezos":
      return `https://shadownet.tzkt.io/${id}`;
    case "algorand":
      return `https://lora.algokit.io/testnet/transaction/${id}`;
    case "cosmos":
      return `https://www.mintscan.io/osmosis-testnet/tx/${id}`;
    case "tron":
      return `https://nile.tronscan.org/#/transaction/${id}`;
    case "stacks":
      return `https://explorer.hiro.so/txid/${id.startsWith("0x") ? id : `0x${id}`}?chain=testnet`;
    case "fuel":
      return `https://app-testnet.fuel.network/tx/${id}`;
    case "chainflip":
      return `https://scan.perseverance.chainflip.io/blocks/${id}`;
    case "xrpl":
      return `https://testnet.xrpl.org/transactions/${id}`;
    default:
      return `${n.explorerUrl}/tx/${id}`;
  }
}

/**
 * Polls the testnet until `id` is confirmed (true) or the deadline passes (false). Uses public RPC / indexer APIs
 * independent of the wallet, so a pass means the transaction really landed.
 */
export async function confirmTx(t: Target, id: string, timeoutMs = 120_000): Promise<boolean> {
  const n = TARGETS[t].network;
  const deadline = Date.now() + timeoutMs;
  const once = async (): Promise<boolean> => {
    switch (t) {
      case "evm":
      case "hedera-evm": {
        const r = await rpc(n.rpcUrls[0]!, "eth_getTransactionReceipt", [id]);
        return !!r && r.status === "0x1";
      }
      case "hedera": {
        const r = await j(`https://testnet.mirrornode.hedera.com/api/v1/transactions/${id.replace("@", "-").replace(/\.(\d+)$/, "-$1")}`);
        return r.transactions?.some((x: { result: string }) => x.result === "SUCCESS") ?? false;
      }
      case "solana": {
        const r = await rpc("https://api.devnet.solana.com", "getSignatureStatuses", [[id], { searchTransactionHistory: true }]);
        const s = r?.value?.[0];
        return !!s && !s.err && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized");
      }
      case "bitcoin": {
        const r = await fetch(`https://mempool.space/testnet4/api/tx/${id}`);
        return r.ok; // accepted by the network (mempool or block)
      }
      case "sui": {
        const r = await j("https://graphql.testnet.sui.io/graphql", { method: "POST", body: JSON.stringify({ query: `{ transaction(digest: "${id}") { effects { status } } }` }) });
        return r.data?.transaction?.effects?.status === "SUCCESS";
      }
      case "aptos": {
        const r = await fetch(`https://api.testnet.aptoslabs.com/v1/transactions/by_hash/${id}`);
        if (!r.ok) return false;
        const x = (await r.json()) as { success?: boolean; type?: string };
        return x.type === "user_transaction" && x.success === true;
      }
      case "cardano": {
        const r = await j("https://preprod.koios.rest/api/v1/tx_status", { method: "POST", body: JSON.stringify({ _tx_hashes: [id] }) });
        return (r?.[0]?.num_confirmations ?? 0) > 0;
      }
      case "substrate": {
        // Block hash of inclusion is what the wallet returns for substrate; accept an extrinsic hash via Subscan-free check:
        const r = await rpc(n.rpcUrls[0]!, "chain_getBlock", [id]).catch(() => null);
        return !!r;
      }
      case "starknet": {
        const r = await rpc(n.rpcUrls[0]!, "starknet_getTransactionStatus", { transaction_hash: id }).catch(() => null);
        return !!r && (r.finality_status === "ACCEPTED_ON_L2" || r.finality_status === "ACCEPTED_ON_L1") && r.execution_status !== "REVERTED";
      }
      case "ton": {
        const r = await j(`https://testnet.toncenter.com/api/v3/transactionsByMessage?msg_hash=${encodeURIComponent(id)}&direction=in`).catch(() => null);
        if (r?.transactions?.length) return true;
        const r2 = await j(`https://testnet.toncenter.com/api/v3/transactions?hash=${encodeURIComponent(id)}`).catch(() => null);
        return !!r2?.transactions?.length;
      }
      case "near": {
        const r = await rpc(n.rpcUrls[0]!, "tx", { tx_hash: id, sender_account_id: addressOf("near"), wait_until: "EXECUTED_OPTIMISTIC" }).catch(() => null);
        return !!r?.status && "SuccessValue" in r.status;
      }
      case "stellar": {
        const r = await fetch(`https://horizon-testnet.stellar.org/transactions/${id}`);
        if (!r.ok) return false;
        return ((await r.json()) as { successful?: boolean }).successful === true;
      }
      case "tezos": {
        const r = await j(`https://api.shadownet.tzkt.io/v1/operations/${id}`).catch(() => []);
        return Array.isArray(r) && r.length > 0 && r.every((o: { status?: string }) => o.status === "applied");
      }
      case "cosmos": {
        const r = await j(`${n.rpcUrls[0]!.replace(/\/$/, "")}/cosmos/tx/v1beta1/txs/${id}`).catch(() => null);
        return r?.tx_response?.code === 0 && Number(r.tx_response.height) > 0;
      }
      case "tron": {
        const r = await j("https://nile.trongrid.io/wallet/gettransactioninfobyid", { method: "POST", body: JSON.stringify({ value: id }) }).catch(() => null);
        return !!r?.blockNumber && (r.receipt?.result === undefined || r.receipt.result === "SUCCESS") && r.result !== "FAILED";
      }
      case "stacks": {
        const r = await j(`https://api.testnet.hiro.so/extended/v1/tx/${id.startsWith("0x") ? id : `0x${id}`}`).catch(() => null);
        return r?.tx_status === "success";
      }
      case "fuel": {
        const r = await j("https://testnet.fuel.network/v1/graphql", { method: "POST", body: JSON.stringify({ query: `{ transaction(id: "${id}") { status { __typename } } }` }) }).catch(() => null);
        return r?.data?.transaction?.status?.__typename === "SuccessStatus";
      }
      case "xrpl": {
        const r = await rpc("https://s.altnet.rippletest.net:51234", "tx", [{ transaction: id }]).catch(() => null);
        return r?.validated === true && r?.meta?.TransactionResult === "tesSUCCESS";
      }
      case "chainflip": {
        const r = await rpc(n.rpcUrls[0]!, "chain_getBlock", [id]).catch(() => null);
        return !!r;
      }
      case "algorand": {
        const r = await fetch(`https://testnet-idx.4160.nodely.dev/v2/transactions/${id}`);
        if (!r.ok) return false;
        const x = (await r.json()) as { transaction?: { "confirmed-round"?: number } };
        return (x.transaction?.["confirmed-round"] ?? 0) > 0;
      }
    }
    return false;
  };
  while (Date.now() < deadline) {
    try {
      if (await once()) return true;
    } catch {
      /* not there yet */
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}
