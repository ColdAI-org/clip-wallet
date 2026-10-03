import type { Account, ChainContext, DappRequest, SignablePayload, Signature } from "@clip-wallet/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import { SUI_TESTNET } from "../src/index.js";
import { b64decode, fromHex } from "../src/util.js";
import { FIX } from "./signatures.js";

/** Vault stand-in: answers with a precomputed signature that verifies for the payload (verification only). */
export function fixtureSigner(serialized: readonly string[]) {
  const pub = fromHex(FIX.publicKey);
  const sigs = serialized.map((s) => b64decode(s).slice(1, 65));
  return {
    sign(p: SignablePayload): Signature {
      const sig = sigs.find((s) => ed25519.verify(s, p.bytes, pub));
      if (!sig) throw new Error("no fixture signature for this payload");
      return { scheme: "ed25519", bytes: sig, publicKey: FIX.publicKey };
    },
  };
}

export const ACCOUNT: Account = {
  id: "sui:0",
  family: "sui",
  index: 0,
  curve: "ed25519",
  derivationPath: "m/44'/784'/0'/0'/0'",
  publicKey: FIX.publicKey,
  address: FIX.me,
};

type Handler = (variables: Record<string, unknown>) => unknown;

/** Mock GraphQL endpoint, routed by operation name. A handler may throw an Error to answer with GraphQL errors. */
export function mockGql(ops: Record<string, Handler>) {
  const calls: { op: string; variables: Record<string, unknown> }[] = [];
  const f = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { query: string; variables?: Record<string, unknown> };
    const op = body.query.match(/(?:query|mutation)\s+(\w+)/)?.[1] ?? "anonymous";
    calls.push({ op, variables: body.variables ?? {} });
    const h = ops[op];
    if (!h) return new Response(JSON.stringify({ errors: [{ message: `no mock for ${op}` }] }));
    try {
      return new Response(JSON.stringify({ data: h(body.variables ?? {}) }));
    } catch (e) {
      return new Response(JSON.stringify({ errors: [{ message: (e as Error).message }] }));
    }
  }) as typeof fetch;
  return { fetch: f, calls };
}

export function ctxFor(fetchImpl: typeof fetch, account: Account = ACCOUNT): ChainContext {
  return { network: SUI_TESTNET, account, fetch: fetchImpl };
}

export function req(method: string, params: unknown, origin = "https://app.example"): DappRequest {
  return { id: Math.random().toString(36).slice(2), origin, via: "injected", family: "sui", networkId: SUI_TESTNET.id, method, params };
}

export const SUI = "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI";
export const USDC = "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";

export const metadata: Record<string, unknown> = {
  [SUI]: { decimals: 9, name: "Sui", symbol: "SUI", iconUrl: "" },
  [USDC]: { decimals: 6, name: "USDC", symbol: "USDC", iconUrl: null },
};

export function simResult(changes: [owner: string, coinType: string, amount: string][], gas = { computationCost: "1000000", storageCost: "988000", storageRebate: "978120" }, status = "SUCCESS") {
  return {
    simulateTransaction: {
      effects: {
        status,
        executionError: status === "SUCCESS" ? null : { message: "MoveAbort in 1st command", abortCode: "1" },
        balanceChanges: { nodes: changes.map(([o, t, a]) => ({ owner: { address: o }, coinType: { repr: t }, amount: a })) },
        gasEffects: { gasSummary: gas },
      },
    },
  };
}
