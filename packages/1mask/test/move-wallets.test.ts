import type { Family, Network } from "@clip-wallet/core";
import {
  AccountAddress,
  AccountAuthenticatorEd25519,
  ChainId,
  Ed25519PublicKey,
  Ed25519Signature,
  MoveVector,
  RawTransaction,
  SimpleTransaction,
  U64,
  generateTransactionPayloadWithABI,
  parseTypeTag,
} from "@aptos-labs/ts-sdk";
import { isWalletWithRequiredFeatureSet as isAptosWallet, UserResponseStatus } from "@aptos-labs/wallet-standard";
import { isWalletWithRequiredFeatureSet as isSuiWallet } from "@mysten/wallet-standard";
import type { Wallet } from "@wallet-standard/base";
import { registerWallet } from "@wallet-standard/wallet";
import { describe, expect, it } from "vitest";
import { APTOS_FEATURES, ClipAptosWallet, METHOD_APTOS_NETWORK, aptosChain, toWireArg } from "../src/inpage/aptos.js";
import { ClipSuiWallet, SUI_FEATURES, suiChain } from "../src/inpage/sui.js";
import type { InpageTransport } from "../src/inpage/transport.js";
import { resolveIdentity } from "../src/shared/config.js";
import { ProviderRpcError, RpcErrorCode } from "../src/shared/errors.js";
import type { OneMaskEvent } from "../src/shared/protocol.js";
import { NETWORKS } from "./helpers.js";

const asset = (key: string, networkId: string) => ({ key, symbol: key.toUpperCase(), name: key, decimals: 9, networkId });
const MOVE_NETWORKS: Network[] = [
  ...NETWORKS,
  { id: "sui:testnet", family: "sui", name: "Sui Testnet", nativeAsset: asset("sui", "sui:testnet"), testnet: true, rpcUrls: ["https://graphql.testnet.sui.io/graphql"], explorerUrl: "https://suiscan.xyz/testnet" },
  { id: "sui:devnet", family: "sui", name: "Sui Devnet", nativeAsset: asset("sui", "sui:devnet"), testnet: true, rpcUrls: ["https://graphql.devnet.sui.io/graphql"], explorerUrl: "https://suiscan.xyz/devnet" },
  { id: "aptos:2", family: "aptos", name: "Aptos Testnet", nativeAsset: asset("apt", "aptos:2"), testnet: true, rpcUrls: ["https://api.testnet.aptoslabs.com/v1"], explorerUrl: "https://explorer.aptoslabs.com" },
  { id: "aptos:devnet", family: "aptos", name: "Aptos Devnet", nativeAsset: asset("apt", "aptos:devnet"), testnet: true, rpcUrls: ["https://api.devnet.aptoslabs.com/v1"], explorerUrl: "https://explorer.aptoslabs.com" },
];

const SUI_ADDR = "0x5e93a736d04fbb25737aa40bee40171ef79f65fae833749e3c089fe7cc2161f1";
const SUI_PUB = "900b4d81eecea3df2f74b14200c4f4cf3f49afaca7a634ffd2cf6ff82bdaecf2";
const APT_ADDR = "0xeb663b681209e7087d681c5d3eed12aaa8e1915e7c87794542c3f96e94b3d3bf";
const APT_PUB = "a686f0309ab80312979606cfccc10ea2740147ae6888351488d11c46f08fbf60";
const BOB = `0x${"b0".repeat(32)}`;

