/**
 * Starknet (Sepolia): get-starknet-core v4 discovery (getStarknet().getAvailableWallets(), scanning window.starknet_*),
 * wallet API requests: wallet_requestAccounts, wallet_signTypedData (SNIP-12) verified with starknet.js
 * typedData.verifyMessage against the account's Stark public key, and wallet_addInvokeTransaction of an STRK
 * transfer of 1 fri to yourself.
 */
import { getStarknet } from "@starknet-io/get-starknet-core";
import { ec, typedData, encode, num } from "starknet";
import { expose } from "../dapp-kit";

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
type W = { id: string; name: string; request(a: { type: string; params?: unknown }): Promise<any> };
let wallet: W;
let address = "";

const TYPED = {
  types: {
    StarknetDomain: [
      { name: "name", type: "shortstring" },
      { name: "version", type: "shortstring" },
      { name: "chainId", type: "shortstring" },
      { name: "revision", type: "shortstring" },
    ],
    Message: [{ name: "text", type: "shortstring" }],
  },
  primaryType: "Message",
  domain: { name: "Clip matrix", version: "1", chainId: "SN_SEPOLIA", revision: "1" },
  message: { text: "matrix sign-in check" },
};

/** Full (uncompressed) Stark key from the x coordinate; tries both y parities. */
const fullKeys = (x: string) =>
  ["02", "03"].map((p) => {
    try {
      return encode.addHexPrefix(encode.buf2hex(ec.starkCurve.ProjectivePoint.fromHex(p + x.replace(/^0x/, "").padStart(64, "0")).toRawBytes(false)));
    } catch {
      return null;
    }
  });

expose({
  info: { dapp: "get-starknet-core v4 + starknet.js in a local page, Starknet Sepolia", why: "get-starknet is the discovery every Starknet dapp (and starknetkit) uses; the example app is React around it" },
  steps: {
    connect: async () => {
      const sn = getStarknet();
      const all = (await sn.getAvailableWallets()) as unknown as W[];
      wallet = all.find((w) => w.name === "Clip Wallet")!;
      if (!wallet) throw new Error(`Clip Wallet not found by get-starknet (${all.map((w) => w.name).join(", ")})`);
      const accounts: string[] = await wallet.request({ type: "wallet_requestAccounts" });
      address = accounts[0]!;
      return { address: num.toHex64(address), chainId: await wallet.request({ type: "wallet_requestChainId" }) };
    },
    sign: async () => {
      const sig: string[] = await wallet.request({ type: "wallet_signTypedData", params: TYPED });
      const keys = fullKeys(__MATRIX_PUBKEYS__.starknet!);
      const valid = keys.some((k) => {
        if (!k) return false;
        try {
          return typedData.verifyMessage(TYPED as never, sig.slice(-2) as never, k, address);
        } catch {
          return false;
        }
      });
      return { valid, how: "starknet.js typedData.verifyMessage (SNIP-12) with the account's Stark key", signatureLength: sig.length };
    },
    send: async () => {
      const r = await wallet.request({
        type: "wallet_addInvokeTransaction",
        params: { calls: [{ contract_address: STRK, entry_point: "transfer", calldata: [address, "0x1", "0x0"] }] },
      });
      return { id: r.transaction_hash };
    },
  },
});
