import type { Edge, Ledger, RouteGraphData } from "./clprouter.js";
import { TESTNET_CHANNELS } from "./deployments.js";

/**
 * Route graph for the CLPRouter testnet deployment (Sepolia <-> Hedera testnet).
 *
 * Topology and verifiers come from the deployment records. Every price, gas and timing figure is a placeholder
 * (listed in `synthetic`) until the quote service's live graph is wired in: testnet coins have no price, so fees
 * are expressed at reference mainnet prices to give users a sense of scale.
 *
 * Both Channel directions are `projected`, which the planner skips unless `allowProjected` is set:
 *  - Sepolia -> Hedera is verified on Hedera by EthMainnetVerifier (Ethereum sync committee), but the Hedera side of
 *    the Channel is not open yet.
 *  - Hedera -> Sepolia is "verified" on Sepolia by TestOnlyStubVerifier, which accepts no bundles.
 */
export function testnetGraph(): RouteGraphData {
  const channel = TESTNET_CHANNELS[0]!;
  const sepolia: Ledger = {
    id: "eip155:11155111",
    name: "Ethereum (Sepolia test network)",
    nativeUsd: 2500,
    gasPriceNative: 1e-9,
    avgTxGas: 100_000,
    enqueueGas: 400_000,
    execGasPerMessage: 500_000,
    consensus: "pos",
    synthetic: ["nativeUsd", "gasPriceNative", "avgTxGas", "enqueueGas", "execGasPerMessage"],
  };
  const hedera: Ledger = {
    id: "eip155:296",
    name: "Hedera (test network)",
    nativeUsd: 0.07,
    gasPriceNative: 7.1e-7,
    avgTxGas: 100_000,
    enqueueGas: 400_000,
    execGasPerMessage: 500_000,
    consensus: "hashgraph",
    synthetic: ["nativeUsd", "gasPriceNative", "avgTxGas", "enqueueGas", "execGasPerMessage"],
  };
  const common = {
    channelId: channel.channelId,
    finalized: true,
    history: { attempts: 0, successes: 0, pauses30d: 0 },
    maxPayloadBytes: 8192,
    offChain: { kWhPerBundle: 0.001, gridKgPerKWh: 0.4, source: { kind: "synthetic" as const } },
    connectors: [{ id: channel.connectorId, marginUsd: 0, balanceUsd: 50, successRate: 1 }],
    synthetic: ["timing", "bundle", "offChain", "connectors.balanceUsd", "maxPayloadBytes"],
  };
  const toHedera: Edge = {
    ...common,
    from: sepolia.id,
    to: hedera.id,
    verifierFamily: "ethereum-sync-committee",
    trustTier: "committee",
    timing: { sourceFinalityS: 900, bundleCadenceS: 60, proofGenS: 60, verifyS: 10 },
    bundle: { gas: 2_000_000, calldataBytes: 40_000, messagesPerBundle: 1 },
    status: "projected",
    notes: "EthMainnetVerifier on Hedera testnet; Hedera side of the Channel not open yet",
  };
  const toSepolia: Edge = {
    ...common,
    from: hedera.id,
    to: sepolia.id,
    verifierFamily: "test-only-stub",
    trustTier: "attested",
    timing: { sourceFinalityS: 5, bundleCadenceS: 60, proofGenS: 0, verifyS: 15 },
    bundle: { gas: 100_000, calldataBytes: 1_000, messagesPerBundle: 1 },
    status: "projected",
    notes: "TestOnlyStubVerifier on Sepolia: TEST ONLY, accepts no bundles",
  };
  return {
    version: "clprouter-testnet-2026-10-01",
    asOf: "2026-10-01",
    ledgers: [sepolia, hedera],
    edges: [toHedera, toSepolia],
  };
}
