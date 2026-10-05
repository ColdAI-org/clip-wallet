/**
 * NEAR (testnet): NEAR Wallet Selector v10 with Clip's module (@clip-wallet/kit-modules/near, the documented way a
 * wallet joins the selector), signIn, NEP-413 signMessage verified with @near-js/crypto over the NEP-413 payload
 * hash, and a 1-yoctoNEAR Transfer to yourself via signAndSendTransaction.
 */
import { setupWalletSelector } from "@near-wallet-selector/core";
import { setupClipWallet } from "@clip-wallet/kit-modules/near";
import { PublicKey } from "@near-js/crypto";
import { MESSAGE, expose } from "../dapp-kit";

let selector: Awaited<ReturnType<typeof setupWalletSelector>>;
let address = "";
const RECIPIENT = "matrix-dapp.example";

const u32 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const str = (s: string) => {
  const b = new TextEncoder().encode(s);
  return [...u32(b.length), ...b];
};
/** NEP-413: sha256( u32le(2^31 + 413) || borsh({ message, nonce: [u8; 32], recipient, callbackUrl: None }) ). */
async function nep413Hash(message: string, nonce: Uint8Array, recipient: string) {
  const bytes = new Uint8Array([...u32(2 ** 31 + 413), ...str(message), ...nonce, ...str(recipient), 0]);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

expose({
  info: { dapp: "@near-wallet-selector/core v10 + @clip-wallet/kit-modules/near in a local page, NEAR testnet", why: "the wallet-selector example is a Next.js app over this; NEAR Connect (no module) is covered by 1Mask's unit tests" },
  steps: {
    connect: async () => {
      selector = await setupWalletSelector({ network: "testnet", modules: [setupClipWallet()] });
      const wallet = await selector.wallet("clip-wallet");
      const accounts = await (wallet as unknown as { signIn(p: unknown): Promise<{ accountId: string }[]> }).signIn({ contractId: "", methodNames: [], accounts: [] });
      address = accounts[0]!.accountId;
      return { address };
    },
    sign: async () => {
      const wallet = await selector.wallet("clip-wallet");
      const nonce = crypto.getRandomValues(new Uint8Array(32));
      const r = await wallet.signMessage!({ message: MESSAGE, recipient: RECIPIENT, nonce: Buffer.from(nonce) } as never);
      const signed = r as unknown as { accountId: string; publicKey: string; signature: string };
      const sig = Uint8Array.from(atob(signed.signature), (c) => c.charCodeAt(0));
      const valid = signed.accountId === address && PublicKey.fromString(signed.publicKey).verify(await nep413Hash(MESSAGE, nonce, RECIPIENT), sig);
      return { valid, how: "NEP-413 payload hash, @near-js/crypto PublicKey.verify" };
    },
    send: async () => {
      const wallet = await selector.wallet("clip-wallet");
      const r = (await wallet.signAndSendTransaction({ receiverId: address, actions: [{ type: "Transfer", params: { deposit: "1" } }] } as never)) as { transaction: { hash: string } };
      return { id: r.transaction.hash };
    },
  },
});
