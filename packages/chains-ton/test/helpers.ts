import "../src/buffer.js";
import type { Account, ChainContext, DappRequest, SignablePayload, Signature } from "@clip-wallet/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import { Address, beginCell } from "@ton/core";
import { TON_TESTNET } from "../src/index.js";
import { fromHex, hex } from "../src/util.js";

/** Fixed clock for deterministic valid_until / timestamps. */
export const NOW = 1_790_000_000;

export function makeAccount(publicKey: string, address = ""): Account {
  return { id: "ton:0", family: "ton", index: 0, curve: "ed25519", derivationPath: "m/44'/607'/0'", publicKey, address };
}

export function ctxFor(account: Account, f: typeof fetch, network = TON_TESTNET): ChainContext {
  return { network, account, fetch: f };
}

export function req(method: string, params: unknown, id = "req-1", origin = "https://app.example"): DappRequest {
  return { id, origin, via: "injected", family: "ton", networkId: TON_TESTNET.id, method, params };
}

/** A testnet friendly address for an arbitrary account hash. */
export const addr = (byte: number, bounceable = false) => new Address(0, Buffer.alloc(32, byte)).toString({ urlSafe: true, bounceable, testOnly: true });
export const raw = (byte: number) => new Address(0, Buffer.alloc(32, byte)).toRawString();

export const BOB = addr(0xb0);
export const JETTON_MASTER = raw(0x11);
export const MY_JETTON_WALLET = raw(0x22);
export const NFT_ITEM = raw(0x33);

const addrCellHex = (a: Address) => beginCell().storeAddress(a).endCell().toBoc().toString("hex");

export interface TonState {
  status: "active" | "uninit";
  seqno: number;
  balance: bigint;
  /** Owner of MY_JETTON_WALLET (defaults to me). */
  jettonOwner?: Address;
  emulation?: unknown;
  emulateFails?: boolean;
}

/** Mock toncenter + tonapi by URL. Records every call. */
export function mockTon(me: () => Address, state: TonState, over: [RegExp, (body: unknown, url: string) => unknown][] = []) {
  const calls: { url: string; body: unknown }[] = [];
  const routes: [RegExp, (body: unknown, url: string) => unknown][] = [
    ...over,
    [/\/v3\/walletInformation/, () => ({ balance: state.balance.toString(), status: state.status, ...(state.status === "active" ? { seqno: state.seqno } : {}) })],
    [/\/v3\/addressInformation/, () => ({ status: "uninit", balance: "0" })],
    [/\/v2\/estimateFee/, () => ({ ok: true, result: { source_fees: { in_fwd_fee: 66667, storage_fee: 10, gas_fee: 300000, fwd_fee: 100000 } } })],
    [/\/v2\/sendBocReturnHash/, () => ({ ok: true, result: { hash: "abc" } })],
    [/\/events\/emulate/, () => {
      if (state.emulateFails) throw new Error("emulation down");
      return state.emulation ?? { actions: [], extra: -500000 };
    }],
    [/\/v2\/accounts\/[^/]+\/jettons\/[^/?]+/, () => ({
      balance: "5000000",
      wallet_address: { address: MY_JETTON_WALLET, is_scam: false, is_wallet: false },
      jetton: { address: JETTON_MASTER, name: "Test Dollar", symbol: "TUSD", decimals: 6, verification: "none" },
    })],
    [/\/v2\/accounts\/[^/]+\/jettons/, () => ({
      balances: [
        { balance: "5000000", wallet_address: { address: MY_JETTON_WALLET }, jetton: { address: JETTON_MASTER, name: "Test Dollar", symbol: "TUSD", decimals: 6, verification: "none" } },
        { balance: "0", wallet_address: { address: raw(0x44) }, jetton: { address: raw(0x45), name: "Zero", symbol: "ZERO", decimals: 9 } },
        { balance: "7", wallet_address: { address: raw(0x46) }, jetton: { address: raw(0x47), name: "Tether USD", symbol: "USDT", decimals: 6, verification: "none" } },
      ],
    })],
    [/\/v2\/accounts\/[^/]+\/nfts/, () => ({
      nft_items: [
        {
          address: NFT_ITEM,
          collection: { address: raw(0x34), name: "Boards" },
          metadata: { name: "Board #1", image: "https://example.invalid/1.png", attributes: [{ trait_type: "Color", value: "red" }] },
          previews: [{ resolution: "500x500", url: "https://cache.example/1.webp" }],
          trust: "whitelist",
        },
      ],
    })],
    [/\/methods\/get_wallet_data/, () => ({
      success: true,
      stack: [
        { type: "num", num: "0x4c4b40" },
        { type: "cell", cell: addrCellHex(state.jettonOwner ?? me()) },
        { type: "cell", cell: addrCellHex(Address.parse(JETTON_MASTER)) },
        { type: "cell", cell: "b5ee9c72010101010002000000" },
      ],
    })],
    [/\/v2\/jettons\//, () => ({ metadata: { address: JETTON_MASTER, name: "Test Dollar", symbol: "TUSD", decimals: "6" }, verification: "none" })],
    [/\/v2\/nfts\//, () => ({ address: NFT_ITEM, metadata: { name: "Board #1" }, owner: { address: me().toRawString() } })],
  ];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    for (const [re, h] of routes) {
      if (re.test(url)) {
        try {
          return new Response(JSON.stringify(h(body, url)), { status: 200 });
        } catch {
          return new Response(JSON.stringify({ error: "failed" }), { status: 500 });
        }
      }
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  }) as typeof fetch;
  return { fetch: f, calls };
}

/** Vault stand-in: answers with a precomputed signature that verifies for the payload (verification only). */
export function fixtureSigner(publicKey: string, signatures: readonly string[]) {
  const pub = fromHex(publicKey);
  const sigs = signatures.map(fromHex);
  return {
    sign(p: SignablePayload): Signature {
      const sig = sigs.find((s) => ed25519.verify(s, p.bytes, pub));
      if (!sig) throw new Error(`no fixture signature for payload ${hex(p.bytes)}`);
      return { scheme: "ed25519", bytes: sig, publicKey };
    },
  };
}
