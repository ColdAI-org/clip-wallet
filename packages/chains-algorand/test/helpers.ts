import type { Account, ChainContext, SignablePayload, Signature } from "@clip-wallet/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import { ALGORAND_TESTNET } from "../src/index.js";
import { fromHex, hex } from "../src/util.js";
import { FIX } from "./signatures.js";

/** Vault stand-in: answers with a precomputed signature that verifies for the payload (verification only). */
export function fixtureSigner(publicKeyHex: string, signatures: readonly string[]) {
  const pub = fromHex(publicKeyHex);
  const sigs = signatures.map(fromHex);
  return {
    sign(p: SignablePayload): Signature {
      const sig = sigs.find((s) => ed25519.verify(s, p.bytes, pub));
      if (!sig) throw new Error("no fixture signature for this payload");
      return { scheme: "ed25519", bytes: sig, publicKey: hex(pub) };
    },
  };
}

export const signer = fixtureSigner(FIX.publicKey, [FIX.paySig, FIX.usdcSig, FIX.optInSig, FIX.groupPaySig, FIX.groupCallSig, FIX.forOtherSig]);

export function makeAccount(): Account {
  return {
    id: "algorand:0",
    family: "algorand",
    index: 0,
    curve: "bip32-ed25519",
    derivationPath: "m/44'/283'/0'/0/0",
    publicKey: FIX.publicKey,
    address: FIX.me,
  };
}

export const ALGOD = ALGORAND_TESTNET.rpcUrls[0]!;
export const INDEXER = ALGORAND_TESTNET.indexerUrl!;

type Body = unknown | ((url: string, init?: RequestInit) => unknown);
export interface Reply {
  status: number;
  body: unknown;
}
export const reply = (status: number, body: unknown): Reply => ({ status, body });
const isReply = (v: unknown): v is Reply => !!v && typeof v === "object" && "status" in v && "body" in v && Object.keys(v).length === 2;

/** URL-routed mock fetch (first match wins). Handlers may return a Reply for a non-200 status. */
export function mockFetch(routes: [RegExp, Body][]) {
  const calls: { url: string; method: string; body?: Uint8Array | string; contentType?: string }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, method: init?.method ?? "GET", body: init?.body as Uint8Array | string | undefined, contentType: headers["content-type"] });
    for (const [re, body] of routes) {
      if (!re.test(url)) continue;
      let v = typeof body === "function" ? (body as (u: string, i?: RequestInit) => unknown)(url, init) : body;
      if (!isReply(v)) v = reply(200, v);
      const r = v as Reply;
      return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status });
    }
    return new Response(JSON.stringify({ message: `no mock for ${url}` }), { status: 404 });
  }) as typeof fetch;
  return { fetch: f, calls };
}

export function ctxFor(fetchImpl: typeof fetch): ChainContext {
  return { network: ALGORAND_TESTNET, account: makeAccount(), fetch: fetchImpl };
}

/* ------------------------------------------------------------------ fixtures (trimmed from testnet responses, Oct 2026) */

export const PARAMS = {
  "consensus-version": "https://github.com/algorandfoundation/specs/tree/268b63433a907455d439995bf916f6b296018f4f",
  fee: 0,
  "genesis-hash": "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
  "genesis-id": "testnet-v1.0",
  "last-round": 67902000,
  "min-fee": 1000,
};

