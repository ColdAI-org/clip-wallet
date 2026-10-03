import type { Account, ChainContext, SignablePayload, Signature } from "@clip-wallet/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import { CARDANO_PREPROD } from "../src/index.js";
import { CborMap, CborTag, type CborValue, encode } from "../src/cbor.js";
import { fromHex, hex } from "../src/util.js";

/** Public fixture data (see signatures.ts). */
export interface Fixture {
  paymentPub: string;
  stakePub: string;
  address: string;
  rewardAddress: string;
  bob: string;
  otherKeyHash: string;
  otherAddress: string;
  policy: string;
  pool: string;
  slot: number;
}

export function makeAccount(f: Fixture): Account {
  return {
    id: "cardano:0",
    family: "cardano",
    index: 0,
    curve: "bip32-ed25519",
    derivationPath: "m/1852'/1815'/0'/0/0",
    publicKey: f.paymentPub,
    address: f.address,
  };
}

/** Vault stand-in: answers with a precomputed signature that verifies for the payload (verification only). */
export function fixtureSigner(f: Fixture, signatures: readonly string[]) {
  const sigs = signatures.map(fromHex);
  return {
    sign(p: SignablePayload): Signature {
      const stake = p.derivationSubPath === "2/0";
      const pub = fromHex(stake ? f.stakePub : f.paymentPub);
      const sig = sigs.find((s) => ed25519.verify(s, p.bytes, pub));
      if (!sig) throw new Error(`no fixture signature for this ${stake ? "stake" : "payment"} payload`);
      return { scheme: "ed25519", bytes: sig, publicKey: hex(pub) };
    },
  };
}

export type Route = [method: "GET" | "POST", path: string, handler: (body: any) => unknown];

/** Mock Koios: routes by method + path. Records calls. */
export function mockKoios(routes: Route[]) {
  const calls: { path: string; body: unknown }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname.replace(/^\/api\/v1/, "");
    const method = (init?.method ?? "GET") as "GET" | "POST";
    const raw = init?.body;
    const body = raw instanceof Uint8Array ? raw : typeof raw === "string" ? JSON.parse(raw) : undefined;
    calls.push({ path, body });
    const r = routes.find(([m, p]) => m === method && p === path);
    if (!r) return new Response(JSON.stringify({ message: `no mock for ${method} ${path}` }), { status: 404 });
    const v = r[2](body);
    if (v instanceof Response) return v;
    return new Response(JSON.stringify(v), { status: method === "POST" && path === "/submittx" ? 202 : 200 });
  }) as typeof fetch;
  return { fetch: f, calls };
}

export function ctxFor(account: Account, fetchImpl: typeof fetch): ChainContext {
  return { network: CARDANO_PREPROD, account, fetch: fetchImpl };
}

export const PARAMS = {
  txFeePerByte: 44,
  txFeeFixed: 155381,
  utxoCostPerByte: 4310,
  stakeAddressDeposit: 2000000,
  maxTxSize: 16384,
  maxValueSize: 5000,
  collateralPercentage: 150,
};

export const TOKEN_NAME = "434c4950"; // "CLIP"
export const NFT_NAME = "000de140" + "436c697031"; // CIP-68 (222) "Clip1"

export function koiosUtxo(txHash: string, index: number, address: string, lovelace: bigint, assets: [string, string, bigint][] = []) {
  return {
    tx_hash: txHash,
    tx_index: index,
    address,
    value: lovelace.toString(),
    asset_list: assets.map(([policy_id, asset_name, q]) => ({ policy_id, asset_name, quantity: q.toString(), fingerprint: "asset1x" })),
    is_spent: false,
  };
}

export const TX_A = "aa".repeat(32);
export const TX_B = "bb".repeat(32);
export const TX_C = "cc".repeat(32);

