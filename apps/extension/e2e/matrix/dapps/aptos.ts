/**
 * Aptos (testnet): AIP-62 discovery with @aptos-labs/wallet-standard getAptosWallets (what the wallet adapter uses),
 * aptos:signMessage verified with @aptos-labs/ts-sdk Ed25519PublicKey.verifySignature over the full message, and an
 * entry-function payload 0x1::aptos_account::transfer of 1 octa to yourself (aptos:signAndSubmitTransaction).
 */
import { getAptosWallets, UserResponseStatus, type AptosWallet } from "@aptos-labs/wallet-standard";
import { Ed25519PublicKey, Ed25519Signature } from "@aptos-labs/ts-sdk/crypto";
import { MESSAGE, expose, waitFor } from "../dapp-kit";

let wallet: AptosWallet;
let address = "";
let publicKey: Ed25519PublicKey;
type F = Record<string, any>;
const ok = <T>(r: { status: string; args?: T }) => {
  if (r.status !== UserResponseStatus.APPROVED) throw Object.assign(new Error("User rejected"), { code: 4001 });
  return r.args as T;
};

expose({
  info: { dapp: "@aptos-labs/wallet-standard getAptosWallets + @aptos-labs/ts-sdk in a local page, testnet", why: "the wallet-adapter example dapp is a Next.js app over these calls; a local page keeps the run fast" },
  steps: {
    connect: async () => {
      wallet = await waitFor(() => getAptosWallets().aptosWallets.find((w) => w.name === "Clip Wallet"), "Clip Wallet (AIP-62)");
      const acc = ok<{ address: { toString(): string }; publicKey: { toUint8Array(): Uint8Array } }>(await (wallet.features as F)["aptos:connect"].connect());
      address = acc.address.toString();
      publicKey = new Ed25519PublicKey(acc.publicKey.toUint8Array());
      const net = await (wallet.features as F)["aptos:network"].network();
      return { address, network: net.name, chainId: net.chainId };
    },
    sign: async () => {
      const r = ok<{ fullMessage: string; signature: { toUint8Array(): Uint8Array } }>(await (wallet.features as F)["aptos:signMessage"].signMessage({ message: MESSAGE, nonce: "matrix-1", address: true, application: true, chainId: true }));
      const valid = publicKey.verifySignature({ message: new TextEncoder().encode(r.fullMessage), signature: new Ed25519Signature(r.signature.toUint8Array()) });
      return { valid, how: "@aptos-labs/ts-sdk Ed25519PublicKey.verifySignature (AIP-62 fullMessage)" };
    },
    send: async () => {
      const r = ok<{ hash: string }>(await (wallet.features as F)["aptos:signAndSubmitTransaction"].signAndSubmitTransaction({ payload: { function: "0x1::aptos_account::transfer", functionArguments: [address, 1] } }));
      return { id: r.hash };
    },
  },
});