export const USDC_ID = "10458941";
export const USDC_CREATOR = "VETIGP3I6RCUVLVYNDW5UA2OJMXB5WP6L6HJ3RWO2R37GP4AVETICXC55I";
/** Raw JSON: `total` is 2^64-1, which JSON.parse can't hold exactly. */
export const USDC_ASSET_JSON =
  '{"index":10458941,"params":{"clawback":"XM2W7VZODABS6RAL3FENBRKCOF6XLOQZZWIVVZTBYCVH2ADRYKN53CQLXM","creator":"VETIGP3I6RCUVLVYNDW5UA2OJMXB5WP6L6HJ3RWO2R37GP4AVETICXC55I","decimals":6,"default-frozen":false,"freeze":"JTDZXA72SNBU5JCFO6MI5LITSR7YDBLQI2K5LERAIIYSG4P7GZRS6ZLTJE","manager":"6FLEYABEB3G7ZKHL4NBCXHMMXVTEITBXI4AU3CMVXKJVEBKRRKOEY5UQEI","name":"USDC","name-b64":"VVNEQw==","reserve":"UJBZPEMXLD6KZOLUBUDSZ3DXECXYDADZZLBH6O7CMYXHE2PLTCW44VK5T4","total":18446744073709551615,"unit-name":"USDC","unit-name-b64":"VVNEQw==","url":"https://centre.io","url-b64":"aHR0cHM6Ly9jZW50cmUuaW8="}}';

export function account(address: string, over: Record<string, unknown> = {}) {
  return {
    address,
    amount: 4106015,
    "amount-without-pending-rewards": 4106015,
    "apps-local-state": [],
    "apps-total-schema": { "num-byte-slice": 0, "num-uint": 0 },
    assets: [{ amount: 10000000, "asset-id": 10458941, "is-frozen": false }],
    "created-apps": [],
    "created-assets": [],
    "min-balance": 200000,
    "pending-rewards": 0,
    "reward-base": 27521,
    rewards: 0,
    round: 67902000,
    status: "Offline",
    "total-apps-opted-in": 0,
    "total-assets-opted-in": 1,
    "total-created-apps": 0,
    "total-created-assets": 0,
    ...over,
  };
}

/** A non-existent account, as algod returns it (200 with zero balance). */
export function emptyAccount(address: string) {
  return account(address, { amount: 0, "amount-without-pending-rewards": 0, assets: [], "min-balance": 100000, "total-assets-opted-in": 0 });
}

export const holding = (amount: number, id = USDC_ID) => ({ "asset-holding": { amount, "asset-id": Number(id), "is-frozen": false }, round: 67902000 });
export const NOT_OPTED_IN = reply(404, { message: "account asset info not found" });

/** Simulate success shaped like the real testnet response, one group of `n` transactions. */
export function simOk(groups: number[] = [1], extra: (gi: number, ti: number) => Record<string, unknown> = () => ({})) {
  return {
    "eval-overrides": { "allow-empty-signatures": true, "fix-signers": true },
    "last-round": 67902000,
    "txn-groups": groups.map((n, gi) => ({
      "group-fees-paid": 1000 * n,
      "txn-results": Array.from({ length: n }, (_, ti) => ({ "fees-paid": 1000, "txn-result": { "pool-error": "", txn: { txn: {} }, ...extra(gi, ti) } })),
    })),
    version: 2,
  };
}

export function simFail(message: string) {
  return {
    "eval-overrides": { "allow-empty-signatures": true },
    "last-round": 67902000,
    "txn-groups": [{ "failed-at": [0], "failure-message": message, "txn-results": [{ "txn-result": { "pool-error": "", txn: { txn: {} } } }] }],
    version: 2,
  };
}

/** Default routes: me holds 10 USDC and 4.106015 ALGO (0.2 locked); bob has added USDC. */
export function baseRoutes(over: [RegExp, Body][] = []): [RegExp, Body][] {
  return [
    ...over,
    [/\/v2\/transactions\/params$/, PARAMS],
    [/\/v2\/transactions\/simulate/, simOk()],
    [new RegExp(`/v2/accounts/${FIX.me}/assets/${USDC_ID}$`), holding(10000000)],
    [new RegExp(`/v2/accounts/${FIX.bob}/assets/${USDC_ID}$`), holding(0)],
    [new RegExp(`/v2/accounts/${FIX.me}$`), account(FIX.me)],
    [new RegExp(`/v2/accounts/${FIX.bob}$`), account(FIX.bob)],
    [new RegExp(`/v2/assets/${USDC_ID}$`), USDC_ASSET_JSON],
  ];
}
