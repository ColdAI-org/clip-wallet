import type { Account, ChainContext, DappRequest, SignablePayload, Signature } from "@clip-wallet/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import { APTOS_TESTNET, APT_METADATA, primaryStoreAddress } from "../src/index.js";
import { fromHex } from "../src/util.js";
import { FIX } from "./signatures.js";

/** Vault stand-in: answers with a precomputed signature that verifies for the payload (verification only). */
export function fixtureSigner(hexSigs: readonly string[]) {
  const pub = fromHex(FIX.publicKey);
  const sigs = hexSigs.map(fromHex);
  return {
    sign(p: SignablePayload): Signature {
      const sig = sigs.find((s) => ed25519.verify(s, p.bytes, pub));
      if (!sig) throw new Error("no fixture signature for this payload");
      return { scheme: "ed25519", bytes: sig, publicKey: FIX.publicKey };
    },
  };
}

export const ACCOUNT: Account = {
  id: "aptos:0",
  family: "aptos",
  index: 0,
  curve: "ed25519",
  derivationPath: "m/44'/637'/0'/0'/0'",
  publicKey: FIX.publicKey,
  address: FIX.me,
};

type Handler = (body: unknown, url: string) => unknown;
export interface Route {
  method: "GET" | "POST";
  path: RegExp;
  handler: Handler;
  status?: number;
}

/** Mock fullnode REST + indexer GraphQL. */
export function mockAptos(routes: Route[]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const raw = init?.body;
    const body = raw instanceof Uint8Array ? raw : typeof raw === "string" ? JSON.parse(raw) : null;
    calls.push({ method, url, body });
    for (const r of routes) {
      if (r.method === method && r.path.test(url)) {
        try {
          return new Response(JSON.stringify(r.handler(body, url)), { status: r.status ?? 200 });
        } catch (e) {
          return new Response(JSON.stringify(e), { status: (e as { status?: number }).status ?? 400 });
        }
      }
    }
    return new Response(JSON.stringify({ message: `no mock for ${method} ${url}`, error_code: "not_found" }), { status: 404 });
  }) as typeof fetch;
  return { fetch: f, calls };
}

export function ctxFor(fetchImpl: typeof fetch, account: Account = ACCOUNT): ChainContext {
  return { network: APTOS_TESTNET, account, fetch: fetchImpl };
}

export function req(method: string, input: Record<string, unknown>, origin = "https://app.example"): DappRequest {
  return { id: Math.random().toString(36).slice(2), origin, via: "injected", family: "aptos", networkId: APTOS_TESTNET.id, method, params: { inputs: [input] } };
}

/** A user-transaction simulation: FA Withdraw/Deposit events plus the stores' write-set entries. */
export function simulation(
  moves: { owner: string; metadata: string; delta: bigint; withObjectCore?: boolean }[],
  o: { success?: boolean; vm_status?: string; gas_used?: string; gas_unit_price?: string } = {},
) {
  const events = moves.map((m) => ({
    type: m.delta < 0n ? "0x1::fungible_asset::Withdraw" : "0x1::fungible_asset::Deposit",
    data: { store: primaryStoreAddress(m.owner, m.metadata), amount: (m.delta < 0n ? -m.delta : m.delta).toString() },
  }));
  events.push({ type: "0x1::transaction_fee::FeeStatement", data: { total_charge_gas_units: o.gas_used ?? "62" } as never });
  const changes = moves.flatMap((m) => {
    const store = primaryStoreAddress(m.owner, m.metadata);
    const out: unknown[] = [{ type: "write_resource", address: store, data: { type: "0x1::fungible_asset::FungibleStore", data: { balance: "1", frozen: false, metadata: { inner: m.metadata } } } }];
    if (m.withObjectCore !== false) out.push({ type: "write_resource", address: store, data: { type: "0x1::object::ObjectCore", data: { owner: m.owner } } });
    return out;
  });
  return [{ success: o.success ?? true, vm_status: o.vm_status ?? "Executed successfully", gas_used: o.gas_used ?? "62", gas_unit_price: o.gas_unit_price ?? "100", events, changes }];
}

export const USDC_META = { data: { decimals: 6, symbol: "USDC", name: "USDC", icon_uri: "" } };
export const APT = APT_METADATA;
