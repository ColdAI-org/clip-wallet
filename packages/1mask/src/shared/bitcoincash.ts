import type { NetworkId } from "@clip-wallet/core";

/**
 * Bitcoin Cash dapp connectivity. BCH has no injected-provider standard; dapps reach wallets over WalletConnect v2
 * with the community spec wc2-bch-bcr (https://github.com/mainnet-pat/wc2-bch-bcr, used by Cashonize, Paytaca, Zapit
 * and apps such as TapSwap): namespace "bch", chains "bch:bitcoincash" / "bch:bchtest", methods bch_getAddresses,
 * bch_signTransaction, bch_signMessage, event "addressesChanged". The signing methods are chains-bitcoincash's own
 * DappRequest methods, so the background hands them over unchanged.
 */
export const BCH_WC = {
  namespace: "bch",
  getAddresses: "bch_getAddresses",
  signTransaction: "bch_signTransaction",
  signMessage: "bch_signMessage",
  events: ["addressesChanged"],
} as const;

export const BCH_SIGNING_METHODS: readonly string[] = [BCH_WC.signTransaction, BCH_WC.signMessage];

/**
 * wc2-bch-bcr chain ids ↔ the wallet's CAIP-2 network ids (chains-bitcoincash BCH_NETS: bip122 + first own block).
 * "bch:bchtest" names any test network; chipnet (where BCH upgrades are tested) is the default one.
 */
export const BCH_WC_CHAINS: Record<string, NetworkId> = {
  "bch:bitcoincash": "bip122:000000000000000000651ef99cb9fcbe",
  "bch:bchtest": "bip122:00000000040ba9641ba98a37b2e5ceea",
};

const BCH_NETWORK_PREFIX: Record<NetworkId, "bitcoincash" | "bchtest"> = {
  "bip122:000000000000000000651ef99cb9fcbe": "bitcoincash",
  "bip122:00000000040ba9641ba98a37b2e5ceea": "bchtest",
  "bip122:000000001dd410c49a788668ce267517": "bchtest",
};

export function bchNetworkForWcChain(chain: string | undefined): NetworkId | undefined {
  if (!chain) return undefined;
  return BCH_WC_CHAINS[chain] ?? (BCH_NETWORK_PREFIX[chain] ? chain : undefined);
}

export function bchWcChainFor(networkId: NetworkId): string | undefined {
  const p = BCH_NETWORK_PREFIX[networkId];
  return p === "bitcoincash" ? "bch:bitcoincash" : p ? "bch:bchtest" : undefined;
}

/* ------------------------------------------------------------------ CashAddr re-spelling (checksum only, no hashing) */

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function polymod(values: number[]): bigint {
  const GEN = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];
  let c = 1n;
  for (const d of values) {
    const c0 = c >> 35n;
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d);
    for (let i = 0; i < 5; i++) if ((c0 >> BigInt(i)) & 1n) c ^= GEN[i]!;
  }
  return c ^ 1n;
}

const words = (prefix: string) => [...prefix].map((ch) => ch.charCodeAt(0) & 31);

/**
 * The same account's CashAddr for `networkId` ("bitcoincash:q…" → "bchtest:q…"): the payload stays, only the
 * prefix-bound checksum changes. Verifies the input checksum; undefined for anything that isn't a CashAddr.
 */
export function bchAddressOn(address: string, networkId: NetworkId): string | undefined {
  const target = BCH_NETWORK_PREFIX[networkId];
  const a = address.trim().toLowerCase();
  const i = a.indexOf(":");
  if (!target || i <= 0) return undefined;
  const payload: number[] = [];
  for (const ch of a.slice(i + 1)) {
    const w = CHARSET.indexOf(ch);
    if (w < 0) return undefined;
    payload.push(w);
  }
  if (payload.length < 42 || polymod([...words(a.slice(0, i)), 0, ...payload]) !== 0n) return undefined;
  const data = payload.slice(0, -8);
  const mod = polymod([...words(target), 0, ...data, 0, 0, 0, 0, 0, 0, 0, 0]);
  const check: number[] = [];
  for (let k = 0; k < 8; k++) check.push(Number((mod >> BigInt(5 * (7 - k))) & 31n));
  return `${target}:${[...data, ...check].map((w) => CHARSET[w]).join("")}`;
}
