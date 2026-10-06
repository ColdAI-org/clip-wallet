import type { ChainContext, DappRequest, Network } from "@clip-wallet/core";
import { createCosmosModule, COSMOS_METHODS } from "../src/module.js";
import { INITIA_TESTNET, OSMOSIS_TESTNET, PROVENANCE_TESTNET, THORCHAIN_MAINNET, nativeAsset, specOf } from "../src/networks.js";
import { SIGN_MODE_DIRECT, TYPE, encodeAuthInfo, encodeMsgSend, encodePubKey, encodeTxBody } from "../src/proto.js";
import { b64encode, fromHex } from "../src/util.js";
import { ADDR, PUB, accountInfo, balances, broadcastOk, ctxFor, mockFetch, simulated, txFound } from "./helpers.js";

/**
 * Deterministic signing scenarios shared by the tests and the offline script that produced test/signatures.ts
 * (it ran these builders, asked the vault to sign each prepare() digest with the "abandon … about" account, and
 * printed only the signatures).
 */

export const TXHASH = "9F2C1A7E4B3D5C6E7F8091A2B3C4D5E6F708192A3B4C5D6E7F8091A2B3C4D5E6";

export const opts = { simulate: false, pollIntervalMs: 0, pollAttempts: 2 } as const;

/** A node that knows our account (number 4242, sequence 7), holds balances, simulates 80 000 gas and accepts a broadcast. */
export function chainRoutes(address: string, bal: { denom: string; amount: string }[], extra: [RegExp, unknown][] = [], typeUrl?: string): [RegExp, unknown][] {
  return [
    ...extra,
    [new RegExp(`/cosmos/auth/v1beta1/account_info/${address}$`), accountInfo(address, "4242", "7", typeUrl)],
    [new RegExp(`/cosmos/bank/v1beta1/balances/${address}`), balances(bal)],
    [/\/cosmos\/tx\/v1beta1\/simulate$/, simulated("80000")],
    [/\/osmosis\/txfees\/v1beta1\/cur_eip_base_fee$/, { base_fee: "0.025000000000000000" }],
    [/\/initia\/tx\/v1\/gas_prices\/uinit$/, { gas_price: { denom: "uinit", amount: "0.015000000000000000" } }],
    [/\/thorchain\/network$/, { native_tx_fee_rune: "2000000", native_outbound_fee_rune: "2000000" }],
    [/\/provenance\/tx\/v1\/calculate_flat_fee$/, { total_fees: [{ denom: "nhash", amount: "7799095305" }], estimated_gas: "80304" }],
    [/\/cosmos\/tx\/v1beta1\/txs$/, broadcastOk(TXHASH)],
    [new RegExp(`/cosmos/tx/v1beta1/txs/${TXHASH}$`), txFound(TXHASH)],
  ];
}

export interface Scenario {
  family: "cosmos" | "provenance" | "thorchain" | "initia";
  network: Network;
  ctx: ChainContext;
  request: DappRequest;
  calls: { url: string; method: string; body?: string }[];
}

async function transfer(network: Network, from: string, to: string, amount: string, bal: { denom: string; amount: string }[], typeUrl?: string): Promise<Scenario> {
  const family = network.family as Scenario["family"];
  const m = mockFetch(chainRoutes(from, bal, [], typeUrl));
  const ctx = ctxFor(network, m.fetch);
  const mod = createCosmosModule({ family, ...opts });
  const request = await mod.buildTransfer({ asset: nativeAsset(specOf(network.id)!), to, amount }, ctx);
  return { family, network, ctx, request, calls: m.calls };
}

/** 1.5 OSMO to account 1 on osmo-test-5 (built by the wallet). */
export const osmoTransfer = () => transfer(OSMOSIS_TESTNET, ADDR.osmo, ADDR.osmoBob, "1500000", [{ denom: "uosmo", amount: "10000000" }]);

/** 0.5 INIT to account 1 on initiation-2 (ethsecp256k1, keccak digest). */
export const initiaTransfer = () =>
  transfer(INITIA_TESTNET, ADDR.init, ADDR.initBob, "500000", [{ denom: "uinit", amount: "3000000" }], "/initia.crypto.v1beta1.ethsecp256k1.PubKey");

