/**
 * Hedera testnet over WalletConnect, the HashConnect v3 / @hashgraph/hedera-wallet-connect path HashPack, Kabila and
 * Blade use: DAppConnector finds extension wallets ("hedera-extension-query"), connectExtension(id) hands Clip the
 * WalletConnect code, hedera_signMessage is verified with the library's own verifyMessageSignature, and a 1-tinybar
 * TransferTransaction is signed and executed through the DAppSigner. A transfer to yourself is invalid on Hedera
 * (ACCOUNT_REPEATED_IN_ACCOUNT_AMOUNTS), so it pays 1 tinybar to the matrix's other account (its EVM-path account).
 * Needs WALLETCONNECT_PROJECT_ID (bundled in as __MATRIX_WC_PROJECT_ID__) and a wallet built with it.
 */
import { DAppConnector, HederaChainId, HederaJsonRpcMethod, HederaSessionEvent, verifyMessageSignature } from "@hashgraph/hedera-wallet-connect";
import { AccountId, Hbar, LedgerId, PublicKey, TransferTransaction } from "@hiero-ledger/sdk";
import { MESSAGE, expose, waitFor } from "../dapp-kit";

const EVM_PATH_ACCOUNT = "0x05ACD02A8E18c130D902FB732bb6AD22DA4f2717";
let dc: DAppConnector;
let accountId = "";

expose({
  info: {
    dapp: "@hashgraph/hedera-wallet-connect DAppConnector (HashConnect v3 path): extension discovery + WalletConnect, Hedera testnet",
    why: "HashPack/Kabila-style Hedera dapps connect this way; a local page keeps the run deterministic and needs only the project id",
  },
  steps: {
    connect: async () => {
      if (!__MATRIX_WC_PROJECT_ID__) throw new Error("WALLETCONNECT_PROJECT_ID is not set");
      dc = new DAppConnector(
        { name: "Clip dapp matrix", description: "Clip Wallet testnet dapp matrix", url: location.origin, icons: [`${location.origin}/icon.png`] },
        LedgerId.TESTNET,
        __MATRIX_WC_PROJECT_ID__,
        Object.values(HederaJsonRpcMethod),
        [HederaSessionEvent.ChainChanged, HederaSessionEvent.AccountsChanged],
        [HederaChainId.Testnet],
      );
      await dc.init({ logger: "error" });
      const clip = await waitFor(() => dc.extensions.find((e) => e.name === "Clip Wallet" && e.available), "Clip Wallet in DAppConnector.extensions", 10_000);
      await dc.connectExtension(clip.id);
      const signer = dc.signers[0]!;
      accountId = signer.getAccountId().toString();
      return { address: accountId, extensionId: clip.id, ledger: signer.getLedgerId().toString() };
    },
    sign: async () => {
      const r = (await dc.signMessage({ signerAccountId: `${HederaChainId.Testnet}:${accountId}`, message: MESSAGE })) as unknown as { signatureMap?: string; result?: { signatureMap: string } };
      const signatureMap = r.signatureMap ?? r.result!.signatureMap;
      const info = (await (await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${accountId}`)).json()) as { key?: { key: string; _type: string } };
      const key = info.key!._type === "ECDSA_SECP256K1" ? PublicKey.fromStringECDSA(info.key!.key) : PublicKey.fromStringED25519(info.key!.key);
      return { valid: verifyMessageSignature(MESSAGE, signatureMap, key), how: "@hashgraph/hedera-wallet-connect verifyMessageSignature (key from the mirror node)" };
    },
    send: async () => {
      const signer = dc.signers[0]!;
      const tx = await new TransferTransaction()
        .addHbarTransfer(AccountId.fromString(accountId), Hbar.fromTinybars(-1))
        .addHbarTransfer(AccountId.fromEvmAddress(0, 0, EVM_PATH_ACCOUNT), Hbar.fromTinybars(1))
        .freezeWithSigner(signer);
      const res = await tx.executeWithSigner(signer);
      return { id: res.transactionId.toString() };
    },
  },
});
