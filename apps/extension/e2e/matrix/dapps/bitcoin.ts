/**
 * Bitcoin (testnet4): Wallet Standard discovery of the bitcoin:* features (as Magic Eden / Exodus-style wallet kits
 * do) and the wallet's sats-connect v4 provider: getAccounts, BIP-322 signMessage verified with bip322-js, and
 * sendTransfer of 546 sats (the P2WPKH dust limit) to yourself.
 */
import { getWallets } from "@wallet-standard/app";
import { Verifier } from "bip322-js";
import { MESSAGE, expose, waitFor } from "../dapp-kit";

type Sats = { request(m: string, p?: unknown): Promise<{ result?: any; error?: { code: number; message: string } }> };
let sats: Sats;
let address = "";
const call = async (m: string, p?: unknown) => {
  const r = await sats.request(m, p);
  if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
  return r.result;
};

expose({
  info: { dapp: "Wallet Standard bitcoin:* + sats-connect v4 request API in a local page, testnet4", why: "Bitcoin has no single example dapp; sats-connect's request API over the Wallet Standard is what Xverse/Magic Eden-style dapps call" },
  steps: {
    connect: async () => {
      const w = await waitFor(() => getWallets().get().find((x) => x.name === "Clip Wallet" && "bitcoin:connect" in x.features), "Clip Wallet (bitcoin:connect)");
      sats = (w.features as unknown as Record<string, { provider: Sats }>)["sats-connect:"]!.provider;
      const accounts = (await call("getAccounts", { purposes: ["payment"] })) as { address: string; addressType: string }[];
      address = accounts[0]!.address;
      return { address, addressType: accounts[0]!.addressType };
    },
    sign: async () => {
      const r = (await call("signMessage", { address, message: MESSAGE, protocol: "BIP322" })) as { signature: string };
      return { valid: Verifier.verifySignature(address, MESSAGE, r.signature), how: "bip322-js Verifier.verifySignature (BIP-322 simple)" };
    },
    send: async () => {
      const r = (await call("sendTransfer", { recipients: [{ address, amount: 546 }] })) as { txid: string };
      return { id: r.txid };
    },
  },
});