/** The Koios answers every test uses. */
export function standardRoutes(f: Fixture, extra: Route[] = []): Route[] {
  return [
    ...extra,
    ["GET", "/tip", () => [{ abs_slot: f.slot, epoch_no: 300, block_height: 1 }]],
    ["GET", "/cli_protocol_params", () => PARAMS],
    [
      "POST",
      "/address_utxos",
      () => [
        koiosUtxo(TX_A, 0, f.address, 10_000_000n, [[f.policy, TOKEN_NAME, 5n]]),
        koiosUtxo(TX_C, 1, f.address, 3_000_000n),
      ],
    ],
    [
      "POST",
      "/utxo_info",
      () => [koiosUtxo(TX_A, 0, f.address, 10_000_000n, [[f.policy, TOKEN_NAME, 5n]]), koiosUtxo(TX_B, 0, f.otherAddress, 3_000_000n)],
    ],
    [
      "POST",
      "/asset_info",
      (b: { _asset_list: [string, string][] }) =>
        b._asset_list.map(([policy_id, asset_name]) =>
          asset_name === TOKEN_NAME
            ? { policy_id, asset_name, asset_name_ascii: "CLIP", total_supply: "1000000", token_registry_metadata: { name: "Clip Token", ticker: "CLIP", decimals: 0 } }
            : {
                policy_id,
                asset_name,
                total_supply: "1",
                cip68_metadata: {
                  "222": {
                    constructor: 0,
                    fields: [
                      {
                        map: [
                          { k: { bytes: hex(new TextEncoder().encode("name")) }, v: { bytes: hex(new TextEncoder().encode("Clip #1")) } },
                          { k: { bytes: hex(new TextEncoder().encode("image")) }, v: { bytes: hex(new TextEncoder().encode("ipfs://QmClip")) } },
                          { k: { bytes: hex(new TextEncoder().encode("rarity")) }, v: { bytes: hex(new TextEncoder().encode("rare")) } },
                        ],
                      },
                      { int: 1 },
                    ],
                  },
                },
              },
        ),
    ],
    ["POST", "/pool_info", (b: { _pool_bech32_ids: string[] }) => b._pool_bech32_ids.map((id) => ({ pool_id_bech32: id, meta_json: { ticker: "CLIP", name: "Clip Pool" } }))],
    ["POST", "/account_info", () => [{ stake_address: f.rewardAddress, status: "not registered", delegated_pool: null, total_balance: "0", rewards_available: "0" }]],
  ];
}

/**
 * The dapp transaction used across tests (built here so its bytes are readable): spends one of our UTxOs and one
 * foreign UTxO, pays bob 4 ADA + 2 CLIP, mints one CIP-68 NFT to us, and carries a CIP-20 message.
 */
export function dappTx(f: Fixture, addrBytes: (a: string) => Uint8Array): Uint8Array {
  const policy = fromHex(f.policy);
  const body = new CborMap([
    [0, new CborTag(258, [[fromHex(TX_A), 0], [fromHex(TX_B), 0]])],
    [
      1,
      [
        new CborMap([[0, addrBytes(f.bob)], [1, [4_000_000, new CborMap([[policy, new CborMap([[fromHex(TOKEN_NAME), 2]])]])]]]),
        new CborMap([
          [0, addrBytes(f.address)],
          [1, [6_800_000, new CborMap([[policy, new CborMap([[fromHex(TOKEN_NAME), 3], [fromHex(NFT_NAME), 1]])]])]],
        ]),
        [addrBytes(f.otherAddress), 2_000_000],
      ],
    ],
    [2, 200_000],
    [3, f.slot + 3600],
    [9, new CborMap([[policy, new CborMap([[fromHex(NFT_NAME), 1]])]])],
  ]);
  const aux = new CborTag(259, new CborMap([[0, new CborMap([[674, new CborMap([["msg", ["Thanks for the coffee"]]])]])]]));
  const tx: CborValue = [body, new CborMap(), true, aux];
  return encode(tx);
}
