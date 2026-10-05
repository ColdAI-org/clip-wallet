/**
 * Stellar (testnet): Stellar Wallets Kit module interface (@clip-wallet/kit-modules/stellar's ClipWalletModule, the
 * module the kit loads), SEP-53 signMessage verified with @stellar/stellar-base Keypair.verify, and a 1-stroop native
 * payment to yourself built with TransactionBuilder, signed with signTransaction and submitted to Horizon.
 */
import { ClipWalletModule } from "@clip-wallet/kit-modules/stellar";
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder, hash } from "@stellar/stellar-base";
import { MESSAGE, NeedsFunds, expose } from "../dapp-kit";

const HORIZON = "https://horizon-testnet.stellar.org";
const kit = new ClipWalletModule();
let address = "";

expose({
  info: { dapp: "Stellar Wallets Kit module API (ClipWalletModule) + @stellar/stellar-base + Horizon in a local page, testnet", why: "the kit's own package pulls in Reown/Ledger/Trezor; Clip's module implements the kit's ModuleInterface, which is what the kit calls" },
  steps: {
    connect: async () => {
      if (!(await kit.isAvailable())) throw new Error("window.clipwallet.stellar not available");
      address = (await kit.getAddress()).address;
      const net = await kit.getNetwork();
      return { address, network: net.network, passphrase: net.networkPassphrase };
    },
    sign: async () => {
      const r = await kit.signMessage(MESSAGE, { networkPassphrase: Networks.TESTNET, address });
      const sig = Uint8Array.from(atob(r.signedMessage), (c) => c.charCodeAt(0));
      const digest = hash(Buffer.concat([Buffer.from("Stellar Signed Message:\n"), Buffer.from(MESSAGE)]));
      return { valid: Keypair.fromPublicKey(address).verify(digest, Buffer.from(sig)), how: "SEP-53 hash, @stellar/stellar-base Keypair.verify" };
    },
    send: async () => {
      const res = await fetch(`${HORIZON}/accounts/${address}`);
      // Unfunded accounts don't exist on Stellar: build against sequence 0 so the wallet still decodes the request.
      const seq = res.ok ? ((await res.json()) as { sequence: string }).sequence : "0";
      const tx = new TransactionBuilder(new Account(address, seq), { fee: "100", networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.payment({ destination: address, asset: Asset.native(), amount: "0.0000001" }))
        .setTimeout(300)
        .build();
      const { signedTxXdr } = await kit.signTransaction(tx.toXDR(), { networkPassphrase: Networks.TESTNET, address });
      if (!res.ok) throw new NeedsFunds("signed, but the account doesn't exist on testnet yet");
      const sub = await fetch(`${HORIZON}/transactions`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `tx=${encodeURIComponent(signedTxXdr)}` });
      const body = (await sub.json()) as { hash?: string; extras?: unknown };
      if (!sub.ok || !body.hash) throw new Error(`Horizon refused: ${JSON.stringify(body.extras ?? body).slice(0, 200)}`);
      return { id: body.hash };
    },
  },
});
