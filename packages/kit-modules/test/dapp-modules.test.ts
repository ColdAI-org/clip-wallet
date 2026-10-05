import type { Network } from "@clip-wallet/core";
import { installP2Providers } from "@clip-wallet/1mask/inpage/p2";
import { WalletManager } from "@txnlab/use-wallet";
import algosdk from "algosdk";
import { afterEach, describe, expect, it } from "vitest";
import { clipWallet, CLIP_WALLET_ALGORAND_ID } from "../src/algorand/index.js";
import { setupClipWallet, toWireAction } from "../src/near/index.js";
import { ClipWalletModule } from "../src/stellar/index.js";
import { actionCreators } from "@near-wallet-selector/core";
import { PublicKey } from "@near-js/crypto";

/**
 * Each ecosystem module against 1Mask's real injected provider, with the background replaced by a
 * scripted transport (what the router would answer after the user approves).
 */

const asset = (key: string, networkId: string) => ({ key, symbol: key, name: key, decimals: 6, networkId });
const net = (id: string, family: Network["family"]): Network => ({ id, family, name: id, nativeAsset: asset(family, id), testnet: true, rpcUrls: [], explorerUrl: "" });
const NETWORKS: Network[] = [
  net("near:testnet", "near"),
  net("stellar:testnet", "stellar"),
  net("algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe", "algorand"),
];

const PUB = "3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29";
const ALGO_ADDR = algosdk.encodeAddress(Uint8Array.from(Buffer.from(PUB, "hex")));
const G_ADDR = "GA6SXIZIKLJHCZI2KEOBEUUOFMM4JUPPM2UTWX6STAWT25JWIEUFIMFF";

let installed: { stop(): void } | undefined;
afterEach(() => installed?.stop());

function install(answer: (family: string, method: string, params: any, chain?: string) => unknown) {
  const calls: { family: string; method: string; params: any; chain?: string }[] = [];
  const transport = {
    request: async (family: string, method: string, params?: unknown, chain?: string) => {
      calls.push({ family, method, params, chain });
      return JSON.parse(JSON.stringify((await answer(family, method, params, chain)) ?? null));
    },
    onEvent: () => () => {},
    destroy: () => {},
  };
  installed = installP2Providers(window, { name: "Clip Wallet", icon: "data:image/png;base64,AA==", rdns: "org.coldai.clipwallet" }, NETWORKS, transport as never);
  return calls;
}

describe("NEAR Wallet Selector module", () => {
  it("converts near-api-js actions to the wallet's JSON shape", () => {
    expect(toWireAction(actionCreators.transfer(10n ** 24n))).toEqual({ type: "Transfer", params: { deposit: "1000000000000000000000000" } });
    expect(toWireAction(actionCreators.functionCall("ft_transfer", { receiver_id: "bob.testnet", amount: "1" }, 30_000_000_000_000n, 1n))).toEqual({
      type: "FunctionCall",
      params: { methodName: "ft_transfer", args: { receiver_id: "bob.testnet", amount: "1" }, gas: "30000000000000", deposit: "1" },
    });
    expect(toWireAction(actionCreators.functionCall("raw", new Uint8Array([1, 2, 3]), 1n, 0n))).toMatchObject({ params: { argsBase64: "AQID" } });
    expect(toWireAction({ type: "DeleteAccount", params: { beneficiaryId: "bob.testnet" } })).toEqual({ type: "DeleteAccount", params: { beneficiaryId: "bob.testnet" } });
  });

  it("is available when injected and drives the provider", async () => {
    const calls = install((_f, method) => {
      if (method === "1mask_getAccounts") return [];
      if (method === "near:connect") return [{ address: PUB, publicKey: PUB }];
      if (method === "near_signAndSendTransaction") return { transaction: { hash: "h" } };
      if (method === "near_signMessage") return { accountId: PUB, publicKey: "ed25519:4zvwRjXUKGfvwnParsHAS3HuSVzV5cA4McphgmoCtajS", signature: "AA==" };
      return null;
    });
    const options = { network: { networkId: "testnet" } } as never;
    const mod = (await setupClipWallet()({ options }))!;
    expect(mod).toMatchObject({ id: "clip-wallet", type: "injected", metadata: { name: "Clip Wallet", available: true } });
    const emitted: unknown[] = [];
    const wallet: any = await mod.init({
      options,
      store: { getState: () => ({ contract: { contractId: "guest-book.testnet" } }) },
      emitter: { emit: (...a: unknown[]) => emitted.push(a) },
    } as never);
    expect(await wallet.signIn({ contractId: "guest-book.testnet", methodNames: [] })).toEqual([{ accountId: PUB, publicKey: expect.stringMatching(/^ed25519:/) }]);
    await wallet.signAndSendTransaction({ actions: [actionCreators.transfer(1n)] });
    expect(calls.at(-1)).toMatchObject({ method: "near_signAndSendTransaction", params: { receiverId: "guest-book.testnet", actions: [{ type: "Transfer", params: { deposit: "1" } }] }, chain: "near:testnet" });
    const signed = await wallet.signMessage({ message: "hi", recipient: "app", nonce: Buffer.alloc(32) });
    expect(signed.accountId).toBe(PUB);
    expect((await wallet.getPublicKey()) instanceof PublicKey).toBe(true);
    await expect(wallet.signTransaction()).rejects.toThrow(/signAndSendTransaction/);
  });

  it("is listed as not installed without the provider", async () => {
    const mod = (await setupClipWallet({ globalKey: "nobody" })({ options: { network: { networkId: "testnet" } } as never }))!;
    expect(mod.metadata.available).toBe(false);
  });
});

