/** MOCK fixtures: realistic testnet balances, collectibles, activity, prices, names and dapps. */
import type { Nft, TokenBalance } from "@clip-wallet/core";
import type { ActivityEntry } from "@clip-wallet/ui";
import type { NameResolver, PriceFeed } from "../wiring";
import { MOCK_NETWORKS, NET, USDC, USDC_E } from "./networks";

const nativeOf = (id: string) => MOCK_NETWORKS.find((n) => n.id === id)!.nativeAsset;

/** Base units per network. fiatValue is filled by the portfolio service from the price feed. */
export const MOCK_BALANCES: Record<string, TokenBalance[]> = {
  [NET.base]: [
    { asset: USDC[NET.base]!, amount: "12000000" },
    { asset: nativeOf(NET.base), amount: "42000000000000000" },
    {
      asset: { key: "clip-points", symbol: "PTS", name: "Clip Points", decimals: 18, networkId: NET.base, address: "0x00000000000000000000000000000000000c11b0" },
      amount: "250000000000000000",
    },
    {
      asset: {
        key: "spam-claim",
        symbol: "CLAIM",
        name: "Claim $5,000 at usdc-bonus.example",
        decimals: 18,
        networkId: NET.base,
        address: "0x000000000000000000000000000000000000dead",
        spam: true,
      },
      amount: "5000000000000000000000",
    },
  ],
  [NET.sepolia]: [
    { asset: USDC[NET.sepolia]!, amount: "400000000" },
    { asset: nativeOf(NET.sepolia), amount: "18000000000000000" },
  ],
  [NET.arb]: [{ asset: USDC_E, amount: "40000000" }],
  [NET.hedera]: [{ asset: nativeOf(NET.hedera), amount: "125000000000" }],
  [NET.solana]: [{ asset: nativeOf(NET.solana), amount: "1500000000" }],
  [NET.bitcoin]: [{ asset: nativeOf(NET.bitcoin), amount: "120000" }],
  // A few Phase 2 balances so Home shows every kind of account in one list (no network names).
  [NET.sui]: [{ asset: nativeOf(NET.sui), amount: "42500000000" }],
  [NET.cardano]: [{ asset: nativeOf(NET.cardano), amount: "310000000" }],
  [NET.substrate]: [{ asset: nativeOf(NET.substrate), amount: "125000000000" }],
  [NET.ton]: [{ asset: nativeOf(NET.ton), amount: "18000000000" }],
  [NET.near]: [{ asset: nativeOf(NET.near), amount: "7500000000000000000000000" }],
  [NET.tezos]: [{ asset: nativeOf(NET.tezos), amount: "64000000" }],
  [NET.aptos]: [],
  [NET.starknet]: [],
  [NET.stellar]: [],
  [NET.algorand]: [],
};

const nft = (n: Omit<Nft, "standard"> & { standard?: Nft["standard"] }): Nft => ({ standard: "erc721", ...n });

