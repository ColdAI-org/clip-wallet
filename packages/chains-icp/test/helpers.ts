import type { Account, ChainContext, Network, SignablePayload, Signature } from "@clip-wallet/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha224 } from "@noble/hashes/sha2.js";
import { C, type CType, type CValue, ICP_TEST, cborDecode, cborEncode, candidDecode, candidEncode, createIcpModule, principalToText } from "../src/index.js";
import type { CborMap, CborValue } from "../src/cbor.js";
import { concat, fromHex, hex, utf8 } from "../src/util.js";
import { FIX } from "./signatures.js";

/** Vault stand-in: answers with a precomputed signature that verifies for the payload (verification only). */
export function fixtureSigner(publicKeyHex: string, signatures: readonly string[]) {
  const pub = fromHex(publicKeyHex);
  const sigs = signatures.map(fromHex);
  return {
    sign(p: SignablePayload): Signature {
      const sig = sigs.find((s) => secp256k1.verify(s, p.bytes, pub, { prehash: false }));
      if (!sig) throw new Error("no fixture signature for this payload");
      return { scheme: "ecdsa-secp256k1", bytes: sig, recovery: 0, publicKey: hex(pub) };
    },
  };
}

export const signer = fixtureSigner(FIX.publicKey, [...FIX.toPrincipalSigs, ...FIX.toAccountIdSigs]);

export function makeAccount(): Account {
  return { id: "icp:0", family: "icp", index: 0, curve: "secp256k1", derivationPath: "m/44'/223'/0'/0/0", publicKey: FIX.publicKey, address: FIX.me };
}

/** bob: a self-authenticating-looking principal nobody holds a key for (SHA-224("bob") ‖ 0x02). */
export const BOB = principalToText(concat(sha224(utf8("bob")), Uint8Array.of(2)));

/** Fixed clock and nonce, so wallet-built requests (and their fixture signatures) are reproducible. */
export const NOW = 1_790_000_000_000;
export const module = createIcpModule({ now: () => NOW, random: (n) => new Uint8Array(n).fill(7), pollIntervalMs: 0, pollAttempts: 3 });

export type Handler = (body: CborMap, url: string) => { status: number; body?: CborValue } | CborValue;

/** Mock boundary node: routes by endpoint kind and the request's method_name / request_type. */
export function mockIc(handlers: { query?: Record<string, CValue | ((arg: Uint8Array) => CValue)>; queryTypes?: Record<string, CType>; call?: Handler; readState?: Handler }) {
  const calls: { url: string; content: CborMap }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const env = cborDecode(new Uint8Array(init!.body as Uint8Array)) as CborMap;
    const content = env.content as CborMap;
    calls.push({ url, content });
    const respond = (r: ReturnType<Handler>) => {
      const x = r && typeof r === "object" && !Array.isArray(r) && !(r instanceof Uint8Array) && "status" in r && typeof r.status === "number" ? (r as { status: number; body?: CborValue }) : { status: 200, body: r as CborValue };
      return new Response(x.body === undefined ? null : (cborEncode(x.body) as BodyInit), { status: x.status });
    };
    if (url.endsWith("/query")) {
      const m = String(content.method_name);
      const h = handlers.query?.[m];
      if (h === undefined) return respond({ status: "rejected", reject_code: 3n, reject_message: `no mock for ${m}` });
      const v = typeof h === "function" ? h(content.arg as Uint8Array) : h;
      return respond({ status: "replied", reply: { arg: candidEncode([handlers.queryTypes?.[m] ?? C.nat], [v]) } });
    }
    if (url.endsWith("/call")) return respond(handlers.call ? handlers.call(env, url) : { status: 202 });
    if (url.endsWith("/read_state")) return respond(handlers.readState ? handlers.readState(env, url) : { status: 500 });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { fetch: f, calls };
}

/** A certificate (no signature: this module doesn't verify them) whose tree has request_status/<id>/… */
export function certificate(id: Uint8Array, fields: Record<string, Uint8Array>): Uint8Array {
  const leaves = Object.entries(fields).map(([k, v]) => [2n, utf8(k), [3n, v]] as CborValue);
  const fork = (xs: CborValue[]): CborValue => (xs.length === 1 ? xs[0]! : [1n, xs[0]!, fork(xs.slice(1))]);
  const tree: CborValue = [1n, [4n, new Uint8Array(32)], [2n, utf8("request_status"), [2n, id, fork(leaves)]]];
  return cborEncode({ tree, signature: new Uint8Array(48) });
}

export function ctxFor(fetchImpl: typeof fetch, network: Network = ICP_TEST): ChainContext {
  return { network, account: makeAccount(), fetch: fetchImpl };
}

export { candidDecode };
