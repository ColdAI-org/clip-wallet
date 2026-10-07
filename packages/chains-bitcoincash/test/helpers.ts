import type { Account, ChainContext, SignablePayload, Signature } from "@clip-wallet/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { BCH_CHIPNET, type SocketFactory, type SocketLike } from "../src/index.js";
import { fromHex, hex } from "../src/util.js";
import { FIX } from "./signatures.js";

/** Vault stand-in: answers with a precomputed signature that verifies for the payload (verification only). */
export function fixtureSigner(publicKeyHex: string, sigs: Record<string, string>) {
  const pub = fromHex(publicKeyHex);
  return {
    sign(p: SignablePayload): Signature {
      for (const v of Object.values(sigs)) {
        const [rs, rec] = v.split(":");
        const bytes = fromHex(rs!);
        if (secp256k1.verify(bytes, p.bytes, pub, { prehash: false })) return { scheme: "ecdsa-secp256k1", bytes, recovery: Number(rec), publicKey: publicKeyHex };
      }
      throw new Error(`no fixture signature for digest ${hex(p.bytes)}`);
    },
  };
}

export const signer = fixtureSigner(FIX.publicKey, FIX.sigs);

export function makeAccount(): Account {
  return { id: "bitcoincash:0", family: "bitcoincash", index: 0, curve: "secp256k1", derivationPath: "m/44'/145'/0'/0/0", publicKey: FIX.publicKey, address: FIX.mainnet };
}

export type Handler = (method: string, params: unknown[], url: string) => unknown;

/**
 * In-memory Electrum server(s): `handler` answers each JSON-RPC call (throw { message } for an RPC error).
 * URLs listed in `down` refuse to connect, to exercise the fallback.
 */
export function fakeElectrum(handler: Handler, down: string[] = []) {
  const calls: { url: string; method: string; params: unknown[] }[] = [];
  const factory: SocketFactory = (url) => {
    const s: SocketLike = {
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      send(data: string) {
        const m = JSON.parse(data) as { id: number; method: string; params: unknown[] };
        calls.push({ url, method: m.method, params: m.params });
        queueMicrotask(() => {
          let reply: unknown;
          try {
            reply = { jsonrpc: "2.0", id: m.id, result: m.method === "server.version" ? ["Fulcrum 2.1.3", "1.4"] : handler(m.method, m.params, url) };
          } catch (e) {
            reply = { jsonrpc: "2.0", id: m.id, error: { code: 1, message: (e as Error).message } };
          }
          s.onmessage?.({ data: JSON.stringify(reply) });
        });
      },
      close() {},
    };
    queueMicrotask(() => (down.includes(url) ? s.onerror?.({}) : s.onopen?.({})));
    return s;
  };
  return { factory, calls };
}

export function ctxFor(network = BCH_CHIPNET): ChainContext {
  return { network, account: makeAccount(), fetch: (() => Promise.reject(new Error("no fetch in BCH tests"))) as typeof fetch };
}
