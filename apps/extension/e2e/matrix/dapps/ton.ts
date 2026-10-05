/**
 * TON (testnet): @tonconnect/sdk with the injected JS bridge (TonConnect.isWalletInjected + connect({ jsBridgeKey }),
 * how the SDK talks to a browser-extension wallet), ton_addr, TON Connect signData (text) verified per the
 * TON Connect sign-data spec with @ton/crypto signVerify, and sendTransaction of 1 nanoton to yourself.
 */
import { TonConnect, CHAIN, type Wallet } from "@tonconnect/sdk";
import { Address, Cell, beginCell } from "@ton/core";
import { signVerify } from "@ton/crypto";
import { MESSAGE, expose, fromHex, waitFor } from "../dapp-kit";

const KEY = "clipwallet";
const storage = new Map<string, string>();
const connector = new TonConnect({
  manifestUrl: `${location.origin}/tonconnect-manifest.json`,
  storage: { getItem: async (k) => storage.get(k) ?? null, setItem: async (k, v) => void storage.set(k, v), removeItem: async (k) => void storage.delete(k) },
});
let wallet: Wallet;

const be = (n: number | bigint, bytes: number) => {
  const out = new Uint8Array(bytes);
  let v = BigInt(n);
  for (let i = bytes - 1; i >= 0; i--, v >>= 8n) out[i] = Number(v & 0xffn);
  return out;
};
const cat = (...a: Uint8Array[]) => {
  const out = new Uint8Array(a.reduce((s, x) => s + x.length, 0));
  let o = 0;
  for (const x of a) out.set(x, o), (o += x.length);
  return out;
};

expose({
  info: { dapp: "@tonconnect/sdk 4 (injected JS bridge) + @ton/core in a local page, TON testnet", why: "the TON Connect demo dapp needs a wallets-list entry Clip doesn't have yet; the SDK's injected-bridge path is the same protocol" },
  steps: {
    connect: async () => {
      await waitFor(() => TonConnect.isWalletInjected(KEY) || undefined, "window.clipwallet.tonconnect");
      const connected = new Promise<Wallet>((resolve, reject) => {
        const off = connector.onStatusChange(
          (w) => {
            if (w) off(), resolve(w);
          },
          (e) => (off(), reject(e)),
        );
      });
      connector.connect({ jsBridgeKey: KEY });
      wallet = await connected;
      return { address: Address.parse(wallet.account.address).toString({ testOnly: true, bounceable: false }), chain: wallet.account.chain, isTestnet: wallet.account.chain === CHAIN.TESTNET };
    },
    sign: async () => {
      const r = (await connector.signData({ type: "text", text: MESSAGE })) as { signature: string; timestamp: number; domain: string; address: string };
      const addr = Address.parse(r.address);
      const domain = new TextEncoder().encode(r.domain);
      const text = new TextEncoder().encode(MESSAGE);
      const msg = cat(new Uint8Array([0xff, 0xff]), new TextEncoder().encode("ton-connect/sign-data/"), be(addr.workChain, 4), addr.hash, be(domain.length, 4), domain, be(r.timestamp, 8), new TextEncoder().encode("txt"), be(text.length, 4), text);
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", msg));
      const sig = Uint8Array.from(atob(r.signature), (c) => c.charCodeAt(0));
      const valid = signVerify(Buffer.from(hash), Buffer.from(sig), Buffer.from(fromHex(wallet.account.publicKey!)));
      return { valid, how: "TON Connect sign-data (text) hash, @ton/crypto signVerify with the ton_addr public key" };
    },
    send: async () => {
      const to = Address.parse(wallet.account.address).toString({ testOnly: true, bounceable: false });
      const r = await connector.sendTransaction({ validUntil: Math.floor(Date.now() / 1000) + 300, network: CHAIN.TESTNET, messages: [{ address: to, amount: "1" }] });
      const ext = Cell.fromBase64(r.boc);
      void beginCell;
      return { id: ext.hash().toString("hex"), boc: r.boc };
    },
  },
});