/** 1 RUNE to account 1 on thorchain-1 (types.MsgSend, fixed native fee). */
export const thorTransfer = () => transfer(THORCHAIN_MAINNET, ADDR.thor, ADDR.thorBob, "100000000", [{ denom: "rune", amount: "500000000" }]);

/** 2 HASH to account 1 on pio-testnet-1. */
export const provenanceTransfer = () => transfer(PROVENANCE_TESTNET, ADDR.tp, ADDR.tpBob, "2000000000", [{ denom: "nhash", amount: "900000000000" }]);

/** What a dapp's cosmjs SigningStargateClient hands the wallet for a 1 uosmo MsgSend to itself. */
export function dappDirectDoc(): { bodyBytes: string; authInfoBytes: string; chainId: string; accountNumber: string } {
  const body = encodeTxBody({ messages: [{ typeUrl: TYPE.msgSend, value: encodeMsgSend({ fromAddress: ADDR.osmo, toAddress: ADDR.osmo, amount: [{ denom: "uosmo", amount: "1" }] }) }], memo: "matrix" });
  const auth = encodeAuthInfo({
    signerInfos: [{ publicKey: { typeUrl: "/cosmos.crypto.secp256k1.PubKey", value: encodePubKey(fromHex(PUB.cosmos)) }, mode: SIGN_MODE_DIRECT, sequence: 7n }],
    fee: { amount: [{ denom: "uosmo", amount: "5000" }], gasLimit: 200000n },
  });
  return { bodyBytes: b64encode(body), authInfoBytes: b64encode(auth), chainId: "osmo-test-5", accountNumber: "4242" };
}

export const dappAminoDoc = () => ({
  chain_id: "osmo-test-5",
  account_number: "4242",
  sequence: "7",
  fee: { amount: [{ denom: "uosmo", amount: "5000" }], gas: "200000" },
  msgs: [{ type: "cosmos-sdk/MsgSend", value: { from_address: ADDR.osmo, to_address: ADDR.osmoBob, amount: [{ denom: "uosmo", amount: "250000" }] } }],
  memo: "",
});

export const MESSAGE = "Clip Wallet dapp matrix: sign-in check (testnet)";

export function dappRequest(network: Network, method: string, params: unknown, origin = "https://app.osmosis.example"): DappRequest {
  return { id: `req-${method}`, origin, via: "injected", family: network.family, networkId: network.id, method, params };
}

/** Every signing scenario whose digest has a fixture signature. */
export async function allScenarios(): Promise<Scenario[]> {
  const fetchNone = mockFetch(chainRoutes(ADDR.osmo, [{ denom: "uosmo", amount: "10000000" }]));
  const osmoCtx = ctxFor(OSMOSIS_TESTNET, fetchNone.fetch);
  const initiaCtx = ctxFor(INITIA_TESTNET, fetchNone.fetch);
  return [
    await osmoTransfer(),
    await initiaTransfer(),
    await thorTransfer(),
    await provenanceTransfer(),
    { family: "cosmos", network: OSMOSIS_TESTNET, ctx: osmoCtx, calls: [], request: dappRequest(OSMOSIS_TESTNET, COSMOS_METHODS.signDirect, { signerAddress: ADDR.osmo, signDoc: dappDirectDoc() }) },
    { family: "cosmos", network: OSMOSIS_TESTNET, ctx: osmoCtx, calls: [], request: dappRequest(OSMOSIS_TESTNET, COSMOS_METHODS.signAmino, { signerAddress: ADDR.osmo, signDoc: dappAminoDoc() }) },
    { family: "cosmos", network: OSMOSIS_TESTNET, ctx: osmoCtx, calls: [], request: dappRequest(OSMOSIS_TESTNET, COSMOS_METHODS.signArbitrary, { signer: ADDR.osmo, data: btoa(MESSAGE) }) },
    { family: "initia", network: INITIA_TESTNET, ctx: initiaCtx, calls: [], request: dappRequest(INITIA_TESTNET, COSMOS_METHODS.signArbitrary, { signer: ADDR.init, data: btoa(MESSAGE) }) },
  ];
}
