import type { Account, ChainContext, DappRequest, SignablePayload, Signature } from "@clip-wallet/core";
import { hash } from "starknet";
import { STARKNET_SEPOLIA, STRK_ADDRESS, ETH_ADDRESS } from "../src/index.js";
import { fromHex, hex } from "../src/util.js";

export const SEL = (name: string) => hash.getSelectorFromName(name);
export const USDC = "0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343";
export const BOB = "0x0000000000000000000000000000000000000000000000000000000000b0b0b0";

export function makeAccount(publicKey: string, address = ""): Account {
  return { id: "starknet:0", family: "starknet", index: 0, curve: "stark", derivationPath: "m/44'/9004'/0'/0/0", publicKey, address };
}

export function ctxFor(account: Account, f: typeof fetch): ChainContext {
  return { network: STARKNET_SEPOLIA, account, fetch: f };
}

export function req(method: string, params: unknown, id = "req-1", origin = "https://app.example"): DappRequest {
  return { id, origin, via: "injected", family: "starknet", networkId: STARKNET_SEPOLIA.id, method, params };
}

/** Fixed fee estimate (RPC 0.10 FEE_ESTIMATE): deterministic resource bounds, so transaction hashes are fixed. */
export const FEE = {
  l1_gas_consumed: "0x0",
  l1_gas_price: "0x72cca92674ca",
  l2_gas_consumed: "0x24641e",
  l2_gas_price: "0x4c5221de5",
  l1_data_gas_consumed: "0x1c0",
  l1_data_gas_price: "0x7784e2026e",
  overall_fee: "0xae67852d653556",
  unit: "FRI",
};

export interface ChainState {
  deployed: boolean;
  nonce: bigint;
  balances: Record<string, bigint>;
  /** Extra events for the simulated invoke (Cairo 1 ERC-20 layout). */
  events?: { token: string; from: string; to: string; amount: bigint }[];
  revert?: string;
}

type Handler = (params: unknown[]) => unknown;

/** Mock Starknet JSON-RPC by method; a handler may throw {code,message,data} for an RPC error. */
export function mockStarknet(state: ChainState, extra: Record<string, Handler> = {}) {
  const calls: { method: string; params: unknown[] }[] = [];
  const meta: Record<string, [string[], string[]]> = {
    [BigInt(STRK_ADDRESS).toString()]: [["0x0", "0x5354524b", "0x4"], ["0x12"]],
    [BigInt(ETH_ADDRESS).toString()]: [["0x0", "0x455448", "0x3"], ["0x12"]],
    [BigInt(USDC).toString()]: [["0x0", "0x55534443", "0x4"], ["0x6"]],
  };
  const u256 = (v: bigint) => [`0x${(v % 2n ** 128n).toString(16)}`, `0x${(v / 2n ** 128n).toString(16)}`];
  const methods: Record<string, Handler> = {
    starknet_getClassHashAt: () => {
      if (!state.deployed) throw { code: 20, message: "Contract not found" };
      return "0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381";
    },
    starknet_getNonce: () => `0x${state.nonce.toString(16)}`,
    starknet_call: (p) => {
      const c = p[0] as { contract_address: string; entry_point_selector: string; calldata: string[] };
      const token = BigInt(c.contract_address).toString();
      if (BigInt(c.entry_point_selector) === BigInt(SEL("balanceOf"))) return u256(state.balances[token] ?? 0n);
      const m = meta[token];
      if (!m) throw { code: 20, message: "Contract not found" };
      if (BigInt(c.entry_point_selector) === BigInt(SEL("symbol"))) return m[0];
      if (BigInt(c.entry_point_selector) === BigInt(SEL("decimals"))) return m[1];
      throw { code: 40, message: "Contract error" };
    },
    starknet_estimateFee: (p) => (p[0] as unknown[]).map(() => FEE),
    starknet_simulateTransactions: (p) =>
      (p[1] as { type: string; sender_address?: string }[]).map((tx) => ({
        fee_estimation: FEE,
        transaction_trace:
          tx.type === "DEPLOY_ACCOUNT"
            ? { type: "DEPLOY_ACCOUNT", constructor_invocation: { contract_address: "0x1", calls: [], events: [] } }
            : {
                type: "INVOKE",
                execute_invocation: state.revert
                  ? { revert_reason: state.revert }
                  : {
                      contract_address: tx.sender_address,
                      events: [],
                      calls: (state.events ?? []).map((e) => ({
                        contract_address: e.token,
                        calls: [],
                        events: [{ keys: [SEL("Transfer"), e.from, e.to], data: u256(e.amount) }],
                      })),
                    },
              },
      })),
    starknet_addDeployAccountTransaction: () => ({ transaction_hash: "0xd0", contract_address: "0x1" }),
    starknet_addInvokeTransaction: () => ({ transaction_hash: "0x1abc" }),
    starknet_getTransactionStatus: () => ({ finality_status: "ACCEPTED_ON_L2", execution_status: "SUCCEEDED" }),
    ...extra,
  };
  const f = (async (_input: string | URL | Request, init?: RequestInit) => {
    const r = JSON.parse(String(init?.body ?? "{}")) as { id: number; method: string; params: unknown[] };
    calls.push({ method: r.method, params: r.params });
    const h = methods[r.method];
    if (!h) return new Response(JSON.stringify({ jsonrpc: "2.0", id: r.id, error: { code: -32601, message: `no mock for ${r.method}` } }));
    try {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: r.id, result: h(r.params) }));
    } catch (e) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: r.id, error: e }));
    }
  }) as typeof fetch;
  return { fetch: f, calls };
}

/** Vault stand-in: answers with precomputed [r,s] signatures for known payloads (no signing here). */
export function fixtureSigner(publicKey: string, table: Record<string, string>) {
  return {
    sign(p: SignablePayload): Signature {
      const sig = table[hex(p.bytes)];
      if (!sig) throw new Error(`no fixture signature for payload ${hex(p.bytes)}`);
      return { scheme: "stark-ecdsa", bytes: fromHex(sig), publicKey };
    },
  };
}

/** SNIP-12 revision 1 example (shape from the SNIP-12 spec / starknet.js docs). */
export const TYPED_DATA = {
  types: {
    StarknetDomain: [
      { name: "name", type: "shortstring" },
      { name: "version", type: "shortstring" },
      { name: "chainId", type: "shortstring" },
      { name: "revision", type: "shortstring" },
    ],
    Mail: [
      { name: "from", type: "shortstring" },
      { name: "to", type: "shortstring" },
      { name: "contents", type: "shortstring" },
    ],
  },
  primaryType: "Mail",
  domain: { name: "Example App", version: "1", chainId: "SN_SEPOLIA", revision: "1" },
  message: { from: "alice", to: "bob", contents: "hello" },
};

export const transferCall = (token: string, to: string, amount: bigint) => ({
  contract_address: token,
  entry_point: "transfer",
  calldata: [to, `0x${(amount % 2n ** 128n).toString(16)}`, `0x${(amount / 2n ** 128n).toString(16)}`],
});