describe("Stellar Wallets Kit module", () => {
  it("implements ModuleInterface over the SEP-43 provider and rejects with kit errors", async () => {
    install((_f, method) => {
      if (method === "1mask_getAccounts") return [{ address: G_ADDR }];
      if (method === "stellar:getNetwork") return { network: "TESTNET", networkPassphrase: "Test SDF Network ; September 2015" };
      if (method === "stellar_signXDR") return { signedXDR: "SIGNED" };
      if (method === "stellar_signAndSubmitXDR") return { status: "success", hash: "ab", signedXDR: "S" };
      if (method === "stellar_signMessage") throw Object.assign(new Error("You declined."), { code: 4001 });
      return null;
    });
    const m = new ClipWalletModule();
    expect(m.moduleType).toBe("HOT_WALLET");
    expect(await m.isAvailable()).toBe(true);
    expect(await m.getAddress()).toEqual({ address: G_ADDR });
    expect(await m.getNetwork()).toEqual({ network: "TESTNET", networkPassphrase: "Test SDF Network ; September 2015" });
    expect(await m.signTransaction("AAAA", { networkPassphrase: "Test SDF Network ; September 2015", address: G_ADDR, path: "ignored" })).toEqual({ signedTxXdr: "SIGNED", signerAddress: G_ADDR });
    expect(await m.signAndSubmitTransaction("AAAA")).toEqual({ status: "success" });
    await expect(m.signMessage("hi")).rejects.toEqual({ code: -4, message: "You declined." });
    expect(await new ClipWalletModule({ globalKey: "nobody" }).isAvailable()).toBe(false);
  });
});

describe("use-wallet v5 adapter", () => {
  it("connects through WalletManager and signs only this account's transactions", async () => {
    const calls = install((_f, method, params) => {
      if (method === "1mask_getAccounts") return [];
      if (method === "algorand:connect") return [{ address: ALGO_ADDR }];
      if (method === "algo_signTxn") return (params as { signers?: string[] }[]).map((t) => (t.signers ? null : "AQID"));
      return null;
    });
    const manager = new WalletManager({ wallets: [clipWallet()], defaultNetwork: "testnet" });
    const wallet = manager.getWallet(CLIP_WALLET_ALGORAND_ID)!;
    expect(wallet.metadata.name).toBe("Clip Wallet");
    const accounts = await wallet.connect();
    expect(accounts).toEqual([{ name: "Clip Wallet Account 1", address: ALGO_ADDR }]);
    expect(calls.find((c) => c.method === "algorand:connect")?.chain).toBe("algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe");

    const sp = { fee: 1000n, firstValid: 1n, lastValid: 1000n, genesisID: "testnet-v1.0", genesisHash: Buffer.from("SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=", "base64"), minFee: 1000n, flatFee: true };
    const mine = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: ALGO_ADDR, receiver: ALGO_ADDR, amount: 1n, suggestedParams: sp });
    const theirs = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ", receiver: ALGO_ADDR, amount: 1n, suggestedParams: sp });
    const out = await wallet.signTransactions([mine, theirs]);
    expect(out).toEqual([new Uint8Array([1, 2, 3]), null]);
    const sent = calls.find((c) => c.method === "algo_signTxn")!.params as { txn: string; signers?: string[] }[];
    expect(sent[0]).toEqual({ txn: Buffer.from(mine.toByte()).toString("base64") });
    expect(sent[1]!.signers).toEqual([]);
    await wallet.disconnect();
    expect(wallet.isConnected).toBe(false);
  });
});

describe("picker identity (picker matrix: modules show what the wallet announces)", () => {
  const ACME = { name: "Acme Wallet", icon: "data:image/png;base64,QUNNRQ==" as const, rdns: "com.example.acme" };
  const transport = { request: async () => null, onEvent: () => () => {}, destroy: () => {} };

  it("a kit-built wallet appears under its own name and icon in every dapp-side module", async () => {
    installed = installP2Providers(window, ACME, NETWORKS, transport as never, { globalKey: "acmewallet" });
    const near = (await setupClipWallet({ globalKey: "acmewallet" })({ options: { network: { networkId: "testnet" } } as never }))!;
    expect(near.metadata.name).toBe("Acme Wallet");
    expect(near.metadata.iconUrl).toBe(ACME.icon);
    const stellar = new ClipWalletModule({ globalKey: "acmewallet" });
    expect([stellar.productName, stellar.productIcon]).toEqual(["Acme Wallet", ACME.icon]);
    const algo = clipWallet({ globalKey: "acmewallet" });
    expect(algo.metadata).toMatchObject({ name: "Acme Wallet", icon: ACME.icon });
  });

  it("explicit options still win over the announcement", async () => {
    installed = installP2Providers(window, ACME, NETWORKS, transport as never, { globalKey: "acmewallet" });
    const near = (await setupClipWallet({ globalKey: "acmewallet", iconUrl: "data:image/png;base64,T1dO" })({ options: { network: { networkId: "testnet" } } as never }))!;
    expect(near.metadata.iconUrl).toBe("data:image/png;base64,T1dO");
    expect(new ClipWalletModule({ globalKey: "acmewallet", productName: "Mine" }).productName).toBe("Mine");
    expect(clipWallet({ globalKey: "acmewallet", metadata: { name: "Mine", icon: "x" } }).metadata).toMatchObject({ name: "Mine", icon: "x" });
  });

  it("falls back to Clip Wallet's identity when nothing is announced", () => {
    const stellar = new ClipWalletModule({ globalKey: "nobody" });
    expect(stellar.productName).toBe("Clip Wallet");
    expect(stellar.productIcon).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(clipWallet({ globalKey: "nobody" }).metadata.name).toBe("Clip Wallet");
  });
});