/** In-memory stand-in for the content-script transport: records requests, answers from `handle`. */
function fakeTransport(handle: (family: Family, method: string, params: unknown, chain?: string) => unknown) {
  const sent: { family: Family; method: string; params: unknown; chain: string | undefined }[] = [];
  const listeners = new Set<(f: Family, e: OneMaskEvent, d: unknown) => void>();
  const transport: InpageTransport = {
    async request(family, method, params, chain) {
      sent.push({ family, method, params, chain });
      return handle(family, method, params, chain);
    },
    onEvent(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    destroy() {
      listeners.clear();
    },
  };
  return { transport, sent, emit: (f: Family, e: OneMaskEvent, d: unknown) => listeners.forEach((l) => l(f, e, d)) };
}

const rejectedByUser = () => {
  throw new ProviderRpcError(RpcErrorCode.UserRejected, "The user rejected the request.");
};

describe("Sui Wallet Standard wallet", () => {
  const identity = resolveIdentity({ name: "Acme Wallet", rdns: "com.acme.wallet" });

  it("announces the configured identity, its Sui chains and every required feature", () => {
    const { transport } = fakeTransport(() => null);
    const w = new ClipSuiWallet(identity, MOVE_NETWORKS, transport);
    expect(w.name).toBe("Acme Wallet");
    expect(w.chains).toEqual(["sui:testnet", "sui:devnet"]);
    expect(Object.keys(w.features).sort()).toEqual([...SUI_FEATURES].sort());
    expect(isSuiWallet(w as unknown as Wallet, ["sui:signTransaction", "sui:signAndExecuteTransaction", "sui:signPersonalMessage"])).toBe(true);
    expect((w.features as any)["sui:signTransaction"].version).toBe("2.0.0");
    expect(suiChain(MOVE_NETWORKS.find((n) => n.id === "aptos:2")!)).toBeUndefined();
  });

  it("registers through the Wallet Standard window events", () => {
    const wallets: Wallet[] = [];
    window.addEventListener("wallet-standard:register-wallet", (e: Event) => {
      (e as unknown as { detail: (api: { register(w: Wallet): void }) => void }).detail({ register: (w) => void wallets.push(w) });
    });
    const w = new ClipSuiWallet(identity, MOVE_NETWORKS, fakeTransport(() => null).transport);
    registerWallet(w);
    expect(wallets).toContain(w);
  });

  it("connects, then sends transaction JSON and personal messages as { inputs: [...] }", async () => {
    const { transport, sent } = fakeTransport((_f, method) => {
      if (method === "standard:connect") return [{ address: SUI_ADDR, publicKey: SUI_PUB }];
      if (method === "sui:signTransaction") return { bytes: "AQID", signature: "AAAA" };
      if (method === "sui:signAndExecuteTransaction") return { bytes: "AQID", signature: "AAAA", digest: "D1", effects: "RUZG" };
      if (method === "sui:signPersonalMessage") return { bytes: "aGk=", signature: "AAAB" };
      return null;
    });
    const w = new ClipSuiWallet(identity, MOVE_NETWORKS, transport);
    const f = w.features as any;
    const { accounts } = await f["standard:connect"].connect();
    expect(accounts[0].address).toBe(SUI_ADDR);
    expect(accounts[0].publicKey).toHaveLength(32);
    expect(accounts[0].chains).toEqual(["sui:testnet", "sui:devnet"]);

    const tx = { toJSON: async () => '{"version":2,"commands":[]}' };
    expect(await f["sui:signTransaction"].signTransaction({ transaction: tx, account: accounts[0], chain: "sui:testnet" })).toEqual({ bytes: "AQID", signature: "AAAA" });
    expect(sent.at(-1)).toEqual({
      family: "sui",
      method: "sui:signTransaction",
      params: { inputs: [{ account: SUI_ADDR, transaction: '{"version":2,"commands":[]}', chain: "sui:testnet" }] },
      chain: "sui:testnet",
    });
    expect(await f["sui:signAndExecuteTransaction"].signAndExecuteTransaction({ transaction: tx, account: accounts[0], chain: "sui:testnet" })).toEqual({
      bytes: "AQID",
      signature: "AAAA",
      digest: "D1",
      effects: "RUZG",
    });
    expect(await f["sui:signPersonalMessage"].signPersonalMessage({ message: new TextEncoder().encode("hi"), account: accounts[0] })).toEqual({ bytes: "aGk=", signature: "AAAB" });
    expect(sent.at(-1)!.params).toEqual({ inputs: [{ account: SUI_ADDR, message: "aGk=" }] });
  });

  it("refuses foreign accounts, unknown chains and aborted requests before asking the wallet", async () => {
    const { transport, sent } = fakeTransport((_f, m) => (m === "standard:connect" ? [{ address: SUI_ADDR, publicKey: SUI_PUB }] : null));
    const w = new ClipSuiWallet(identity, MOVE_NETWORKS, transport);
    const f = w.features as any;
    const tx = { toJSON: async () => "{}" };
    const foreign = { address: BOB, publicKey: new Uint8Array(32), chains: ["sui:testnet"], features: [] };
    await expect(f["sui:signTransaction"].signTransaction({ transaction: tx, account: foreign, chain: "sui:testnet" })).rejects.toMatchObject({ code: 4100 });
    const { accounts } = await f["standard:connect"].connect();
    await expect(f["sui:signTransaction"].signTransaction({ transaction: tx, account: accounts[0], chain: "sui:mainnet" })).rejects.toMatchObject({ code: 4901 });
    const ac = new AbortController();
    ac.abort();
    await expect(f["sui:signTransaction"].signTransaction({ transaction: tx, account: accounts[0], chain: "sui:testnet", signal: ac.signal })).rejects.toMatchObject({ code: 4001 });
    expect(sent.map((s) => s.method)).toEqual(["standard:connect"]);
  });

  it("follows account changes pushed by the background", async () => {
    const { transport, emit } = fakeTransport(() => null);
    const w = new ClipSuiWallet(identity, MOVE_NETWORKS, transport);
    const changes: unknown[] = [];
    (w.features as any)["standard:events"].on("change", (p: unknown) => changes.push(p));
    emit("sui", "accountsChanged", [{ address: SUI_ADDR, publicKey: SUI_PUB }]);
    expect(w.accounts.map((a) => a.address)).toEqual([SUI_ADDR]);
    emit("aptos", "accountsChanged", []); // another family's event is ignored
    expect(w.accounts).toHaveLength(1);
    emit("sui", "disconnect", null);
    expect(w.accounts).toEqual([]);
    expect(changes).toHaveLength(2);
  });
});

describe("Aptos AIP-62 wallet", () => {
  const identity = resolveIdentity({ name: "Acme Wallet", rdns: "com.acme.wallet" });
  const connected = (handle: (method: string, params: any) => unknown = () => null) =>
    fakeTransport((_f, method, params) => {
      if (method === "aptos:connect" || method === "1mask_getAccounts") return [{ address: APT_ADDR, publicKey: APT_PUB }];
      return handle(method, params);
    });

  function simpleTx(sender = APT_ADDR, feePayer?: AccountAddress) {
    const payload = generateTransactionPayloadWithABI({
      function: "0x1::aptos_account::transfer",
      functionArguments: [BOB, 1n],
      abi: { typeParameters: [], parameters: [parseTypeTag("address"), parseTypeTag("u64")] },
    });
    return new SimpleTransaction(new RawTransaction(AccountAddress.from(sender), 0n, payload as never, 2000n, 100n, 1_800_000_000n, new ChainId(2)), feePayer);
  }

  it("announces identity, AIP-62 chains and the required feature set", () => {
    const w = new ClipAptosWallet(identity, MOVE_NETWORKS, connected().transport);
    expect(w.name).toBe("Acme Wallet");
    expect(w.url).toBe("https://acme.com");
    expect(w.chains).toEqual(["aptos:testnet", "aptos:devnet"]);
    expect(Object.keys(w.features).sort()).toEqual([...APTOS_FEATURES].sort());
    expect(isAptosWallet(w as unknown as Wallet)).toBe(true);
    expect(aptosChain(MOVE_NETWORKS.find((n) => n.id === "sui:testnet")!)).toBeUndefined();
    expect(new ClipAptosWallet(identity, MOVE_NETWORKS, connected().transport, { url: "https://acme.example" }).url).toBe("https://acme.example");
  });

  it("connects with AccountInfo and turns a user rejection into { status: Rejected }", async () => {
    const { transport } = connected();
    const w = new ClipAptosWallet(identity, MOVE_NETWORKS, transport);
    const res = await w.features["aptos:connect"].connect();
    expect(res.status).toBe(UserResponseStatus.APPROVED);
    if (res.status !== UserResponseStatus.APPROVED) return;
    expect(res.args.address.toStringLong()).toBe(APT_ADDR);
    expect(res.args.publicKey.toString()).toBe(`0x${APT_PUB}`);
    expect((await w.features["aptos:account"].account()).address.toStringLong()).toBe(APT_ADDR);
    expect(w.accounts[0]).toMatchObject({ address: APT_ADDR, signingScheme: 0, chains: ["aptos:testnet", "aptos:devnet"] });

    const no = new ClipAptosWallet(identity, MOVE_NETWORKS, fakeTransport(rejectedByUser).transport);
    expect(await no.features["aptos:connect"].connect()).toEqual({ status: "Rejected" });
    await expect(no.features["aptos:account"].account()).rejects.toMatchObject({ code: 4100 });
  });

  it("signs transactions as BCS and hands back an AccountAuthenticator", async () => {
    const auth = new AccountAuthenticatorEd25519(new Ed25519PublicKey(APT_PUB), new Ed25519Signature(new Uint8Array(64).fill(7)));
    const { transport, sent } = connected((m) => (m === "aptos:signTransaction" ? { authenticator: btoa(String.fromCharCode(...auth.bcsToBytes())) } : null));
    const w = new ClipAptosWallet(identity, MOVE_NETWORKS, transport);
    await w.features["aptos:connect"].connect();
    const tx = simpleTx();
    const res = await w.features["aptos:signTransaction"].signTransaction(tx);
    expect(res.status).toBe("Approved");
    if (res.status !== "Approved") return;
    expect(res.args).toBeInstanceOf(AccountAuthenticatorEd25519);
    expect(res.args.bcsToBytes()).toEqual(auth.bcsToBytes());
    const input = (sent.at(-1)!.params as any).inputs[0];
    expect(input).toEqual({ account: APT_ADDR, transaction: btoa(String.fromCharCode(...tx.bcsToBytes())), multiAgent: false, asFeePayer: false });
  });

  it("names itself fee payer on the transaction when signing as fee payer", async () => {
    const auth = new AccountAuthenticatorEd25519(new Ed25519PublicKey(APT_PUB), new Ed25519Signature(new Uint8Array(64)));
    const { transport, sent } = connected((m) =>
      m === "aptos:signTransaction" ? { authenticator: btoa(String.fromCharCode(...auth.bcsToBytes())), feePayerAddress: APT_ADDR } : null,
    );
    const w = new ClipAptosWallet(identity, MOVE_NETWORKS, transport);
    await w.features["aptos:connect"].connect();
    const tx = simpleTx(BOB, AccountAddress.ZERO);
    await w.features["aptos:signTransaction"].signTransaction(tx, true);
    expect((sent.at(-1)!.params as any).inputs[0].asFeePayer).toBe(true);
    expect(tx.feePayerAddress!.toStringLong()).toBe(APT_ADDR);
  });

  it("sends entry-function payloads wire-safe and returns the hash", async () => {
    const { transport, sent } = connected((m) => (m === "aptos:signAndSubmitTransaction" ? { hash: "0xfeed" } : null));
    const w = new ClipAptosWallet(identity, MOVE_NETWORKS, transport);
    await w.features["aptos:connect"].connect();
    const submit = w.features["aptos:signAndSubmitTransaction"]!;
    const res = await submit.signAndSubmitTransaction({
      payload: { function: "0xcafe::game::play", typeArguments: ["0x1::aptos_coin::AptosCoin"], functionArguments: [10n, new Uint8Array([1, 2]), AccountAddress.from(BOB), new U64(5), MoveVector.U8([9])] },
      maxGasAmount: 5000,
    });
    expect(res).toEqual({ status: "Approved", args: { hash: "0xfeed" } });
    expect((sent.at(-1)!.params as any).inputs[0]).toEqual({
      account: APT_ADDR,
      payload: { function: "0xcafe::game::play", typeArguments: ["0x1::aptos_coin::AptosCoin"], functionArguments: ["10", { $bytes: "0x0102" }, BOB, "5", [9]] },
      maxGasAmount: 5000,
    });
    expect(toWireArg(true)).toBe(true);
    await expect(submit.signAndSubmitTransaction({ payload: { bytecode: new Uint8Array([1]), functionArguments: [] } as never })).rejects.toMatchObject({ code: 4200 });
  });

  it("signs messages and returns an Ed25519Signature", async () => {
    const sig = "11".repeat(64);
    const { transport, sent } = connected((m, p) =>
      m === "aptos:signMessage" ? { fullMessage: `APTOS\nmessage: ${p.inputs[0].message}\nnonce: 1`, message: "hi", nonce: "1", prefix: "APTOS", signature: `0x${sig}` } : null,
    );
    const w = new ClipAptosWallet(identity, MOVE_NETWORKS, transport);
    await w.features["aptos:connect"].connect();
    const res = await w.features["aptos:signMessage"].signMessage({ message: "hi", nonce: "1", application: true });
    expect(res.status).toBe("Approved");
    if (res.status !== "Approved") return;
    expect(res.args.signature).toBeInstanceOf(Ed25519Signature);
    expect(res.args.signature.toString()).toBe(`0x${sig}`);
    expect(res.args.fullMessage).toBe("APTOS\nmessage: hi\nnonce: 1");
    expect((sent.at(-1)!.params as any).inputs[0]).toEqual({ account: APT_ADDR, message: "hi", nonce: "1", address: false, application: true, chainId: false });
  });

  it("reports the site's network and forwards account and network changes", async () => {
    const { transport, emit, sent } = connected((m) => (m === METHOD_APTOS_NETWORK ? { networkId: "aptos:2" } : null));
    const w = new ClipAptosWallet(identity, MOVE_NETWORKS, transport);
    expect(await w.features["aptos:network"].network()).toEqual({ name: "testnet", chainId: 2 });
    expect(sent.at(-1)!.method).toBe("1mask_getNetwork");
    const accounts: string[] = [];
    const nets: unknown[] = [];
    await w.features["aptos:onAccountChange"].onAccountChange((a) => accounts.push(a.address.toStringLong()));
    await w.features["aptos:onNetworkChange"].onNetworkChange((n) => nets.push(n));
    emit("aptos", "accountsChanged", [{ address: APT_ADDR, publicKey: APT_PUB }]);
    emit("aptos", "chainChanged", "aptos:devnet");
    emit("sui", "chainChanged", "aptos:2");
    expect(accounts).toEqual([APT_ADDR]);
    expect(nets).toEqual([{ name: "devnet", chainId: 0 }]);
    emit("aptos", "disconnect", null);
    expect(w.accounts).toEqual([]);
    w.destroy();
  });
});