export const MOCK_NFTS: Record<string, Nft[]> = {
  [NET.base]: [
    nft({ networkId: NET.base, collection: { address: "0xc11b000000000000000000000000000000000001", name: "Clip Founders" }, tokenId: "7", name: "Founder #7", mediaUrl: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/7.png", attributes: [{ trait: "Background", value: "Ember" }, { trait: "Edition", value: "1 of 100" }, { trait: "Website", value: "https://clip.example/founders" }] }),
    nft({ networkId: NET.base, collection: { address: "0xc11b000000000000000000000000000000000001", name: "Clip Founders" }, tokenId: "42", name: "Founder #42", mediaUrl: "https://media.example/founders/42.svg" }),
    nft({ networkId: NET.base, collection: { address: "0xc11b000000000000000000000000000000000001", name: "Clip Founders" }, tokenId: "88", name: "Founder #88", mediaUrl: "https://media.example/founders/88.mp4" }),
    nft({ networkId: NET.base, collection: { address: "0x5ca0000000000000000000000000000000000000", name: "FREE MINT — claim now" }, tokenId: "1", name: "Visit claim-site.example", spam: true, mediaUrl: "https://claim-site.example/x.html" }),
  ],
  [NET.hedera]: [
    nft({ networkId: NET.hedera, standard: "hts-nft", collection: { address: "0.0.5005", name: "Hashgraph Owls" }, tokenId: "12", name: "Owl 12", attributes: [{ trait: "Eyes", value: "Laser" }] }),
    nft({ networkId: NET.hedera, standard: "hts-nft", collection: { address: "0.0.5005", name: "Hashgraph Owls" }, tokenId: "13", name: "Owl 13" }),
  ],
  [NET.solana]: [
    nft({ networkId: NET.solana, standard: "metaplex", collection: { address: "Tide9xKbdQ8uP4rT3ZqYJbAa1Mvq7GZ7vH5yLzQ1tPo", name: "Tidepool Frogs" }, tokenId: "Frg1kdy2x3", name: "Frog #301" }),
  ],
  [NET.bitcoin]: [
    nft({ networkId: NET.bitcoin, standard: "ordinal", collection: { address: "ord-pixels", name: "Pixel Ordinals" }, tokenId: "i0", name: "Pixel 0" }),
  ],
  [NET.sui]: [
    nft({ networkId: NET.sui, standard: "sui-object", collection: { address: `0x${"5e".repeat(32)}::capy::Capy`, name: "Capys" }, tokenId: `0x${"c4".repeat(32)}`, name: "Capy #812" }),
  ],
  [NET.ton]: [
    nft({ networkId: NET.ton, standard: "tep62", collection: { address: "kQAOQdwdw8kGftJCSFgOErM1mBjYPe4DBPq8-AhF6vr9si5N", name: "TON Diamonds" }, tokenId: "77", name: "Diamond #77" }),
  ],
  [NET.cardano]: [
    nft({ networkId: NET.cardano, standard: "cip25", collection: { address: "d5e6bf0500378d4f0da4e8dde6becec7621cd8cbf5cbb9b87013d4cc", name: "SpaceBudz" }, tokenId: "SpaceBud4012", name: "SpaceBud #4012" }),
  ],
};

const min = 60_000;
export const MOCK_ACTIVITY: ActivityEntry[] = [
  {
    id: "act-seed-1",
    title: "Paid Magic Eden 25 USDC",
    kind: "pay",
    app: { name: "Magic Eden", origin: "https://magiceden.io" },
    fiatValue: -25,
    timestamp: Date.now() - 40 * min,
    status: "done",
    legs: [
      { title: "Moved 13 USDC to pay", networkId: NET.sepolia, status: "done", txHash: "0x9a1f00000000000000000000000000000000000000000000000000000000c0de" },
      { title: "Network fee paid for you", networkId: NET.base, status: "done" },
      { title: "Paid Magic Eden", networkId: NET.base, status: "done", txHash: "0x4b2e00000000000000000000000000000000000000000000000000000000beef" },
    ],
  },
  {
    id: "act-seed-2",
    title: "Received 300 USDC",
    kind: "receive",
    fiatValue: 300,
    timestamp: Date.now() - 26 * 60 * min,
    status: "done",
    legs: [],
  },
  {
    id: "act-seed-3",
    title: "Connected to SaucerSwap",
    kind: "connect",
    app: { name: "SaucerSwap", origin: "https://www.saucerswap.finance" },
    timestamp: Date.now() - 3 * 24 * 60 * min,
    status: "done",
    legs: [],
  },
  {
    id: "act-seed-4",
    title: "Sent 40 HBAR to alice.hbar",
    kind: "send",
    fiatValue: -2.8,
    timestamp: Date.now() - 5 * 24 * 60 * min,
    status: "done",
    legs: [],
  },
];

/** MOCK prices (USD per whole unit). */
const PRICES: Record<string, number> = {
  usdc: 1,
  "usdc.e": 1,
  eth: 3000,
  hbar: 0.07,
  sol: 150,
  btc: 62000,
  "clip-points": 0.6,
  sui: 3.1,
  apt: 8,
  ada: 0.45,
  pas: 6,
  strk: 0.4,
  gram: 5.2,
  near: 4.5,
  xlm: 0.11,
  xtz: 0.9,
  algo: 0.18,
};
const FX: Record<string, number> = { USD: 1, EUR: 0.92, GBP: 0.79 };

export class MockPriceFeed implements PriceFeed {
  usd(key: string) {
    return PRICES[key];
  }
  fx(currency: string) {
    return FX[currency] ?? 1;
  }
}

const NAMES: Record<string, string> = {
  "alice.eth": "0x1111111111111111111111111111111111111111",
  "alice.hbar": "0.0.4815162",
  "bob.sol": "BoB1111111111111111111111111111111111111111",
};

export class MockNameResolver implements NameResolver {
  async resolve(name: string) {
    const address = NAMES[name.toLowerCase()];
    return address ? { address, displayName: name.toLowerCase() } : null;
  }
}
